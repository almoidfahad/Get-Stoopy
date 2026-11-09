import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { serviceableStoreWhere } from '../serviceability/serviceable-store.js';
import { PrismaService, PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { assertCartItemCount, assertCartQuantity, groupQuoteItems, MAX_ACTIVE_QUOTES_PER_USER, MAX_CART_ITEMS, type AccessContext, type QuotePricedItem } from '@getstoopy/core';

function hashPayload(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function assertCommandKey(key: string): void { if (!/^[A-Za-z0-9:_-]{8,128}$/.test(key)) throw new BadRequestException({ code: 'CHECKOUT_COMMAND_KEY_INVALID', message: 'Invalid checkout command key' }); }
function assertVersion(version: number): void { if (!Number.isInteger(version) || version < 1) throw new BadRequestException({ code: 'VERSION_INVALID', message: 'Invalid version' }); }

@Injectable()
export class CommerceService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(PrivilegedPrismaService) private readonly privileged: PrivilegedPrismaService,
    @Inject(InventoryService) private readonly inventory: InventoryService
  ) {}

  private async audit(tx: any, userId: string, action: string, resourceType: string, resourceId: string, countryId: string, reason?: string) {
    await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES (gen_random_uuid(), ${userId}::uuid, 'USER'::"ActorType", ${action}, ${resourceType}, ${resourceId}::uuid, ${JSON.stringify({ countryId })}::jsonb, ${reason ?? null}, ${randomUUID()}::uuid)`;
  }
  private async outbox(tx: any, aggregateType: string, aggregateId: string, eventType: string, eventKey: string, countryId: string, data: Record<string, unknown>) {
    const occurredAt = new Date();
    await tx.outboxEvent.create({ data: { aggregateType, aggregateId, eventKey, eventType, occurredAt, payload: { schemaVersion: 1, eventKey, eventType, occurredAt: occurredAt.toISOString(), aggregateType, aggregateId, countryId, data } } });
  }
  private async lockCart(tx: any, userId: string, cartId: string) {
    const rows = await tx.$queryRaw`SELECT * FROM "Cart" WHERE "id"=${cartId}::uuid AND "userId"=${userId}::uuid FOR UPDATE`;
    const cart = (rows as any[])[0];
    if (!cart) throw new NotFoundException({ code: 'CART_NOT_FOUND', message: 'Cart not found' });
    return cart;
  }
  private async cartJson(tx: any, cart: any) {
    const items = await tx.$queryRaw`
      SELECT ci."id", ci."variantId", ci."storeId", ci."vendorId", ci."quantity",
             v."priceAmountMinor", v."currency", v."active", p."id" AS "productId", p."title", p."status" AS "productStatus",
             s."name" AS "storeName", i."onHand", i."reserved",
             gs_cart_variant_sellable(ci."variantId") AS "sellable"
      FROM "CartItem" ci
      JOIN "ProductVariant" v ON v."id"=ci."variantId"
      JOIN "Product" p ON p."id"=v."productId"
      JOIN "Store" s ON s."id"=ci."storeId"
      LEFT JOIN "Inventory" i ON i."variantId"=ci."variantId"
      WHERE ci."cartId"=${cart.id}::uuid
      ORDER BY ci."createdAt" ASC, ci."id" ASC`;
    // A buyer who reloads checkout loses the quote id from memory, but the quote
    // is still holding their stock. Surfacing it on the cart gives the UI a way to
    // show and release it. The error filter deliberately emits only
    // {code,message,requestId}, so this belongs on the resource, not in an error.
    const activeQuote = await tx.checkoutQuote.findFirst({
      where: { cartId: cart.id, state: 'RESERVED' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return {
      cartId: cart.id, countryId: cart.countryId, currency: cart.currency, version: cart.version,
      activeQuoteId: activeQuote?.id ?? null,
      items: (items as any[]).map(r => ({
        id: r.id, variantId: r.variantId, storeId: r.storeId, vendorId: r.vendorId, productId: r.productId,
        title: r.title, storeName: r.storeName, quantity: r.quantity,
        unitPriceMinor: r.priceAmountMinor.toString(), currency: r.currency,
        lineTotalMinor: (BigInt(r.priceAmountMinor) * BigInt(r.quantity)).toString(),
        availableToPromise: r.onHand === null ? 0 : Math.max(0, r.onHand - r.reserved),
        sellable: !!r.sellable
      }))
    };
  }
  private async quoteJson(tx: any, quote: any, duplicate = false) {
    const groups = await tx.checkoutQuoteGroup.findMany({ where: { quoteId: quote.id }, orderBy: [{ vendorId: 'asc' }, { storeId: 'asc' }] });
    const items = await tx.checkoutQuoteItem.findMany({ where: { quoteId: quote.id }, orderBy: [{ variantId: 'asc' }] });
    return {
      quoteId: quote.id, cartId: quote.cartId, cartVersion: quote.cartVersion, countryId: quote.countryId,
      destinationCityId: quote.destinationCityId, currency: quote.currency, state: quote.state,
      subtotalMinor: quote.subtotalMinor.toString(), version: quote.version,
      expiresAt: quote.expiresAt, closedAt: quote.closedAt, duplicate,
      deliveryFeeMinor: null, totalMinor: null, paymentStatus: 'NOT_IMPLEMENTED',
      groups: groups.map((g: any) => ({ groupId: g.id, vendorId: g.vendorId, storeId: g.storeId, currency: g.currency, subtotalMinor: g.subtotalMinor.toString() })),
      items: items.map((i: any) => ({
        itemId: i.id, groupId: i.groupId, reservationId: i.reservationId, variantId: i.variantId, productId: i.productId,
        productTitle: i.productTitle, sku: i.sku, quantity: i.quantity,
        unitPriceMinor: i.unitPriceMinor.toString(), lineTotalMinor: i.lineTotalMinor.toString(), currency: i.currency
      }))
    };
  }

  async createCart(ctx: AccessContext, countryId: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      // A unique constraint alone makes concurrent first requests race: both can
      // miss the row and one can fail on insert instead of returning the cart.
      // Normalize UUID case so equivalent IDs share a transaction-scoped lock.
      // This is coordination, not authorization; ownership checks remain required.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cart-create:${ctx.userId.toLowerCase()}:${countryId.toLowerCase()}`}, 0))`;
      const existing = await tx.cart.findUnique({ where: { userId_countryId: { userId: ctx.userId, countryId } } });
      if (existing) return { ...(await this.cartJson(tx, existing)), duplicate: true };
      const country = await tx.country.findFirst({ where: { id: countryId, status: 'ACTIVE' } });
      if (!country) throw new NotFoundException({ code: 'COUNTRY_NOT_AVAILABLE', message: 'Country is not available' });
      const cart = await tx.cart.create({ data: { userId: ctx.userId, countryId, currency: country.currencyCode } });
      await this.audit(tx, ctx.userId, 'commerce.cart.created', 'Cart', cart.id, countryId);
      await this.outbox(tx, 'Cart', cart.id, 'commerce.cart.created', `cart-created-${cart.id}`, countryId, { version: cart.version });
      return { ...(await this.cartJson(tx, cart)), duplicate: false };
    });
  }

  async getCart(ctx: AccessContext, cartId: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const cart = await tx.cart.findFirst({ where: { id: cartId, userId: ctx.userId } });
      if (!cart) throw new NotFoundException({ code: 'CART_NOT_FOUND', message: 'Cart not found' });
      return this.cartJson(tx, cart);
    });
  }

  async addItem(ctx: AccessContext, cartId: string, input: { variantId: string; quantity: number; expectedVersion: number }) {
    assertVersion(input.expectedVersion);
    try { assertCartQuantity(input.quantity); } catch (e: any) { throw new BadRequestException({ code: e.message ?? 'CART_QUANTITY_INVALID', message: 'Invalid cart quantity' }); }
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const cart = await this.lockCart(tx, ctx.userId, cartId);
      if (cart.version !== input.expectedVersion) throw new ConflictException({ code: 'CART_VERSION_CONFLICT', message: 'Cart version conflict' });
      const rows = await tx.$queryRaw`SELECT v."id", v."active", p."storeId", p."vendorId", p."countryId", gs_cart_variant_sellable(v."id") AS sellable FROM "ProductVariant" v JOIN "Product" p ON p."id"=v."productId" WHERE v."id"=${input.variantId}::uuid`;
      const variant = (rows as any[])[0];
      if (!variant) throw new NotFoundException({ code: 'CART_VARIANT_NOT_FOUND', message: 'Variant not found' });
      if (variant.countryId !== cart.countryId) throw new ConflictException({ code: 'CART_COUNTRY_MISMATCH', message: 'Variant country does not match cart' });
      if (!variant.sellable) throw new ConflictException({ code: 'CART_VARIANT_NOT_SELLABLE', message: 'Variant is not sellable' });
      const existing = await tx.cartItem.findUnique({ where: { cartId_variantId: { cartId, variantId: input.variantId } } });
      if (existing) {
        const quantity = existing.quantity + input.quantity;
        try { assertCartQuantity(quantity); } catch { throw new ConflictException({ code: 'CART_QUANTITY_LIMIT', message: 'Cart line quantity limit exceeded' }); }
        await tx.cartItem.update({ where: { id: existing.id }, data: { quantity } });
      } else {
        const count = await tx.cartItem.count({ where: { cartId } });
        try { assertCartItemCount(count + 1); } catch { throw new ConflictException({ code: 'CART_ITEM_LIMIT', message: 'Cart item limit exceeded' }); }
        await tx.cartItem.create({ data: { cartId, variantId: input.variantId, storeId: variant.storeId, vendorId: variant.vendorId, countryId: variant.countryId, quantity: input.quantity } });
      }
      const updated = (await tx.cart.findUnique({ where: { id: cartId } }))!;
      await this.audit(tx, ctx.userId, 'commerce.cart.item.added', 'Cart', cartId, cart.countryId);
      await this.outbox(tx, 'Cart', cartId, 'commerce.cart.item.added', `cart-item-added-${cartId}-${updated.version}`, cart.countryId, { variantId: input.variantId, quantity: input.quantity, version: updated.version });
      return this.cartJson(tx, updated);
    });
  }

  async updateItem(ctx: AccessContext, cartId: string, variantId: string, input: { quantity: number; expectedVersion: number }) {
    assertVersion(input.expectedVersion);
    try { assertCartQuantity(input.quantity); } catch (e: any) { throw new BadRequestException({ code: e.message ?? 'CART_QUANTITY_INVALID', message: 'Invalid cart quantity' }); }
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const cart = await this.lockCart(tx, ctx.userId, cartId);
      if (cart.version !== input.expectedVersion) throw new ConflictException({ code: 'CART_VERSION_CONFLICT', message: 'Cart version conflict' });
      const item = await tx.cartItem.findUnique({ where: { cartId_variantId: { cartId, variantId } } });
      if (!item) throw new NotFoundException({ code: 'CART_ITEM_NOT_FOUND', message: 'Cart item not found' });
      await tx.cartItem.update({ where: { id: item.id }, data: { quantity: input.quantity } });
      const updated = (await tx.cart.findUnique({ where: { id: cartId } }))!;
      await this.audit(tx, ctx.userId, 'commerce.cart.item.updated', 'Cart', cartId, cart.countryId);
      await this.outbox(tx, 'Cart', cartId, 'commerce.cart.item.updated', `cart-item-updated-${cartId}-${updated.version}`, cart.countryId, { variantId, quantity: input.quantity, version: updated.version });
      return this.cartJson(tx, updated);
    });
  }

  async removeItem(ctx: AccessContext, cartId: string, variantId: string, expectedVersion: number) {
    assertVersion(expectedVersion);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const cart = await this.lockCart(tx, ctx.userId, cartId);
      if (cart.version !== expectedVersion) throw new ConflictException({ code: 'CART_VERSION_CONFLICT', message: 'Cart version conflict' });
      const item = await tx.cartItem.findUnique({ where: { cartId_variantId: { cartId, variantId } } });
      if (!item) throw new NotFoundException({ code: 'CART_ITEM_NOT_FOUND', message: 'Cart item not found' });
      await tx.cartItem.delete({ where: { id: item.id } });
      const updated = (await tx.cart.findUnique({ where: { id: cartId } }))!;
      await this.audit(tx, ctx.userId, 'commerce.cart.item.removed', 'Cart', cartId, cart.countryId);
      await this.outbox(tx, 'Cart', cartId, 'commerce.cart.item.removed', `cart-item-removed-${cartId}-${updated.version}`, cart.countryId, { variantId, version: updated.version });
      return this.cartJson(tx, updated);
    });
  }

  async createQuote(ctx: AccessContext, cartId: string, input: { expectedVersion: number; destinationCityId: string; commandKey: string; ttlSeconds?: number }) {
    assertVersion(input.expectedVersion); assertCommandKey(input.commandKey);
    const ttlSeconds = input.ttlSeconds ?? 900;
    const payloadHash = hashPayload({ cartId, cartVersion: input.expectedVersion, destinationCityId: input.destinationCityId, ttlSeconds });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      // Serialize this buyer's quote creations before the idempotency lookup.
      // Otherwise two transactions can both see no command and the second can
      // fail after waiting on the cart, rather than replaying the first quote.
      // A per-buyer lock also protects the active-quote limit across their carts.
      // The namespace and 64-bit hash only identify a lock, not authorization.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`checkout-quote-create:${ctx.userId}`}, 0))`;
      const existing = await tx.checkoutQuote.findUnique({ where: { userId_commandKey: { userId: ctx.userId, commandKey: input.commandKey } } });
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new ConflictException({ code: 'CHECKOUT_IDEMPOTENCY_CONFLICT', message: 'Checkout command key already used with different payload' });
        return this.quoteJson(tx, existing, true);
      }
      const cart = await this.lockCart(tx, ctx.userId, cartId);
      if (cart.version !== input.expectedVersion) throw new ConflictException({ code: 'CHECKOUT_CART_VERSION_CONFLICT', message: 'Cart changed; refresh before quoting' });
      const reservedForCart = await tx.checkoutQuote.findFirst({ where: { cartId, cartVersion: cart.version, state: 'RESERVED' } });
      if (reservedForCart) throw new ConflictException({ code: 'CHECKOUT_QUOTE_ALREADY_RESERVED', message: 'A reserved quote already exists for this cart version; release or expire it first' });
      const activeCount = await tx.checkoutQuote.count({ where: { userId: ctx.userId, state: 'RESERVED' } });
      if (activeCount >= MAX_ACTIVE_QUOTES_PER_USER) throw new ConflictException({ code: 'CHECKOUT_ACTIVE_QUOTE_LIMIT', message: 'Active quote limit reached' });
      const cartItems = await tx.cartItem.findMany({ where: { cartId }, orderBy: { variantId: 'asc' } });
      if (!cartItems.length) throw new ConflictException({ code: 'CART_EMPTY', message: 'Cart is empty' });
      if (cartItems.length > MAX_CART_ITEMS) throw new ConflictException({ code: 'CART_ITEM_LIMIT', message: 'Cart item limit exceeded' });

      // The destination must actually be served before any stock is reserved.
      // Without this check any well-formed UUID was accepted, so a buyer could
      // reserve inventory against a non-existent, inactive or foreign city, or
      // against a city none of the cart's stores can deliver to.
      const storeIds = [...new Set(cartItems.map(item => item.storeId))];
      const serviceableStores = await tx.store.findMany({
        where: {
          ...serviceableStoreWhere(cart.countryId, new Date()),
          id: { in: storeIds },
          cityId: input.destinationCityId,
        },
        select: { id: true },
      });
      if (serviceableStores.length !== storeIds.length) {
        throw new ConflictException({
          code: 'CHECKOUT_DESTINATION_NOT_SERVICEABLE',
          message: 'The destination city is not served by every store in this cart',
        });
      }

      const quoteId = randomUUID();
      const priced: QuotePricedItem[] = [];
      const reservations = new Map<string, { reservationId: string; expiresAt: Date }>();
      for (const item of cartItems) {
        const reservation = await this.inventory.reserveStockTx(tx, { userId: ctx.userId, variantId: item.variantId, quantity: item.quantity, commandKey: `quote:${quoteId}:${item.variantId}`, ttlSeconds });
        reservations.set(item.variantId, { reservationId: reservation.reservationId, expiresAt: reservation.expiresAt });
        const rows = await tx.$queryRaw`SELECT v."priceAmountMinor", v."currency", p."id" AS "productId", p."title", v."sku" FROM "ProductVariant" v JOIN "Product" p ON p."id"=v."productId" WHERE v."id"=${item.variantId}::uuid`;
        const snapshot = (rows as any[])[0];
        priced.push({ variantId: item.variantId, vendorId: item.vendorId, storeId: item.storeId, currency: snapshot.currency, quantity: item.quantity, unitPriceMinor: BigInt(snapshot.priceAmountMinor) });
      }
      const totals = groupQuoteItems(priced);
      const expiresAt = new Date(Math.min(...[...reservations.values()].map(r => r.expiresAt.getTime())));
      const quote = await tx.checkoutQuote.create({ data: { id: quoteId, userId: ctx.userId, countryId: cart.countryId, cartId, cartVersion: cart.version, destinationCityId: input.destinationCityId, commandKey: input.commandKey, payloadHash, currency: totals.currency, subtotalMinor: totals.subtotalMinor, expiresAt } });
      const groupIds = new Map<string, string>();
      for (const group of totals.groups) {
        const created = await tx.checkoutQuoteGroup.create({ data: { quoteId, vendorId: group.vendorId, storeId: group.storeId, currency: group.currency, subtotalMinor: group.subtotalMinor } });
        groupIds.set(`${group.vendorId}:${group.storeId}`, created.id);
      }
      for (const item of priced) {
        const snapshotRows = await tx.$queryRaw`SELECT p."id" AS "productId", p."title", v."sku" FROM "ProductVariant" v JOIN "Product" p ON p."id"=v."productId" WHERE v."id"=${item.variantId}::uuid`;
        const snapshot = (snapshotRows as any[])[0];
        const reservation = reservations.get(item.variantId)!;
        await tx.checkoutQuoteItem.create({ data: { quoteId, groupId: groupIds.get(`${item.vendorId}:${item.storeId}`)!, reservationId: reservation.reservationId, variantId: item.variantId, productId: snapshot.productId, productTitle: snapshot.title, sku: snapshot.sku, quantity: item.quantity, unitPriceMinor: item.unitPriceMinor, lineTotalMinor: item.unitPriceMinor * BigInt(item.quantity), currency: item.currency } });
      }
      await this.audit(tx, ctx.userId, 'commerce.checkout.quote.created', 'CheckoutQuote', quoteId, cart.countryId);
      await this.outbox(tx, 'CheckoutQuote', quoteId, 'commerce.checkout.quote.created', `checkout-quote-created-${quoteId}`, cart.countryId, { cartId, cartVersion: cart.version, subtotalMinor: totals.subtotalMinor.toString(), groupCount: totals.groups.length });
      return this.quoteJson(tx, quote, false);
    }, { timeout: 30000 });
  }

  async getQuote(ctx: AccessContext, quoteId: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const quote = await tx.checkoutQuote.findFirst({ where: { id: quoteId, userId: ctx.userId } });
      if (!quote) throw new NotFoundException({ code: 'CHECKOUT_QUOTE_NOT_FOUND', message: 'Checkout quote not found' });
      return this.quoteJson(tx, quote);
    });
  }

  async releaseQuote(ctx: AccessContext, quoteId: string, input: { version: number; reason: string }) {
    assertVersion(input.version);
    const reason = input.reason?.trim();
    if (!reason || reason.length < 8 || reason.length > 512) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'A reason is required' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rows = await tx.$queryRaw`SELECT * FROM "CheckoutQuote" WHERE "id"=${quoteId}::uuid AND "userId"=${ctx.userId}::uuid FOR UPDATE`;
      const quote = (rows as any[])[0];
      if (!quote) throw new NotFoundException({ code: 'CHECKOUT_QUOTE_NOT_FOUND', message: 'Checkout quote not found' });
      if (quote.state !== 'RESERVED') return this.quoteJson(tx, quote, true);
      if (quote.version !== input.version) throw new ConflictException({ code: 'CHECKOUT_QUOTE_VERSION_CONFLICT', message: 'Quote version conflict' });
      const items = await tx.checkoutQuoteItem.findMany({ where: { quoteId }, orderBy: { variantId: 'asc' } });
      const closed = await tx.checkoutQuote.update({ where: { id: quoteId }, data: { state: 'RELEASED', closedAt: new Date(), version: { increment: 1 } } });
      for (const item of items) await this.inventory.closeReservationTx(tx, item.reservationId, 'RELEASED', ctx.userId, reason);
      await this.audit(tx, ctx.userId, 'commerce.checkout.quote.released', 'CheckoutQuote', quoteId, quote.countryId, reason);
      await this.outbox(tx, 'CheckoutQuote', quoteId, 'commerce.checkout.quote.released', `checkout-quote-released-${quoteId}`, quote.countryId, { version: closed.version });
      return this.quoteJson(tx, closed, false);
    }, { timeout: 30000 });
  }
}
