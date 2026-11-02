import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService, PrivilegedPrismaService, setRls } from '../common/prisma.js';
import {
  assertFulfillmentCommandKey,
  assertPreparationMinutes,
  assertRejectionReason,
  assertVendorManualReady,
  assertVendorReadinessTransition,
  authorize,
  type AccessContext
} from '@getstoopy/core';

export interface ReadinessCommandInput { expectedVersion: number; commandKey: string; }
export interface AcceptSuborderInput extends ReadinessCommandInput { preparationMinutes: number; }
export interface RejectSuborderInput extends ReadinessCommandInput { reason: string; }
type ReadinessAction = 'accept' | 'reject' | 'start-preparation' | 'ready';

function hashPayload(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function assertVersion(version: number): void {
  if (!Number.isInteger(version) || version < 1) throw new BadRequestException({ code: 'VERSION_INVALID', message: 'Invalid suborder version' });
}

@Injectable()
export class FulfillmentService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService, @Inject(PrivilegedPrismaService) private readonly privileged: PrivilegedPrismaService) {}

  private async audit(tx: any, ctx: AccessContext, action: string, resourceId: string, countryId: string, reason?: string) {
    await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType","sessionId",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES (gen_random_uuid(), ${ctx.userId}::uuid, 'USER'::"ActorType", ${ctx.sessionId}::uuid, ${action}, 'VendorSuborder', ${resourceId}::uuid, ${JSON.stringify({ countryId })}::jsonb, ${reason ?? null}, ${randomUUID()}::uuid)`;
  }
  private async outbox(tx: any, aggregateId: string, eventType: string, eventKey: string, countryId: string, data: Record<string, unknown>) {
    const occurredAt = new Date();
    await tx.outboxEvent.create({ data: { aggregateType: 'VendorSuborder', aggregateId, eventKey, eventType, occurredAt, payload: { schemaVersion: 1, eventKey, eventType, occurredAt: occurredAt.toISOString(), aggregateType: 'VendorSuborder', aggregateId, countryId, data } } });
  }
  private deny(decision: { allow: boolean; reason?: string }) {
    if (decision.allow) return;
    if (decision.reason === 'GEOGRAPHIC_SCOPE_DENIED') throw new NotFoundException({ code: 'SUBORDER_NOT_FOUND', message: 'Suborder not found' });
    throw new ForbiddenException({ code: decision.reason ?? 'PERMISSION_DENIED', message: 'Vendor order permission denied' });
  }
  private permission(ctx: AccessContext, vendorId: string, countryId: string, storeId: string, permission: string) {
    this.deny(authorize(ctx, permission, { vendorId, countryId, storeId }, { allowVendor: true }));
  }
  private assertMembership(ctx: AccessContext, vendorId: string, countryId: string, storeId: string) {
    const member = ctx.vendorMemberships.some(m => m.vendorId === vendorId && m.countryId === countryId && (!m.storeId || m.storeId === storeId));
    if (!member) throw new NotFoundException({ code: 'SUBORDER_NOT_FOUND', message: 'Suborder not found' });
  }
  private transition(from: string, to: string) {
    try { assertVendorReadinessTransition(from, to); } catch (e: any) { throw new ConflictException({ code: 'SUBORDER_INVALID_TRANSITION', message: e.message ?? 'Invalid suborder transition' }); }
  }
  private suborderJson(s: any, duplicate = false) {
    return {
      suborderId: s.id, publicReference: s.publicReference, orderId: s.orderId, vendorId: s.vendorId, storeId: s.storeId,
      currency: s.currency, subtotalMinor: s.subtotalMinor.toString(), status: s.status, version: s.version,
      acceptedAt: s.acceptedAt, preparationMinutes: s.preparationMinutes, preparationStartedAt: s.preparationStartedAt,
      readyConfirmedAt: s.readyConfirmedAt, rejectedAt: s.rejectedAt, rejectionReason: s.rejectionReason,
      createdAt: s.createdAt, updatedAt: s.updatedAt, duplicate
    };
  }
  private async lockSuborder(tx: any, suborderId: string) {
    const rows = await tx.$queryRaw`
      SELECT s.*, o."countryId", o."paymentStatus", o."publicReference" AS "orderPublicReference"
      FROM "VendorSuborder" s JOIN "Order" o ON o."id" = s."orderId"
      WHERE s."id" = ${suborderId}::uuid FOR UPDATE OF s`;
    const suborder = (rows as any[])[0];
    if (!suborder) throw new NotFoundException({ code: 'SUBORDER_NOT_FOUND', message: 'Suborder not found' });
    return suborder;
  }
  private async assertPaymentReady(suborder: any) {
    if (!['PAYMENT_VERIFIED', 'AWAITING_COD'].includes(suborder.paymentStatus)) {
      throw new ConflictException({ code: 'SUBORDER_PAYMENT_NOT_READY', message: 'Order payment is not verified or COD' });
    }
  }

  async get(ctx: AccessContext, suborderId: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const suborder = await tx.vendorSuborder.findUnique({ where: { id: suborderId }, include: { items: { orderBy: { variantId: 'asc' } }, order: { select: { publicReference: true, paymentStatus: true, countryId: true } } } });
      if (!suborder) throw new NotFoundException({ code: 'SUBORDER_NOT_FOUND', message: 'Suborder not found' });
      this.assertMembership(ctx, suborder.vendorId, suborder.order.countryId, suborder.storeId);
      this.permission(ctx, suborder.vendorId, suborder.order.countryId, suborder.storeId, 'vendor:order:read');
      return {
        ...this.suborderJson(suborder), orderPublicReference: suborder.order.publicReference, paymentStatus: suborder.order.paymentStatus,
        items: suborder.items.map((i: any) => ({ orderItemId: i.id, variantId: i.variantId, productId: i.productId, productTitle: i.productTitle, sku: i.sku, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor.toString(), lineTotalMinor: i.lineTotalMinor.toString(), currency: i.currency }))
      };
    });
  }

  async listByStore(ctx: AccessContext, storeId: string, input: { status?: string; limit: number; cursor?: string }) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const store = await tx.store.findUnique({ where: { id: storeId } });
      if (!store) throw new NotFoundException({ code: 'SUBORDER_NOT_FOUND', message: 'Suborder not found' });
      this.assertMembership(ctx, store.vendorId, store.countryId, store.id);
      this.permission(ctx, store.vendorId, store.countryId, store.id, 'vendor:order:read');
      const where: any = { storeId };
      if (input.status) where.status = input.status;
      const items = await tx.vendorSuborder.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: input.limit + 1, ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}) });
      const hasMore = items.length > input.limit; const page = hasMore ? items.slice(0, input.limit) : items;
      return { items: page.map(s => this.suborderJson(s)), nextCursor: hasMore ? page[page.length - 1]!.id : null };
    });
  }

  async history(ctx: AccessContext, suborderId: string, limit: number, cursor?: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const suborder = await tx.vendorSuborder.findUnique({ where: { id: suborderId }, include: { order: { select: { countryId: true } } } });
      if (!suborder) throw new NotFoundException({ code: 'SUBORDER_NOT_FOUND', message: 'Suborder not found' });
      this.assertMembership(ctx, suborder.vendorId, suborder.order.countryId, suborder.storeId);
      this.permission(ctx, suborder.vendorId, suborder.order.countryId, suborder.storeId, 'vendor:order:read');
      const items = await tx.vendorSuborderStatusEvent.findMany({ where: { suborderId }, orderBy: [{ suborderVersion: 'desc' }], take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      const hasMore = items.length > limit; const page = hasMore ? items.slice(0, limit) : items;
      return { items: page.map(e => ({ id: e.id, fromStatus: e.fromStatus, toStatus: e.toStatus, suborderVersion: e.suborderVersion, reason: e.reason, preparationMinutes: e.preparationMinutes, occurredAt: e.occurredAt })), nextCursor: hasMore ? page[page.length - 1]!.id : null };
    });
  }

  private async command(ctx: AccessContext, suborderId: string, action: ReadinessAction, input: ReadinessCommandInput & { preparationMinutes?: number; reason?: string }) {
    assertVersion(input.expectedVersion);
    try { assertFulfillmentCommandKey(input.commandKey); } catch (e: any) { throw new BadRequestException({ code: e.message ?? 'FULFILLMENT_COMMAND_KEY_INVALID', message: 'Invalid fulfillment command key' }); }
    let preparationMinutes: number | undefined;
    let reason: string | undefined;
    if (action === 'accept') {
      try { assertPreparationMinutes(input.preparationMinutes!); } catch (e: any) { throw new BadRequestException({ code: e.message ?? 'PREPARATION_MINUTES_INVALID', message: 'Invalid preparation minutes' }); }
      preparationMinutes = input.preparationMinutes;
    }
    if (action === 'reject') {
      try { reason = assertRejectionReason(input.reason!); } catch (e: any) { throw new BadRequestException({ code: e.message ?? 'REJECTION_REASON_REQUIRED', message: 'A rejection reason is required' }); }
    }
    const payloadHash = hashPayload({ action, expectedVersion: input.expectedVersion, preparationMinutes: preparationMinutes ?? null, reason: reason ?? null });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const suborder = await this.lockSuborder(tx, suborderId);
      this.assertMembership(ctx, suborder.vendorId, suborder.countryId, suborder.storeId);
      this.permission(ctx, suborder.vendorId, suborder.countryId, suborder.storeId, 'vendor:order:write');
      const existing = await tx.vendorSuborderStatusEvent.findUnique({ where: { suborderId_commandKey: { suborderId, commandKey: input.commandKey } } });
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new ConflictException({ code: 'FULFILLMENT_IDEMPOTENCY_CONFLICT', message: 'Command key already used with different payload' });
        return this.suborderJson(suborder, true);
      }
      if (suborder.version !== input.expectedVersion) throw new ConflictException({ code: 'SUBORDER_VERSION_CONFLICT', message: 'Suborder version conflict' });
      await this.assertPaymentReady(suborder);
      const now = new Date();
      const data: any = { status: '', version: { increment: 1 } };
      let toStatus: string;
      let eventType: string;
      if (action === 'accept') {
        toStatus = 'ACCEPTED'; eventType = 'fulfillment.suborder.accepted';
        this.transition(suborder.status, toStatus);
        Object.assign(data, { status: toStatus, acceptedAt: now, acceptedByUserId: ctx.userId, preparationMinutes });
      } else if (action === 'reject') {
        toStatus = 'REJECTED'; eventType = 'fulfillment.suborder.rejected';
        this.transition(suborder.status, toStatus);
        Object.assign(data, { status: toStatus, rejectedAt: now, rejectedByUserId: ctx.userId, rejectionReason: reason });
      } else if (action === 'start-preparation') {
        toStatus = 'PREPARING'; eventType = 'fulfillment.suborder.preparing';
        this.transition(suborder.status, toStatus);
        Object.assign(data, { status: toStatus, preparationStartedAt: now });
      } else {
        toStatus = 'READY_FOR_PICKUP'; eventType = 'fulfillment.suborder.ready';
        try { assertVendorManualReady(suborder.status, false); } catch (e: any) {
          const message = e?.message ?? 'SUBORDER_INVALID_TRANSITION';
          const code = message.startsWith('INVALID_TRANSITION_') ? 'SUBORDER_INVALID_TRANSITION' : message;
          throw new ConflictException({ code, message: 'Suborder cannot be confirmed ready' });
        }
        Object.assign(data, { status: toStatus, readyConfirmedAt: now, readyConfirmedByUserId: ctx.userId });
      }
      let updated: any;
      try {
        updated = await tx.vendorSuborder.update({ where: { id: suborderId }, data });
      } catch (e: any) {
        if (e?.code === 'P2025') throw new NotFoundException({ code: 'SUBORDER_NOT_FOUND', message: 'Suborder not found' });
        throw e;
      }
      await tx.vendorSuborderStatusEvent.create({ data: { suborderId, fromStatus: suborder.status, toStatus: updated.status, suborderVersion: updated.version, actorUserId: ctx.userId, commandKey: input.commandKey, payloadHash, ...(reason ? { reason } : {}), ...(preparationMinutes !== undefined ? { preparationMinutes } : {}) } });
      await this.audit(tx, ctx, eventType, suborderId, suborder.countryId, reason);
      await this.outbox(tx, suborderId, eventType, `suborder-${action}-${suborderId}-${updated.version}`, suborder.countryId, { orderId: suborder.orderId, vendorId: suborder.vendorId, storeId: suborder.storeId, fromStatus: suborder.status, toStatus: updated.status, version: updated.version, preparationMinutes: preparationMinutes ?? null });
      return this.suborderJson(updated, false);
    }, { timeout: 30000 });
  }

  async accept(ctx: AccessContext, suborderId: string, input: AcceptSuborderInput) { return this.command(ctx, suborderId, 'accept', input); }
  async reject(ctx: AccessContext, suborderId: string, input: RejectSuborderInput) { return this.command(ctx, suborderId, 'reject', input); }
  async startPreparation(ctx: AccessContext, suborderId: string, input: ReadinessCommandInput) { return this.command(ctx, suborderId, 'start-preparation', input); }
  async ready(ctx: AccessContext, suborderId: string, input: ReadinessCommandInput) { return this.command(ctx, suborderId, 'ready', input); }
}
