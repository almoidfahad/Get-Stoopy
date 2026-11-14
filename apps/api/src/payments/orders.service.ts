import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { ApiEnv } from '@getstoopy/config';
import { ENV } from '../common/env.js';
import { PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { RiskSignalProducerService } from '../risk/risk-signal-producer.service.js';
import type { AccessContext } from '@getstoopy/core';

function hashPayload(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function reference(prefix: string): string { return `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 24).toUpperCase()}`; }

@Injectable()
export class OrdersService {
  constructor(@Inject(PrivilegedPrismaService) private readonly privileged: PrivilegedPrismaService, @Inject(InventoryService) private readonly inventory: InventoryService, @Inject(RiskSignalProducerService) private readonly riskSignals: RiskSignalProducerService, @Inject(ENV) private readonly env: ApiEnv) {}

  private async audit(tx: any, userId: string, action: string, resourceId: string, countryId: string, reason?: string) {
    await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES (gen_random_uuid(), ${userId}::uuid, 'USER'::"ActorType", ${action}, 'Order', ${resourceId}::uuid, ${JSON.stringify({ countryId })}::jsonb, ${reason ?? null}, ${randomUUID()}::uuid)`;
  }
  private async outbox(tx: any, aggregateId: string, eventType: string, eventKey: string, countryId: string, data: Record<string, unknown>) {
    const occurredAt = new Date();
    await tx.outboxEvent.create({ data: { aggregateType: 'Order', aggregateId, eventKey, eventType, occurredAt, payload: { schemaVersion: 1, eventKey, eventType, occurredAt: occurredAt.toISOString(), aggregateType: 'Order', aggregateId, countryId, data } } });
  }
  private async orderJson(tx: any, order: any, duplicate = false) {
    const suborders = await tx.vendorSuborder.findMany({ where: { orderId: order.id }, orderBy: [{ vendorId: 'asc' }, { storeId: 'asc' }], include: { items: { orderBy: { variantId: 'asc' } } } });
    return {
      orderId: order.id, publicReference: order.publicReference, quoteId: order.quoteId, countryId: order.countryId,
      destinationCityId: order.destinationCityId, currency: order.currency, amountMinor: order.amountMinor.toString(),
      pricingScope: order.pricingScope, paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus, lifecycleStatus: order.lifecycleStatus,
      codEligibility: order.codEligibility, version: order.version, duplicate,
      cancellation: await (async () => { const c = await tx.orderCancellation.findUnique({ where: { orderId: order.id }, include: { refundRequest: true } }); return c ? { cancellationId: c.id, reason: c.reason, createdAt: c.createdAt, restock: 'COMPLETED', refund: c.refundRequest ? { refundRequestId: c.refundRequest.id, status: c.refundRequest.status, amountMinor: c.refundRequest.amountMinor.toString(), currency: c.refundRequest.currency, execution: 'DISABLED', moneyMoved: false } : null } : null; })(),
      deliveryFeeMinor: null, totalMinor: null,
      suborders: suborders.map((s: any) => ({
        suborderId: s.id, publicReference: s.publicReference, vendorId: s.vendorId, storeId: s.storeId,
        currency: s.currency, subtotalMinor: s.subtotalMinor.toString(), status: s.status, version: s.version,
        acceptedAt: s.acceptedAt, preparationMinutes: s.preparationMinutes, preparationStartedAt: s.preparationStartedAt,
        readyConfirmedAt: s.readyConfirmedAt, rejectedAt: s.rejectedAt, rejectionReason: s.rejectionReason,
        items: s.items.map((i: any) => ({ orderItemId: i.id, variantId: i.variantId, productId: i.productId, productTitle: i.productTitle, sku: i.sku, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor.toString(), lineTotalMinor: i.lineTotalMinor.toString(), currency: i.currency }))
      }))
    };
  }

  async createFromQuote(ctx: AccessContext, input: { quoteId: string; expectedQuoteVersion: number; commandKey: string; paymentMethod: 'SANDBOX_MANUAL' | 'COD' }) {
    // This order path only snapshots product subtotal and has no bound
    // recipient, delivery fee or total. A hidden UI is not a security boundary.
    // Keep the existing foundation usable only against disposable test data.
    if (this.env.NODE_ENV !== 'test') throw new ServiceUnavailableException({ code: 'ORDER_CREATION_DISABLED', message: 'Order creation is not available' });
    if (!/^[A-Za-z0-9:_-]{8,128}$/.test(input.commandKey)) throw new BadRequestException({ code: 'ORDER_COMMAND_KEY_INVALID', message: 'Invalid order command key' });
    if (!Number.isInteger(input.expectedQuoteVersion) || input.expectedQuoteVersion < 1) throw new BadRequestException({ code: 'VERSION_INVALID', message: 'Invalid quote version' });
    const payloadHash = hashPayload({ quoteId: input.quoteId, quoteVersion: input.expectedQuoteVersion, paymentMethod: input.paymentMethod });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      // Serialize this buyer's command key before the replay lookup. The quote
      // row lock alone cannot coordinate a key reused across different quotes,
      // and same-quote retries could otherwise miss the newly created order.
      // This transaction-scoped hash is coordination only, not authorization.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`order-create:${ctx.userId.toLowerCase()}:${input.commandKey}`}, 0))`;
      const existing = await tx.order.findUnique({ where: { buyerId_commandKey: { buyerId: ctx.userId, commandKey: input.commandKey } } });
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new ConflictException({ code: 'ORDER_IDEMPOTENCY_CONFLICT', message: 'Order command key already used with different payload' });
        return this.orderJson(tx, existing, true);
      }
      const rows = await tx.$queryRaw`SELECT * FROM "CheckoutQuote" WHERE "id"=${input.quoteId}::uuid AND "userId"=${ctx.userId}::uuid FOR UPDATE`;
      const quote = (rows as any[])[0];
      if (!quote) throw new NotFoundException({ code: 'CHECKOUT_QUOTE_NOT_FOUND', message: 'Checkout quote not found' });
      if (quote.state !== 'RESERVED') throw new ConflictException({ code: 'ORDER_QUOTE_NOT_CONSUMABLE', message: 'Quote is not reserved' });
      if (quote.version !== input.expectedQuoteVersion) throw new ConflictException({ code: 'ORDER_QUOTE_VERSION_CONFLICT', message: 'Quote version conflict' });
      if (quote.expiresAt <= new Date()) throw new ConflictException({ code: 'ORDER_QUOTE_EXPIRED', message: 'Quote expired' });
      let codEligibility: any = null;
      if (input.paymentMethod === 'COD') {
        // Lock the policy while deciding and creating the order. An admin may
        // disable COD or lower the cap concurrently; the immutable eligibility
        // snapshot and database insert guard must see the same policy version.
        const policies = await tx.$queryRaw`SELECT * FROM "CodPolicy" WHERE "countryId"=${quote.countryId}::uuid FOR UPDATE`;
        const policy = (policies as { id: string; enabled: boolean; maxOrderMinor: bigint; version: number }[])[0];
        if (!policy || !policy.enabled || BigInt(quote.subtotalMinor) > policy.maxOrderMinor) throw new ConflictException({ code: 'COD_NOT_ELIGIBLE', message: 'COD is not eligible for this order' });
        codEligibility = { policyId: policy.id, policyVersion: policy.version, maxOrderMinor: policy.maxOrderMinor.toString(), checkedAt: new Date().toISOString(), scope: 'PRODUCT_SUBTOTAL_ONLY' };
      }
      const orderId = randomUUID();
      const order = await tx.order.create({ data: { id: orderId, publicReference: reference('GS'), buyerId: ctx.userId, countryId: quote.countryId, destinationCityId: quote.destinationCityId, quoteId: quote.id, commandKey: input.commandKey, payloadHash, currency: quote.currency, amountMinor: quote.subtotalMinor, paymentMethod: input.paymentMethod, paymentStatus: input.paymentMethod === 'COD' ? 'AWAITING_COD' : 'AWAITING_PAYMENT', codEligibility } });
      const groups = await tx.checkoutQuoteGroup.findMany({ where: { quoteId: quote.id }, orderBy: [{ vendorId: 'asc' }, { storeId: 'asc' }] });
      const items = await tx.checkoutQuoteItem.findMany({ where: { quoteId: quote.id }, orderBy: { variantId: 'asc' } });
      const suborderIds = new Map<string, string>();
      for (const group of groups) {
        const suborder = await tx.vendorSuborder.create({ data: { publicReference: reference('SUB'), orderId, vendorId: group.vendorId, storeId: group.storeId, currency: group.currency, subtotalMinor: group.subtotalMinor } });
        suborderIds.set(group.id, suborder.id);
      }
      for (const item of items) {
        await tx.orderItem.create({ data: { suborderId: suborderIds.get(item.groupId)!, quoteItemId: item.id, variantId: item.variantId, productId: item.productId, productTitle: item.productTitle, sku: item.sku, quantity: item.quantity, unitPriceMinor: item.unitPriceMinor, lineTotalMinor: item.lineTotalMinor, currency: item.currency } });
      }
      for (const item of items) await this.inventory.closeReservationTx(tx, item.reservationId, 'CONSUMED', ctx.userId, 'order created from checkout quote');
      await this.audit(tx, ctx.userId, 'commerce.order.created', orderId, quote.countryId);
      await this.outbox(tx, orderId, 'commerce.order.created', `order-created-${orderId}`, quote.countryId, { quoteId: quote.id, paymentMethod: input.paymentMethod, amountMinor: order.amountMinor.toString(), suborderCount: groups.length });
      await this.riskSignals.orderCreated(tx, orderId);
      return this.orderJson(tx, order, false);
    }, { timeout: 30000 });
  }

  async get(ctx: AccessContext, orderId: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const order = await tx.order.findFirst({ where: { id: orderId, buyerId: ctx.userId } });
      if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
      return this.orderJson(tx, order);
    });
  }
}
