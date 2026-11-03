import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { hasPermission, inGeographicScope, settlementHoldUntil, settlementLineAmounts, settlementTotals, type AccessContext } from '@getstoopy/core';
import { FinanceService } from './finance.service.js';
import { PayoutDestinationsService } from './payout-destinations.service.js';

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export interface PrepareSettlementInput { vendorId: string; destinationId: string; suborderIds: string[]; commandKey: string; }
@Injectable()
export class VendorSettlementsService {
  constructor(@Inject(PrivilegedPrismaService) private readonly privileged: PrivilegedPrismaService, @Inject(FinanceService) private readonly finance: FinanceService, @Inject(PayoutDestinationsService) private readonly destinations: PayoutDestinationsService) {}
  now() { return new Date(); }
  private key(k: string) { if (!/^[A-Za-z0-9:_-]{8,128}$/.test(k)) throw new BadRequestException({ code: 'COMMAND_KEY_INVALID', message: 'Invalid command key' }); }
  private reason(r: string) { const v = r?.trim(); if (!v || v.length < 8 || v.length > 512) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'A reason of 8–512 characters is required' }); return v; }
  private authority(ctx: AccessContext, permission: string, countryId: string) {
    if (!hasPermission(ctx, permission)) throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Settlement permission is required' });
    if (ctx.assurance !== 'STEP_UP') throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Recent step-up is required' });
    if (!inGeographicScope(ctx, { countryId })) throw new NotFoundException({ code: 'SETTLEMENT_NOT_FOUND', message: 'Settlement not found' });
  }
  private conflict(code: string): never { throw new ConflictException({ code, message: 'Settlement eligibility or calculation gate is not satisfied' }); }
  private async audit(tx: any, ctx: AccessContext, action: string, id: string, countryId: string, reason?: string) {
    await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType","sessionId",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES (gen_random_uuid(),${ctx.userId}::uuid,'USER'::"ActorType",${ctx.sessionId}::uuid,${action},'VendorSettlement',${id}::uuid,${JSON.stringify({ countryId })}::jsonb,${reason ?? null},${randomUUID()}::uuid)`;
  }
  private async outbox(tx: any, id: string, eventType: string, countryId: string, data: Record<string, unknown>) {
    const occurredAt = new Date(); const eventKey = `${eventType}-${id}`;
    await tx.outboxEvent.create({ data: { aggregateType: 'VendorSettlement', aggregateId: id, eventKey, eventType, occurredAt, payload: { schemaVersion: 1, eventKey, eventType, occurredAt: occurredAt.toISOString(), aggregateType: 'VendorSettlement', aggregateId: id, countryId, data } } });
  }
  private json(s: any, duplicate = false) { return { settlementId: s.id, vendorId: s.vendorId, countryId: s.countryId, currency: s.currency, destinationId: s.destinationId, grossMinor: s.grossMinor.toString(), commissionMinor: s.commissionMinor.toString(), netMinor: s.netMinor.toString(), status: s.status, version: s.version, journalId: s.journalId, execution: 'DISABLED', moneyMoved: false, duplicate }; }
  async createPolicy(ctx: AccessContext, input: { vendorId: string; commissionBps: number; holdDays: number; effectiveFrom: string; commandKey: string }) {
    this.key(input.commandKey);
    if (!Number.isInteger(input.commissionBps) || input.commissionBps < 0 || input.commissionBps >= 10000 || !Number.isInteger(input.holdDays) || input.holdDays < 0 || input.holdDays > 90) throw new BadRequestException({ code: 'COMMISSION_POLICY_INVALID', message: 'Commission basis points and hold days are outside the allowed range' });
    const effectiveFrom = new Date(input.effectiveFrom); if (!Number.isFinite(effectiveFrom.getTime())) throw new BadRequestException({ code: 'EFFECTIVE_FROM_INVALID', message: 'Invalid effectiveFrom' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      await tx.$executeRaw`SELECT id FROM "Vendor" WHERE id=${input.vendorId}::uuid FOR UPDATE`;
      const vendor = await tx.vendor.findUnique({ where: { id: input.vendorId }, include: { country: true } });
      if (!vendor) throw new NotFoundException({ code: 'VENDOR_NOT_FOUND', message: 'Vendor not found' });
      this.authority(ctx, 'finance:commission:manage', vendor.countryId);
      if (vendor.ownerUserId === ctx.userId) throw new ForbiddenException({ code: 'SELF_POLICY_DENIED', message: 'Vendor owner cannot set their own commission policy' });
      const payloadHash = hash({ vendorId: vendor.id, commissionBps: input.commissionBps, holdDays: input.holdDays, effectiveFrom: effectiveFrom.toISOString(), currency: vendor.country.currencyCode });
      const prior = await tx.vendorCommissionPolicy.findUnique({ where: { vendorId_commandKey: { vendorId: vendor.id, commandKey: input.commandKey } } });
      if (prior) { if (prior.payloadHash !== payloadHash) throw new ConflictException({ code: 'POLICY_IDEMPOTENCY_CONFLICT', message: 'Command key already used with different payload' }); return { policyId: prior.id, duplicate: true }; }
      try {
        const p = await tx.vendorCommissionPolicy.create({ data: { vendorId: vendor.id, countryId: vendor.countryId, currency: vendor.country.currencyCode, commissionBps: input.commissionBps, holdDays: input.holdDays, effectiveFrom, commandKey: input.commandKey, payloadHash, createdByUserId: ctx.userId } });
        await this.audit(tx, ctx, 'finance.commission_policy.created', p.id, vendor.countryId);
        return { policyId: p.id, duplicate: false };
      } catch (e: any) { if (e?.code === 'P2002') this.conflict('POLICY_EFFECTIVE_DATE_CONFLICT'); if (/commission_policy_scope_or_actor/.test(e?.message)) this.conflict('VENDOR_KYC_REQUIRED'); throw e; }
    });
  }
  async prepare(ctx: AccessContext, input: PrepareSettlementInput) {
    this.key(input.commandKey); const ids = [...new Set(input.suborderIds)].sort();
    if (!ids.length || ids.length > 100 || ids.length !== input.suborderIds.length) throw new BadRequestException({ code: 'SETTLEMENT_ITEMS_INVALID', message: 'Choose 1–100 distinct suborders' });
    const payloadHash = hash({ vendorId: input.vendorId, destinationId: input.destinationId, suborderIds: ids });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const vendors = await tx.$queryRaw`SELECT * FROM "Vendor" WHERE id=${input.vendorId}::uuid FOR UPDATE`;
      const vendor = (vendors as any[])[0]; if (!vendor) throw new NotFoundException({ code: 'VENDOR_NOT_FOUND', message: 'Vendor not found' });
      this.authority(ctx, 'finance:settlement:prepare', vendor.countryId);
      if (vendor.ownerUserId === ctx.userId) throw new ForbiddenException({ code: 'SELF_SETTLEMENT_DENIED', message: 'Vendor owner cannot prepare their own settlement' });
      const prior = await tx.vendorSettlement.findUnique({ where: { vendorId_commandKey: { vendorId: vendor.id, commandKey: input.commandKey } } });
      if (prior) { if (prior.payloadHash !== payloadHash) throw new ConflictException({ code: 'SETTLEMENT_IDEMPOTENCY_CONFLICT', message: 'Command key already used with different payload' }); return this.json(prior, true); }
      const country = await tx.country.findUniqueOrThrow({ where: { id: vendor.countryId } });
      const destination = await this.destinations.assertUsableTx(tx, input.destinationId, vendor.id, vendor.countryId, country.currencyCode, this.now());
      const suborders = await tx.vendorSuborder.findMany({ where: { id: { in: ids } }, include: { order: true, delivery: true }, orderBy: { id: 'asc' } });
      if (suborders.length !== ids.length || suborders.some((s: any) => s.vendorId !== vendor.id)) throw new NotFoundException({ code: 'SUBORDER_NOT_FOUND', message: 'Suborder not found' });
      if (new Set(suborders.map((s: any) => s.order.paymentMethod)).size !== 1) this.conflict('SETTLEMENT_FUNDING_SOURCE_MIXED');
      const lines: any[] = [];
      for (const s of suborders as any[]) {
        if (s.status !== 'COMPLETED' || !s.delivery || s.delivery.status !== 'COMPLETED' || !s.delivery.completedAt || s.order.lifecycleStatus !== 'ACTIVE' || s.currency !== country.currencyCode) this.conflict('SETTLEMENT_SUBORDER_INELIGIBLE');
        const allocated = await tx.vendorSettlementItem.findFirst({ where: { suborderId: s.id, settlement: { status: { not: 'REJECTED' } } } });
        if (allocated) this.conflict('SETTLEMENT_SUBORDER_ALREADY_ALLOCATED');
        if (await tx.refundRequest.findUnique({ where: { orderId: s.orderId } })) this.conflict('SETTLEMENT_REFUND_RECONCILIATION_REQUIRED');
        if (s.order.paymentMethod === 'COD') {
          const collection = await tx.codCollection.findUnique({ where: { deliveryId: s.delivery.id }, include: { allocations: { include: { deposit: true } } } });
          if (!collection || collection.allocations.filter((a: any) => a.deposit.status === 'VERIFIED').reduce((n: bigint, a: any) => n + a.amountMinor, 0n) !== collection.amountMinor) this.conflict('SETTLEMENT_COD_DEPOSIT_REQUIRED');
        } else if (s.order.paymentStatus !== 'PAYMENT_VERIFIED') this.conflict('SETTLEMENT_PAYMENT_NOT_VERIFIED');
        const policy = await tx.vendorCommissionPolicy.findFirst({ where: { vendorId: vendor.id, countryId: vendor.countryId, currency: s.currency, effectiveFrom: { lte: s.delivery.completedAt }, createdAt: { lte: s.delivery.completedAt } }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
        if (!policy) this.conflict('COMMISSION_POLICY_REQUIRED');
        let amounts; try { amounts = settlementLineAmounts({ grossMinor: s.subtotalMinor, commissionBps: policy.commissionBps }); } catch { this.conflict('SETTLEMENT_CALCULATION_INVALID'); }
        const holdUntil = settlementHoldUntil(s.delivery.completedAt, policy.holdDays);
        if (holdUntil.getTime() > this.now().getTime()) this.conflict('SETTLEMENT_HOLD_ACTIVE');
        lines.push({ suborderId: s.id, policyId: policy.id, commissionBps: policy.commissionBps, completedAt: s.delivery.completedAt, holdUntil, ...amounts });
      }
      const totals = settlementTotals(lines.map(l => ({ grossMinor: l.grossMinor, commissionBps: l.commissionBps })));
      const settlement = await tx.vendorSettlement.create({ data: { vendorId: vendor.id, countryId: vendor.countryId, currency: country.currencyCode, destinationId: destination.id, ...totals, createdAt: this.now(), commandKey: input.commandKey, payloadHash, createdByUserId: ctx.userId } });
      for (const line of lines) await tx.vendorSettlementItem.create({ data: { settlementId: settlement.id, ...line } });
      await this.audit(tx, ctx, 'finance.vendor_settlement.prepared', settlement.id, vendor.countryId);
      await this.outbox(tx, settlement.id, 'finance.vendor_settlement.prepared', vendor.countryId, { vendorId: vendor.id, itemCount: lines.length, netMinor: totals.netMinor.toString(), currency: country.currencyCode, execution: 'DISABLED' });
      return this.json(settlement);
    }, { timeout: 30000 });
  }
  async list(ctx: AccessContext, countryId: string) {
    return this.privileged.$transaction(async tx => { await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true }); this.authority(ctx, 'finance:settlement:review', countryId); const rows = await tx.vendorSettlement.findMany({ where: { countryId, status: 'PENDING_REVIEW' }, orderBy: { createdAt: 'asc' }, take: 100 }); return { items: rows.map(s => this.json(s)), nextCursor: null }; });
  }
  async listMine(ctx: AccessContext, vendorId: string) {
    return this.privileged.$transaction(async tx => { await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true }); const v = await tx.vendor.findUnique({ where: { id: vendorId } }); if (!v || v.ownerUserId !== ctx.userId) throw new NotFoundException({ code: 'VENDOR_NOT_FOUND', message: 'Vendor not found' }); const rows = await tx.vendorSettlement.findMany({ where: { vendorId }, orderBy: { createdAt: 'desc' }, take: 100 }); return { items: rows.map(s => this.json(s)), nextCursor: null }; });
  }
  async get(ctx: AccessContext, id: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const s = await tx.vendorSettlement.findUnique({ where: { id }, include: { items: true } });
      if (!s) throw new NotFoundException({ code: 'SETTLEMENT_NOT_FOUND', message: 'Settlement not found' });
      const vendor = await tx.vendor.findUniqueOrThrow({ where: { id: s.vendorId } });
      if (vendor.ownerUserId !== ctx.userId) this.authority(ctx, 'finance:settlement:review', s.countryId);
      return { ...this.json(s), items: s.items.map((i: any) => ({ suborderId: i.suborderId, policyId: i.policyId, grossMinor: i.grossMinor.toString(), commissionBps: i.commissionBps, commissionMinor: i.commissionMinor.toString(), netMinor: i.netMinor.toString(), completedAt: i.completedAt, holdUntil: i.holdUntil })) };
    });
  }
  async review(ctx: AccessContext, id: string, input: { expectedVersion: number; decision: 'APPROVE' | 'REJECT'; commandKey: string; reason: string }) {
    this.key(input.commandKey); const reason = this.reason(input.reason); const payloadHash = hash({ id, expectedVersion: input.expectedVersion, decision: input.decision, reason });
    if (!['APPROVE', 'REJECT'].includes(input.decision)) throw new BadRequestException({ code: 'DECISION_INVALID', message: 'Invalid decision' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const initial = await tx.vendorSettlement.findUnique({ where: { id } }); if (!initial) throw new NotFoundException({ code: 'SETTLEMENT_NOT_FOUND', message: 'Settlement not found' });
      this.authority(ctx, 'finance:settlement:review', initial.countryId);
      await tx.$executeRaw`SELECT id FROM "Vendor" WHERE id=${initial.vendorId}::uuid FOR UPDATE`;
      const s = await tx.vendorSettlement.findUniqueOrThrow({ where: { id }, include: { items: { include: { suborder: { include: { order: true, delivery: true } } } } } });
      if (s.createdByUserId === ctx.userId) throw new ForbiddenException({ code: 'SELF_REVIEW_DENIED', message: 'Maker cannot check their own settlement' });
      if (s.reviewCommandKey === input.commandKey) { if (s.reviewPayloadHash !== payloadHash) throw new ConflictException({ code: 'SETTLEMENT_IDEMPOTENCY_CONFLICT', message: 'Command key already used with different payload' }); return this.json(s, true); }
      if (s.status !== 'PENDING_REVIEW') this.conflict('SETTLEMENT_ALREADY_REVIEWED');
      if (s.version !== input.expectedVersion) this.conflict('SETTLEMENT_VERSION_CONFLICT');
      let journalId: string | null = null;
      if (input.decision === 'APPROVE') {
        await this.destinations.assertUsableTx(tx, s.destinationId, s.vendorId, s.countryId, s.currency, this.now());
        if (new Set(s.items.map((i: any) => i.suborder.order.paymentMethod)).size !== 1) this.conflict('SETTLEMENT_FUNDING_SOURCE_MIXED');
        for (const item of s.items as any[]) {
          if (item.holdUntil.getTime() > this.now().getTime()) this.conflict('SETTLEMENT_HOLD_ACTIVE');
          const sub = item.suborder;
          if (sub.status !== 'COMPLETED' || sub.order.lifecycleStatus !== 'ACTIVE' || sub.delivery?.status !== 'COMPLETED') this.conflict('SETTLEMENT_SUBORDER_INELIGIBLE');
          if (await tx.refundRequest.findUnique({ where: { orderId: sub.orderId } })) this.conflict('SETTLEMENT_REFUND_RECONCILIATION_REQUIRED');
          if (sub.order.paymentMethod === 'COD') {
            const col = await tx.codCollection.findUnique({ where: { deliveryId: sub.delivery.id }, include: { allocations: { include: { deposit: true } } } });
            if (!col || col.allocations.filter((a: any) => a.deposit.status === 'VERIFIED').reduce((n: bigint, a: any) => n + a.amountMinor, 0n) !== col.amountMinor) this.conflict('SETTLEMENT_COD_DEPOSIT_REQUIRED');
          } else if (sub.order.paymentStatus !== 'PAYMENT_VERIFIED') this.conflict('SETTLEMENT_PAYMENT_NOT_VERIFIED');
        }
        // Reserve net vendor payable and recognize commission; this is NOT a cash transfer.
        const sourceCode = s.items.every((i: any) => i.suborder.order.paymentMethod === 'COD') ? `cod-clearing:${s.countryId}:${s.currency}` : `vendor-sales-clearing:${s.countryId}:${s.currency}`;
        const source = await this.finance.account(tx, sourceCode, 'Vendor sales/COD clearing', sourceCode.startsWith('cod-') ? 'LIABILITY' : 'ASSET', s.currency, ctx.userId);
        const payable = await this.finance.account(tx, `vendor-payable:${s.vendorId}:${s.currency}`, 'Vendor settlement payable', 'LIABILITY', s.currency, ctx.userId);
        const lines: { accountId: string; side: 'DEBIT' | 'CREDIT'; amountMinor: bigint }[] = [{ accountId: source, side: 'DEBIT', amountMinor: s.grossMinor }, { accountId: payable, side: 'CREDIT', amountMinor: s.netMinor }];
        if (s.commissionMinor > 0n) { const revenue = await this.finance.account(tx, `commission-revenue:${s.countryId}:${s.currency}`, 'Vendor commission revenue', 'REVENUE', s.currency, ctx.userId); lines.push({ accountId: revenue, side: 'CREDIT', amountMinor: s.commissionMinor }); }
        journalId = (await this.finance.postJournalTx(tx, { businessEventKey: `vendor-settlement-${s.id}`, currency: s.currency, description: 'Approved vendor payable reservation; no provider transfer', actor: ctx.userId, lines })).journalId;
      }
      const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED'; const now = this.now();
      const updated = await tx.vendorSettlement.update({ where: { id }, data: { status, version: { increment: 1 }, reviewedByUserId: ctx.userId, reviewedAt: now, reviewCommandKey: input.commandKey, reviewPayloadHash: payloadHash, reviewReason: reason, journalId } });
      await tx.vendorSettlementReview.create({ data: { settlementId: id, decision: input.decision, settlementVersion: updated.version, actorUserId: ctx.userId, commandKey: input.commandKey, payloadHash, reason } });
      await this.audit(tx, ctx, `finance.vendor_settlement.${status.toLowerCase()}`, id, s.countryId, reason);
      await this.outbox(tx, id, `finance.vendor_settlement.${status.toLowerCase()}`, s.countryId, { vendorId: s.vendorId, status, version: updated.version, journalId, execution: 'DISABLED', moneyMoved: false });
      return this.json(updated);
    }, { timeout: 30000 });
  }
}
