import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { decryptJson, encryptJson } from '@getstoopy/bff';
import { assertLatitudeLongitude, normalizeRecipientPhone, type AccessContext } from '@getstoopy/core';
import type { ApiEnv } from '@getstoopy/config';
import { ENV } from '../common/env.js';
import { PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { CommerceService } from './commerce.service.js';
import { GoogleRoutesRoadRouteMatrix } from '../dispatch/road-route.adapter.js';

type DraftInput = { expectedVersion: number; expectedDraftVersion: number; serviceZoneId: string; boundaryVersionId: string; latitude: number; longitude: number; name: string; phone: string; addressLine: string };
type DraftEnvelope = { cartId: string; userId: string; cartVersion: number; serviceZoneId: string; boundaryVersionId: string; latitude: number; longitude: number; name: string; phone: string; addressLine: string };
const TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class RecipientDraftService {
  constructor(@Inject(PrivilegedPrismaService) private readonly db: PrivilegedPrismaService, @Inject(ENV) private readonly env: ApiEnv, @Inject(CommerceService) private readonly commerce: CommerceService) {}

  private enabled(): void {
    // No real user data until automatic retention, key lifecycle and privacy
    // controls have been reviewed. This path is explicitly test-only.
    if (this.env.NODE_ENV !== 'test') throw new ServiceUnavailableException({ code: 'CHECKOUT_DRAFT_DISABLED', message: 'Recipient drafts are not enabled' });
  }
  private key(): string {
    this.enabled();
    if (!this.env.CHECKOUT_RECIPIENT_DRAFT_KEY) throw new ServiceUnavailableException({ code: 'CHECKOUT_DRAFT_DISABLED', message: 'Recipient drafts are not enabled' });
    return this.env.CHECKOUT_RECIPIENT_DRAFT_KEY;
  }
  private version(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647) throw new BadRequestException({ code: 'DRAFT_VERSION_INVALID', message: 'Invalid draft version' });
  }
  private async cart(tx: any, ctx: AccessContext, cartId: string, lock: boolean) {
    const rows = lock
      ? await tx.$queryRaw`SELECT "id","userId","countryId","version" FROM "Cart" WHERE "id"=${cartId}::uuid AND "userId"=${ctx.userId}::uuid FOR UPDATE`
      : await tx.$queryRaw`SELECT "id","userId","countryId","version" FROM "Cart" WHERE "id"=${cartId}::uuid AND "userId"=${ctx.userId}::uuid`;
    const cart = (rows as any[])[0];
    if (!cart) throw new NotFoundException({ code: 'CART_NOT_FOUND', message: 'Cart not found' });
    return cart;
  }
  private async now(tx: any): Promise<Date> { const rows = await tx.$queryRaw`SELECT gs_dispatch_now() AS now`; return new Date((rows as any[])[0].now); }
  private async audit(tx: any, ctx: AccessContext, cart: { id: string; countryId: string }, action: string) {
    await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType","sessionId",action,"resourceType","resourceId","scopeSnapshot","requestId") VALUES (gen_random_uuid(), ${ctx.userId}::uuid, 'USER'::"ActorType", ${ctx.sessionId}::uuid, ${action}, 'Cart', ${cart.id}::uuid, ${JSON.stringify({ countryId: cart.countryId })}::jsonb, ${randomUUID()}::uuid)`;
  }
  private decrypt(envelope: Uint8Array, key: string, cart: { id: string; userId: string }): DraftEnvelope {
    try {
      const data = decryptJson<DraftEnvelope>(Buffer.from(envelope).toString('utf8'), key);
      if (!data || data.cartId !== cart.id || data.userId !== cart.userId || !Number.isSafeInteger(data.cartVersion) || data.cartVersion < 1 || typeof data.name !== 'string' || typeof data.phone !== 'string' || typeof data.addressLine !== 'string' || !/^[0-9a-f-]{36}$/.test(data.serviceZoneId) || !/^[0-9a-f-]{36}$/.test(data.boundaryVersionId)) throw new Error('INVALID_DRAFT');
      assertLatitudeLongitude(data.latitude, data.longitude);
      return data;
    } catch {
      throw new ServiceUnavailableException({ code: 'CHECKOUT_DRAFT_UNREADABLE', message: 'Recipient draft is unavailable' });
    }
  }

  async save(ctx: AccessContext, cartId: string, input: DraftInput) {
    const key = this.key(); this.version(input.expectedDraftVersion);
    // This validates contact and current coverage, but is only a preview: it is
    // not a guarantee and is not bound to quote creation. Recheck cart version
    // under lock before saving to avoid saving for a changed cart.
    await this.commerce.previewDelivery(ctx, cartId, input);
    return this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const cart = await this.cart(tx, ctx, cartId, true);
      if (cart.version !== input.expectedVersion) throw new ConflictException({ code: 'CHECKOUT_CART_VERSION_CONFLICT', message: 'Cart changed; refresh before saving' });
      const existing = await tx.checkoutRecipientDraft.findUnique({ where: { cartId: cart.id } });
      if ((existing?.version ?? 0) !== input.expectedDraftVersion) throw new ConflictException({ code: 'CHECKOUT_DRAFT_VERSION_CONFLICT', message: 'Recipient draft changed; reload before saving' });
      const country = await tx.country.findUniqueOrThrow({ where: { id: cart.countryId } });
      let phone: string;
      try { phone = normalizeRecipientPhone(input.phone, country.callingCode); } catch { throw new BadRequestException({ code: 'RECIPIENT_PHONE_INVALID', message: 'Recipient phone is invalid' }); }
      const data: DraftEnvelope = { cartId: cart.id, userId: cart.userId, cartVersion: cart.version, serviceZoneId: input.serviceZoneId.toLowerCase(), boundaryVersionId: input.boundaryVersionId.toLowerCase(), latitude: input.latitude, longitude: input.longitude, name: input.name.trim(), phone, addressLine: input.addressLine.trim() };
      const envelope = Buffer.from(encryptJson(data, key));
      const expiresAt = new Date((await this.now(tx)).getTime() + TTL_MS);
      const saved = existing
        ? await tx.checkoutRecipientDraft.update({ where: { cartId: cart.id }, data: { envelope, expiresAt, version: { increment: 1 } } })
        : await tx.checkoutRecipientDraft.create({ data: { cartId: cart.id, envelope, expiresAt } });
      await this.audit(tx, ctx, cart, 'commerce.checkout.recipient_draft.saved');
      return { cartId: cart.id, draftVersion: saved.version, expiresAt: saved.expiresAt, state: 'DRAFT', quoteBound: false, coverageGuaranteed: false };
    });
  }

  async read(ctx: AccessContext, cartId: string) {
    const key = this.key();
    return this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const cart = await this.cart(tx, ctx, cartId, false);
      const row = await tx.checkoutRecipientDraft.findUnique({ where: { cartId: cart.id } });
      if (!row || !row.envelope) return { cartId: cart.id, draftVersion: row?.version ?? 0, state: 'EMPTY', draft: null };
      if (!row.expiresAt || row.expiresAt <= await this.now(tx)) return { cartId: cart.id, draftVersion: row.version, state: 'EXPIRED', draft: null };
      const data = this.decrypt(row.envelope, key, cart);
      // Decryption and validation may cross the logical expiry boundary. Match
      // saved preview: recheck database wall time before returning contact data.
      if (row.expiresAt <= await this.now(tx)) return { cartId: cart.id, draftVersion: row.version, state: 'EXPIRED', draft: null };
      return { cartId: cart.id, draftVersion: row.version, state: 'DRAFT', expiresAt: row.expiresAt, draft: { cartVersion: data.cartVersion, serviceZoneId: data.serviceZoneId, boundaryVersionId: data.boundaryVersionId, latitude: data.latitude, longitude: data.longitude, name: data.name, phone: data.phone, addressLine: data.addressLine }, quoteBound: false, coverageGuaranteed: false };
    }, { isolationLevel: 'RepeatableRead' });
  }

  /** Revalidate the saved draft and cart in one consistent, read-only snapshot. */
  async previewSaved(ctx: AccessContext, cartId: string, input: { expectedVersion: number; expectedDraftVersion: number }) {
    const key = this.key(); this.version(input.expectedDraftVersion);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || input.expectedVersion > 2147483647) throw new BadRequestException({ code: 'VERSION_INVALID', message: 'Invalid cart version' });
    return this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const cart = await this.cart(tx, ctx, cartId, false);
      if (cart.version !== input.expectedVersion) throw new ConflictException({ code: 'CHECKOUT_CART_VERSION_CONFLICT', message: 'Cart changed; refresh before checking delivery' });
      const row = await tx.checkoutRecipientDraft.findUnique({ where: { cartId: cart.id } });
      if ((row?.version ?? 0) !== input.expectedDraftVersion) throw new ConflictException({ code: 'CHECKOUT_DRAFT_VERSION_CONFLICT', message: 'Recipient draft changed; reload before checking delivery' });
      if (!row?.envelope) throw new ConflictException({ code: 'CHECKOUT_DRAFT_REQUIRED', message: 'Save a recipient draft before checking delivery' });
      if (!row.expiresAt || row.expiresAt <= await this.now(tx)) throw new ConflictException({ code: 'CHECKOUT_DRAFT_EXPIRED', message: 'Recipient draft has expired' });
      const data = this.decrypt(row.envelope, key, cart);
      if (data.cartVersion !== cart.version) throw new ConflictException({ code: 'CHECKOUT_DRAFT_CART_CHANGED', message: 'Cart changed since the recipient draft was saved' });
      const result = await this.commerce.previewDeliveryTx(tx, ctx, cart.id, { ...data, expectedVersion: cart.version });
      // Use wall-clock expiry again in case the preview took a long time.
      if (row.expiresAt <= await this.now(tx)) throw new ConflictException({ code: 'CHECKOUT_DRAFT_EXPIRED', message: 'Recipient draft has expired' });
      return { ...result, recipientSaved: true, draftVersion: row.version, quoteBound: false, coverageGuaranteed: false };
    }, { isolationLevel: 'RepeatableRead' });
  }

  /**
   * Synthetic test-only road-distance preview. One independent route per store,
   * not a multi-stop itinerary, map polyline, price or delivery guarantee.
   * The only permitted provider is an explicitly configured local HTTP stub.
   */
  async previewRoadDistances(ctx: AccessContext, cartId: string, input: { expectedVersion: number; expectedDraftVersion: number }) {
    const key = this.key();
    this.version(input.expectedDraftVersion);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || input.expectedVersion > 2147483647) throw new BadRequestException({ code: 'VERSION_INVALID', message: 'Invalid cart version' });
    if (input.expectedDraftVersion < 1) throw new BadRequestException({ code: 'DRAFT_VERSION_INVALID', message: 'Invalid draft version' });
    let origin: string;
    try {
      const url = new URL(this.env.GOOGLE_ROUTES_BASE_URL);
      if (!this.env.ROAD_ROUTING_ENABLED || this.env.ROAD_ROUTING_PROVIDER !== 'google_routes' || !this.env.GOOGLE_ROUTES_API_KEY || url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('invalid stub');
      origin = url.origin;
    } catch { throw new ServiceUnavailableException({ code: 'CHECKOUT_ROUTE_PREVIEW_DISABLED', message: 'Road distance preview is not available' }); }

    const snapshot = async () => this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const cart = await this.cart(tx, ctx, cartId, false);
      if (cart.version !== input.expectedVersion) throw new ConflictException({ code: 'CHECKOUT_CART_VERSION_CONFLICT', message: 'Cart changed; refresh before checking delivery' });
      const row = await tx.checkoutRecipientDraft.findUnique({ where: { cartId: cart.id } });
      if ((row?.version ?? 0) !== input.expectedDraftVersion) throw new ConflictException({ code: 'CHECKOUT_DRAFT_VERSION_CONFLICT', message: 'Recipient draft changed; reload before checking delivery' });
      if (!row?.envelope) throw new ConflictException({ code: 'CHECKOUT_DRAFT_REQUIRED', message: 'Save a recipient draft before checking delivery' });
      if (!row.expiresAt || row.expiresAt <= await this.now(tx)) throw new ConflictException({ code: 'CHECKOUT_DRAFT_EXPIRED', message: 'Recipient draft has expired' });
      const data = this.decrypt(row.envelope, key, cart);
      if (data.cartVersion !== cart.version) throw new ConflictException({ code: 'CHECKOUT_DRAFT_CART_CHANGED', message: 'Cart changed since the recipient draft was saved' });
      const coverage = await this.commerce.previewDeliveryTx(tx, ctx, cart.id, { ...data, expectedVersion: cart.version });
      const items = await tx.cartItem.findMany({ where: { cartId: cart.id }, select: { storeId: true } });
      const storeIds = [...new Set(items.map(item => item.storeId))].sort();
      // Provider matrix supports at most 25 origins; never truncate a cart.
      if (!storeIds.length || storeIds.length > 25) throw new ConflictException({ code: 'CHECKOUT_ROUTE_STORE_LIMIT', message: 'Road distance preview is unavailable for this cart' });
      const points = await tx.$queryRaw<{ storeId: string; version: number; latitude: number; longitude: number }[]>`
        SELECT "storeId", version, ST_Y("pickupPoint") AS latitude, ST_X("pickupPoint") AS longitude
        FROM "StorePickupPoint" WHERE "storeId"=ANY(${storeIds}::uuid[]) AND status='APPROVED' ORDER BY "storeId"`;
      if (points.length !== storeIds.length || points.some((point, i) => point.storeId !== storeIds[i])) throw new ConflictException({ code: 'CHECKOUT_ROUTE_PICKUP_REQUIRED', message: 'Approved pickup points are required' });
      for (const point of points) {
        try { assertLatitudeLongitude(point.latitude, point.longitude); } catch { throw new ConflictException({ code: 'CHECKOUT_ROUTE_PICKUP_REQUIRED', message: 'Approved pickup points are required' }); }
      }
      if (row.expiresAt <= await this.now(tx)) throw new ConflictException({ code: 'CHECKOUT_DRAFT_EXPIRED', message: 'Recipient draft has expired' });
      return { cartId: cart.id, cartVersion: cart.version, draftVersion: row.version, expiresAt: row.expiresAt.toISOString(), serviceZoneId: coverage.serviceZoneId, boundaryVersionId: coverage.boundaryVersionId, destination: { latitude: data.latitude, longitude: data.longitude }, points };
    }, { isolationLevel: 'RepeatableRead' });

    const before = await snapshot();
    let elements;
    try {
      const provider = new GoogleRoutesRoadRouteMatrix({ apiKey: this.env.GOOGLE_ROUTES_API_KEY!, baseUrl: origin, testMode: true });
      const result = await provider.computeMatrix({ origins: before.points.map(({ latitude, longitude }) => ({ latitude, longitude })), destinations: [before.destination], travelMode: 'TWO_WHEELER' });
      elements = result.elements;
    } catch { throw new ServiceUnavailableException({ code: 'CHECKOUT_ROUTE_PREVIEW_UNAVAILABLE', message: 'Road distance preview is unavailable' }); }
    // The provider call occurs outside a DB transaction. Recheck the saved
    // draft, cart, coverage and pickup points, but do not claim future validity.
    const after = await snapshot();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new ConflictException({ code: 'CHECKOUT_ROUTE_PREVIEW_CHANGED', message: 'Delivery details changed; retry the preview' });
    const distances = before.points.map((point, i) => ({ storeId: point.storeId, distanceMeters: elements.find(element => element.originIndex === i && element.destinationIndex === 0)!.distanceMeters }));
    return { cartId: before.cartId, cartVersion: before.cartVersion, draftVersion: before.draftVersion, mode: 'TEST_ONLY', routeType: 'INDIVIDUAL_STORE_TO_DESTINATION', distances, quoteBound: false, coverageGuaranteed: false, orderAvailable: false, deliveryFeeMinor: null, totalMinor: null };
  }

  async clear(ctx: AccessContext, cartId: string, expectedDraftVersion: number) {
    this.enabled(); this.version(expectedDraftVersion);
    return this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const cart = await this.cart(tx, ctx, cartId, true);
      const row = await tx.checkoutRecipientDraft.findUnique({ where: { cartId: cart.id } });
      if ((row?.version ?? 0) !== expectedDraftVersion) throw new ConflictException({ code: 'CHECKOUT_DRAFT_VERSION_CONFLICT', message: 'Recipient draft changed; reload before clearing' });
      if (!row || !row.envelope) return { cartId: cart.id, draftVersion: row?.version ?? 0, state: 'EMPTY' };
      const cleared = await tx.checkoutRecipientDraft.update({ where: { cartId: cart.id }, data: { envelope: null, expiresAt: null, version: { increment: 1 } } });
      await this.audit(tx, ctx, cart, 'commerce.checkout.recipient_draft.cleared');
      return { cartId: cart.id, draftVersion: cleared.version, state: 'EMPTY' };
    });
  }
}
