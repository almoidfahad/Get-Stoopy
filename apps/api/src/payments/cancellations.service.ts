import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { FinanceOperationsService } from '../finance/finance-operations.service.js';
import { assertCancellationWindow, fullRefundAmount, hasPermission, inGeographicScope, restockDeltas, type AccessContext } from '@getstoopy/core';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function command(key: string, reason: string): string {
  if (!/^[A-Za-z0-9:_-]{8,128}$/.test(key)) throw new BadRequestException({ code: 'COMMAND_KEY_INVALID', message: 'Invalid command key' });
  const trimmed = reason?.trim();
  if (!trimmed || trimmed.length < 8 || trimmed.length > 512) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'A reason of 8–512 characters is required' });
  return trimmed;
}
function conflict(code: string): ConflictException { return new ConflictException({ code, message: 'Cancellation is not allowed in the current state' }); }

@Injectable()
export class CancellationsService {
  constructor(@Inject(PrivilegedPrismaService) private readonly privileged: PrivilegedPrismaService, @Inject(FinanceOperationsService) private readonly financeOperations: FinanceOperationsService) {}
  private async audit(tx: any, actor: string, action: string, type: string, id: string, countryId: string, reason?: string) {
    await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES (gen_random_uuid(),${actor}::uuid,'USER'::"ActorType",${action},${type},${id}::uuid,${JSON.stringify({ countryId })}::jsonb,${reason ?? null},${randomUUID()}::uuid)`;
  }
  private async outbox(tx: any, type: string, id: string, eventType: string, countryId: string, data: Record<string, unknown>) {
    const occurredAt = new Date(); const eventKey = `${eventType}-${id}`;
    await tx.outboxEvent.create({ data: { aggregateType: type, aggregateId: id, eventKey, eventType, occurredAt, payload: { schemaVersion: 1, eventKey, eventType, occurredAt: occurredAt.toISOString(), aggregateType: type, aggregateId: id, countryId, data } } });
  }
  private refundJson(r: any, duplicate = false) {
    return { refundRequestId: r.id, cancellationId: r.cancellationId, orderId: r.orderId, paymentIntentId: r.paymentIntentId, countryId: r.countryId, amountMinor: r.amountMinor.toString(), currency: r.currency, status: r.status, version: r.version, execution: r.status === 'APPROVED' ? 'SANDBOX_RESERVED' : 'DISABLED', moneyMoved: false, duplicate };
  }
  async cancellationJson(tx: any, orderId: string) {
    const c = await tx.orderCancellation.findUnique({ where: { orderId } });
    if (!c) return null;
    const refund = await tx.refundRequest.findUnique({ where: { orderId } });
    return { cancellationId: c.id, orderId, reason: c.reason, orderVersion: c.orderVersion, amountMinor: c.amountMinor.toString(), currency: c.currency, paymentStatusAtCancellation: c.paymentStatusAtCancellation, createdAt: c.createdAt, restock: 'COMPLETED', refund: refund ? this.refundJson(refund) : null };
  }

  async cancel(ctx: AccessContext, orderId: string, input: { expectedVersion: number; commandKey: string; reason: string }) {
    const reason = command(input.commandKey, input.reason);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new BadRequestException({ code: 'VERSION_INVALID', message: 'Invalid order version' });
    const payloadHash = hash({ orderId, expectedVersion: input.expectedVersion, reason });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rows = await tx.$queryRaw`SELECT * FROM "Order" WHERE "id"=${orderId}::uuid AND "buyerId"=${ctx.userId}::uuid FOR UPDATE`;
      const order = (rows as any[])[0];
      if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
      const prior = await tx.orderCancellation.findUnique({ where: { orderId_commandKey: { orderId, commandKey: input.commandKey } } });
      if (prior) {
        if (prior.payloadHash !== payloadHash) throw new ConflictException({ code: 'CANCELLATION_IDEMPOTENCY_CONFLICT', message: 'Command key already used with different payload' });
        return { ...(await this.cancellationJson(tx, orderId)), duplicate: true };
      }
      if (order.version !== input.expectedVersion) throw new ConflictException({ code: 'ORDER_VERSION_CONFLICT', message: 'Order version conflict' });
      const suborders = await tx.vendorSuborder.findMany({ where: { orderId }, orderBy: { id: 'asc' } });
      const dispatch = await tx.dispatchRun.findFirst({ where: { suborderId: { in: suborders.map((s: any) => s.id) } } });
      try { assertCancellationWindow({ lifecycleStatus: order.lifecycleStatus, paymentStatus: order.paymentStatus, suborderStatuses: suborders.map((s: any) => s.status), hasDispatchRun: !!dispatch }); }
      catch (e: any) { throw conflict(e.message); }
      let intent: any = null;
      if (order.paymentStatus === 'PAYMENT_VERIFIED') {
        const verified = await tx.paymentIntent.findMany({ where: { orderId, status: 'VERIFIED' } });
        if (verified.length !== 1) throw conflict('REFUND_PAYMENT_RECONCILIATION_REQUIRED');
        intent = verified[0];
        try { fullRefundAmount(order.amountMinor, intent.amountMinor, order.currency, intent.currency); } catch { throw conflict('REFUND_SNAPSHOT_MISMATCH'); }
      }
      const updated = await tx.order.update({ where: { id: orderId }, data: { lifecycleStatus: 'CANCELLED', version: { increment: 1 } } });
      const cancellation = await tx.orderCancellation.create({ data: { orderId, buyerId: ctx.userId, countryId: order.countryId, commandKey: input.commandKey, payloadHash, reason, orderVersion: updated.version, paymentStatusAtCancellation: order.paymentStatus, amountMinor: order.amountMinor, currency: order.currency } });
      for (const suborder of suborders) {
        const s = await tx.vendorSuborder.update({ where: { id: suborder.id }, data: { status: 'CANCELLED', version: { increment: 1 } } });
        await tx.vendorSuborderStatusEvent.create({ data: { suborderId: s.id, fromStatus: suborder.status, toStatus: 'CANCELLED', suborderVersion: s.version, actorUserId: ctx.userId, commandKey: `cancel-${cancellation.id}`, payloadHash, reason } });
      }
      const items = await tx.orderItem.findMany({ where: { suborder: { orderId } }, include: { quoteItem: true }, orderBy: { id: 'asc' } });
      const reservationIds = items.map((i: any) => i.quoteItem.reservationId);
      const reservations = await tx.inventoryReservation.findMany({ where: { id: { in: reservationIds } } });
      const inventoryIds = [...new Set(reservations.map((r: any) => r.inventoryId))].sort() as string[];
      // Stable inventory lock order prevents deadlocks between multi-vendor cancellations.
      for (const id of inventoryIds) await tx.$queryRaw`SELECT id FROM "Inventory" WHERE "id"=${id}::uuid FOR UPDATE`;
      for (const item of items) {
        const reservation = reservations.find((r: any) => r.id === item.quoteItem.reservationId);
        if (!reservation || reservation.state !== 'CONSUMED' || reservation.quantity !== item.quantity) throw conflict('RESTOCK_RESERVATION_MISMATCH');
        const inventory = await tx.inventory.findUniqueOrThrow({ where: { id: reservation.inventoryId } });
        const deltas = restockDeltas(item.quantity);
        if (inventory.onHand + deltas.onHandDelta > 1_000_000) throw conflict('RESTOCK_BOUNDS_INVALID');
        const i = await tx.inventory.update({ where: { id: inventory.id }, data: { onHand: { increment: deltas.onHandDelta }, version: { increment: 1 } } });
        await tx.inventoryMovement.create({ data: { inventoryId: i.id, inventoryVersion: i.version, kind: 'RESTOCK', commandKey: `restock-${cancellation.id}-${item.id}`, payloadHash: hash({ cancellationId: cancellation.id, orderItemId: item.id, reservationId: reservation.id, quantity: item.quantity }), reservationId: reservation.id, cancellationId: cancellation.id, ...deltas, onHandAfter: i.onHand, reservedAfter: i.reserved, reason, actorUserId: ctx.userId } });
      }
      let refund: any = null;
      if (intent) {
        refund = await tx.refundRequest.create({ data: { cancellationId: cancellation.id, orderId, paymentIntentId: intent.id, buyerId: ctx.userId, countryId: order.countryId, amountMinor: order.amountMinor, currency: order.currency } });
        await this.audit(tx, ctx.userId, 'finance.refund.requested', 'RefundRequest', refund.id, order.countryId, reason);
        await this.outbox(tx, 'RefundRequest', refund.id, 'finance.refund.requested', order.countryId, { orderId, cancellationId: cancellation.id, amountMinor: refund.amountMinor.toString(), currency: refund.currency, execution: 'DISABLED' });
      }
      await this.audit(tx, ctx.userId, 'commerce.order.cancelled', 'Order', orderId, order.countryId, reason);
      await this.outbox(tx, 'Order', orderId, 'commerce.order.cancelled', order.countryId, { cancellationId: cancellation.id, restockedItems: items.length, refundRequestId: refund?.id ?? null });
      return { ...(await this.cancellationJson(tx, orderId)), duplicate: false };
    }, { timeout: 30000 });
  }

  async getOwnRefund(ctx: AccessContext, id: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const r = await tx.refundRequest.findFirst({ where: { id, buyerId: ctx.userId } });
      if (!r) throw new NotFoundException({ code: 'REFUND_NOT_FOUND', message: 'Refund request not found' });
      return this.refundJson(r);
    });
  }
  private reviewer(ctx: AccessContext, countryId: string) {
    if (!hasPermission(ctx, 'finance:refund:review')) throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Refund review permission is required' });
    if (ctx.assurance !== 'STEP_UP') throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Recent step-up is required' });
    if (!inGeographicScope(ctx, { countryId })) throw new NotFoundException({ code: 'REFUND_NOT_FOUND', message: 'Refund request not found' });
  }
  async list(ctx: AccessContext, countryId: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      this.reviewer(ctx, countryId);
      const items = await tx.refundRequest.findMany({ where: { countryId, status: 'PENDING_REVIEW' }, orderBy: { createdAt: 'asc' }, take: 100 });
      return { items: items.map((r: any) => this.refundJson(r)), nextCursor: null };
    });
  }
  async review(ctx: AccessContext, id: string, input: { expectedVersion: number; decision: 'APPROVE' | 'REJECT'; commandKey: string; reason: string }) {
    const reason = command(input.commandKey, input.reason);
    if (!['APPROVE', 'REJECT'].includes(input.decision)) throw new BadRequestException({ code: 'REFUND_DECISION_INVALID', message: 'Invalid refund decision' });
    const payloadHash = hash({ id, expectedVersion: input.expectedVersion, decision: input.decision, reason });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rows = await tx.$queryRaw`SELECT * FROM "RefundRequest" WHERE "id"=${id}::uuid FOR UPDATE`;
      const r = (rows as any[])[0];
      if (!r) throw new NotFoundException({ code: 'REFUND_NOT_FOUND', message: 'Refund request not found' });
      this.reviewer(ctx, r.countryId);
      if (r.buyerId === ctx.userId) throw new ForbiddenException({ code: 'SELF_REVIEW_DENIED', message: 'A buyer cannot review their own refund' });
      const prior = await tx.refundReview.findUnique({ where: { refundRequestId_commandKey: { refundRequestId: id, commandKey: input.commandKey } } });
      if (prior) {
        if (prior.payloadHash !== payloadHash) throw new ConflictException({ code: 'REFUND_IDEMPOTENCY_CONFLICT', message: 'Command key already used with different payload' });
        return this.refundJson(r, true);
      }
      if (r.status !== 'PENDING_REVIEW') throw new ConflictException({ code: 'REFUND_ALREADY_REVIEWED', message: 'Refund already reviewed' });
      if (r.version !== input.expectedVersion) throw new ConflictException({ code: 'REFUND_VERSION_CONFLICT', message: 'Refund version conflict' });
      const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const updated = await tx.refundRequest.update({ where: { id }, data: { status, version: { increment: 1 } } });
      if (status === 'APPROVED') await this.financeOperations.reserveRefundTx(tx, ctx, updated);
      await tx.refundReview.create({ data: { refundRequestId: id, reviewerUserId: ctx.userId, decision: input.decision, refundVersion: updated.version, commandKey: input.commandKey, payloadHash, reason } });
      await this.audit(tx, ctx.userId, `finance.refund.${status.toLowerCase()}`, 'RefundRequest', id, r.countryId, reason);
      await this.outbox(tx, 'RefundRequest', id, `finance.refund.${status.toLowerCase()}`, r.countryId, { orderId: r.orderId, status, execution: status === 'APPROVED' ? 'SANDBOX_RESERVED' : 'DISABLED', moneyMoved: false });
      return this.refundJson(updated);
    });
  }
}
