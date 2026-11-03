import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { codDueMinor, hasPermission, inGeographicScope, rateForDistance, validateRateSlabs, type AccessContext } from '@getstoopy/core';

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function key(k: string) { if (!/^[A-Za-z0-9:_-]{8,128}$/.test(k)) throw new BadRequestException({ code: 'COMMAND_KEY_INVALID', message: 'Invalid command key' }); }
function reasonText(r: string) { const t = r?.trim(); if (!t || t.length < 8 || t.length > 512) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'A reason of 8–512 characters is required' }); return t; }

@Injectable()
export class FinanceService {
  constructor(@Inject(PrivilegedPrismaService) private readonly privileged: PrivilegedPrismaService) {}

  private async audit(tx: any, actor: string, action: string, type: string, id: string, countryId: string, reason?: string) {
    await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES (gen_random_uuid(),${actor}::uuid,'USER'::"ActorType",${action},${type},${id}::uuid,${JSON.stringify({ countryId })}::jsonb,${reason ?? null},${randomUUID()}::uuid)`;
  }
  private async outbox(tx: any, type: string, id: string, eventType: string, countryId: string, data: Record<string, unknown>) {
    const occurredAt = new Date(); const eventKey = `${eventType}-${id}`;
    await tx.outboxEvent.create({ data: { aggregateType: type, aggregateId: id, eventKey, eventType, occurredAt, payload: { schemaVersion: 1, eventKey, eventType, occurredAt: occurredAt.toISOString(), aggregateType: type, aggregateId: id, countryId, data } } });
  }
  private async account(tx: any, code: string, name: string, type: 'ASSET'|'LIABILITY'|'EXPENSE', currency: string, actor: string) {
    const existing = await tx.ledgerAccount.findUnique({ where: { code } });
    if (existing) { if (existing.currency !== currency || existing.type !== type) throw new ConflictException({ code: 'LEDGER_ACCOUNT_CONFLICT', message: 'Ledger account code already used with different type/currency' }); return existing.id as string; }
    const a = await tx.ledgerAccount.create({ data: { code, name, type, currency, createdByUserId: actor } });
    return a.id as string;
  }
  /** Immutable balanced journal inside the caller transaction. */
  async postJournalTx(tx: any, input: { businessEventKey: string; currency: string; description: string; actor: string; lines: { accountId: string; side: 'DEBIT'|'CREDIT'; amountMinor: bigint }[] }) {
    const existing = await tx.ledgerJournal.findUnique({ where: { businessEventKey: input.businessEventKey } });
    const payloadHash = hash({ currency: input.currency, description: input.description, lines: input.lines.map(l => ({ accountId: l.accountId, side: l.side, amountMinor: l.amountMinor.toString() })) });
    if (existing) { if (existing.payloadHash !== payloadHash) throw new ConflictException({ code: 'LEDGER_IDEMPOTENCY_CONFLICT', message: 'Business event key already used with different payload' }); return { journalId: existing.id as string, duplicate: true }; }
    let net = 0n; for (const l of input.lines) { if (l.amountMinor <= 0n) throw new BadRequestException({ code: 'LEDGER_AMOUNT_INVALID', message: 'Invalid ledger amount' }); net += l.side === 'DEBIT' ? l.amountMinor : -l.amountMinor; }
    if (net !== 0n || input.lines.length < 2) throw new BadRequestException({ code: 'LEDGER_UNBALANCED', message: 'Journal must balance' });
    const j = await tx.ledgerJournal.create({ data: { businessEventKey: input.businessEventKey, payloadHash, currency: input.currency, description: input.description, createdByUserId: input.actor } });
    for (let i = 0; i < input.lines.length; i++) { const l = input.lines[i]!; await tx.ledgerLine.create({ data: { journalId: j.id, accountId: l.accountId, side: l.side, amountMinor: l.amountMinor, lineNo: i + 1 } }); }
    return { journalId: j.id as string, duplicate: false };
  }

  async createRateRule(ctx: AccessContext, input: { countryId: string; currency: string; effectiveFrom: string; commandKey: string; slabs: { lowerMeters: number; upperMeters: number | null; amountMinor: string }[] }) {
    key(input.commandKey);
    if (!hasPermission(ctx, 'finance:rider-rate:manage')) throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Rider rate management permission is required' });
    if (ctx.assurance !== 'STEP_UP') throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Recent step-up is required' });
    if (!inGeographicScope(ctx, { countryId: input.countryId })) throw new NotFoundException({ code: 'COUNTRY_NOT_FOUND', message: 'Country not found' });
    if (!/^[A-Z]{3}$/.test(input.currency)) throw new BadRequestException({ code: 'CURRENCY_INVALID', message: 'Invalid currency' });
    const effectiveFrom = new Date(input.effectiveFrom); if (Number.isNaN(effectiveFrom.getTime())) throw new BadRequestException({ code: 'EFFECTIVE_FROM_INVALID', message: 'Invalid effectiveFrom' });
    const slabs = input.slabs.map(s => ({ lowerMeters: s.lowerMeters, upperMeters: s.upperMeters, amountMinor: BigInt(s.amountMinor) }));
    try { validateRateSlabs(slabs); } catch (e: any) { throw new BadRequestException({ code: e.message, message: 'Invalid rate slabs' }); }
    const payloadHash = hash({ countryId: input.countryId, currency: input.currency, effectiveFrom: effectiveFrom.toISOString(), slabs: slabs.map(s => ({ ...s, amountMinor: s.amountMinor.toString() })) });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const existing = await tx.riderRateRule.findUnique({ where: { countryId_commandKey: { countryId: input.countryId, commandKey: input.commandKey } } });
      if (existing) { if (existing.payloadHash !== payloadHash) throw new ConflictException({ code: 'RATE_IDEMPOTENCY_CONFLICT', message: 'Command key already used with different payload' }); return { ruleId: existing.id, duplicate: true }; }
      const rule = await tx.riderRateRule.create({ data: { countryId: input.countryId, currency: input.currency, effectiveFrom, commandKey: input.commandKey, payloadHash, createdByUserId: ctx.userId } });
      for (const s of slabs) await tx.riderRateSlab.create({ data: { ruleId: rule.id, lowerMeters: s.lowerMeters, upperMeters: s.upperMeters, amountMinor: s.amountMinor } });
      await this.audit(tx, ctx.userId, 'finance.rider_rate.created', 'RiderRateRule', rule.id, input.countryId);
      return { ruleId: rule.id, duplicate: false };
    });
  }

  /** Called inside dispatch accept transaction. */
  async snapshotRateTx(tx: any, assignment: { id: string; riderId: string; countryId: string; roadDistanceMeters: number; routeEvidenceHash: string }, currency: string) {
    const rules = await tx.riderRateRule.findMany({ where: { countryId: assignment.countryId, currency, status: 'ACTIVE', effectiveFrom: { lte: new Date() } }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }], include: { slabs: true }, take: 1 });
    const rule = rules[0];
    if (!rule) throw new ConflictException({ code: 'RIDER_RATE_REQUIRED', message: 'No active rider rate rule is configured' });
    let slab; try { slab = rateForDistance(rule.slabs.map((s: any) => ({ lowerMeters: s.lowerMeters, upperMeters: s.upperMeters, amountMinor: s.amountMinor })), assignment.roadDistanceMeters); } catch (e: any) { throw new ConflictException({ code: e.message, message: 'Road distance is outside configured rate slabs' }); }
    const stored = rule.slabs.find((s: any) => s.lowerMeters === slab.lowerMeters)!;
    await tx.riderRateSnapshot.create({ data: { assignmentId: assignment.id, ruleId: rule.id, slabId: stored.id, countryId: assignment.countryId, riderId: assignment.riderId, roadDistanceMeters: assignment.roadDistanceMeters, amountMinor: stored.amountMinor, currency, routeEvidenceHash: assignment.routeEvidenceHash } });
  }

  /** Called inside delivery completion transaction after delivery is COMPLETED. */
  async recordCompletionTx(tx: any, delivery: { id: string; assignmentId: string; riderId: string; countryId: string }, actor: string) {
    const snap = await tx.riderRateSnapshot.findUnique({ where: { assignmentId: delivery.assignmentId } });
    if (!snap) throw new ConflictException({ code: 'RIDER_RATE_SNAPSHOT_REQUIRED', message: 'Assignment rate snapshot is required' });
    const expense = await this.account(tx, `delivery-expense:${delivery.countryId}:${snap.currency}`, 'Delivery expense', 'EXPENSE', snap.currency, actor);
    const payable = await this.account(tx, `rider-earning-payable:${delivery.riderId}:${snap.currency}`, 'Rider earning payable', 'LIABILITY', snap.currency, actor);
    const earningJournal = await this.postJournalTx(tx, { businessEventKey: `rider-earning-${delivery.id}`, currency: snap.currency, description: 'Rider delivery earning on verified completion', actor, lines: [{ accountId: expense, side: 'DEBIT', amountMinor: snap.amountMinor }, { accountId: payable, side: 'CREDIT', amountMinor: snap.amountMinor }] });
    await tx.riderEarning.create({ data: { deliveryId: delivery.id, riderId: delivery.riderId, countryId: delivery.countryId, amountMinor: snap.amountMinor, currency: snap.currency, journalId: earningJournal.journalId } });
    const suborder = await tx.vendorSuborder.findUniqueOrThrow({ where: { id: (await tx.delivery.findUniqueOrThrow({ where: { id: delivery.id } })).suborderId }, include: { order: true } });
    if (suborder.order.paymentMethod === 'COD') {
      const custody = await this.account(tx, `rider-cod-custody:${delivery.riderId}:${snap.currency}`, 'Rider COD custody', 'ASSET', snap.currency, actor);
      const clearing = await this.account(tx, `cod-clearing:${delivery.countryId}:${snap.currency}`, 'COD clearing', 'LIABILITY', snap.currency, actor);
      const codJournal = await this.postJournalTx(tx, { businessEventKey: `cod-collection-${delivery.id}`, currency: suborder.order.currency, description: 'COD collected by rider on verified completion', actor, lines: [{ accountId: custody, side: 'DEBIT', amountMinor: suborder.order.amountMinor }, { accountId: clearing, side: 'CREDIT', amountMinor: suborder.order.amountMinor }] });
      await tx.codCollection.create({ data: { deliveryId: delivery.id, orderId: suborder.orderId, riderId: delivery.riderId, countryId: delivery.countryId, amountMinor: suborder.order.amountMinor, currency: suborder.order.currency, journalId: codJournal.journalId } });
    }
  }

  private requireRider(ctx: AccessContext) { if (!ctx.riderId) throw new ForbiddenException({ code: 'RIDER_REQUIRED', message: 'Active rider profile is required' }); return ctx.riderId; }
  async submitDeposit(ctx: AccessContext, input: { amountMinor: string; currency: string; method: 'COMPANY_OFFICE'|'BANK'|'MERCHANT_MFS'; externalReference: string; evidenceHash: string; commandKey: string }) {
    const riderId = this.requireRider(ctx); key(input.commandKey);
    const amount = BigInt(input.amountMinor); if (amount <= 0n) throw new BadRequestException({ code: 'AMOUNT_INVALID', message: 'Invalid amount' });
    if (!/^[A-Z]{3}$/.test(input.currency)) throw new BadRequestException({ code: 'CURRENCY_INVALID', message: 'Invalid currency' });
    if (!['COMPANY_OFFICE','BANK','MERCHANT_MFS'].includes(input.method)) throw new BadRequestException({ code: 'DEPOSIT_METHOD_INVALID', message: 'Invalid deposit method' });
    const ref = input.externalReference?.trim(); if (!ref || ref.length < 3 || ref.length > 128) throw new BadRequestException({ code: 'EXTERNAL_REFERENCE_INVALID', message: 'Invalid external reference' });
    if (!/^[0-9a-f]{64}$/i.test(input.evidenceHash)) throw new BadRequestException({ code: 'EVIDENCE_HASH_INVALID', message: 'Invalid evidence hash' });
    const payloadHash = hash({ amountMinor: amount.toString(), currency: input.currency, method: input.method, externalReference: ref, evidenceHash: input.evidenceHash.toLowerCase() });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rider = await tx.riderProfile.findUniqueOrThrow({ where: { id: riderId } });
      const existing = await tx.codDeposit.findUnique({ where: { riderId_commandKey: { riderId, commandKey: input.commandKey } } });
      if (existing) { if (existing.payloadHash !== payloadHash) throw new ConflictException({ code: 'DEPOSIT_IDEMPOTENCY_CONFLICT', message: 'Command key already used with different payload' }); return this.depositJson(existing, true); }
      const dep = await tx.codDeposit.create({ data: { riderId, countryId: rider.countryId, amountMinor: amount, currency: input.currency, method: input.method, externalReference: ref, evidenceHash: input.evidenceHash.toLowerCase(), commandKey: input.commandKey, payloadHash, submittedByUserId: ctx.userId } });
      await this.audit(tx, ctx.userId, 'finance.cod.deposit.submitted', 'CodDeposit', dep.id, rider.countryId);
      await this.outbox(tx, 'CodDeposit', dep.id, 'finance.cod.deposit.submitted', rider.countryId, { amountMinor: amount.toString(), currency: input.currency, method: input.method });
      return this.depositJson(dep, false);
    });
  }
  private depositJson(d: any, duplicate = false) { return { depositId: d.id, riderId: d.riderId, countryId: d.countryId, amountMinor: d.amountMinor.toString(), currency: d.currency, method: d.method, externalReference: d.externalReference, status: d.status, version: d.version, journalId: d.journalId, duplicate }; }
  private reviewer(ctx: AccessContext, countryId: string) {
    if (!hasPermission(ctx, 'finance:cod:review')) throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'COD deposit review permission is required' });
    if (ctx.assurance !== 'STEP_UP') throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Recent step-up is required' });
    if (!inGeographicScope(ctx, { countryId })) throw new NotFoundException({ code: 'DEPOSIT_NOT_FOUND', message: 'Deposit not found' });
  }
  async listDeposits(ctx: AccessContext, countryId: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      this.reviewer(ctx, countryId);
      const items = await tx.codDeposit.findMany({ where: { countryId, status: 'PENDING_REVIEW' }, orderBy: { createdAt: 'asc' }, take: 100 });
      return { items: items.map((d: any) => this.depositJson(d)), nextCursor: null };
    });
  }
  async reviewDeposit(ctx: AccessContext, id: string, input: { expectedVersion: number; decision: 'VERIFY'|'REJECT'; commandKey: string; reason: string }) {
    key(input.commandKey); const reason = reasonText(input.reason);
    if (!['VERIFY','REJECT'].includes(input.decision)) throw new BadRequestException({ code: 'DECISION_INVALID', message: 'Invalid decision' });
    const payloadHash = hash({ id, expectedVersion: input.expectedVersion, decision: input.decision, reason });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rows = await tx.$queryRaw`SELECT * FROM "CodDeposit" WHERE "id"=${id}::uuid FOR UPDATE`;
      const dep = (rows as any[])[0];
      if (!dep) throw new NotFoundException({ code: 'DEPOSIT_NOT_FOUND', message: 'Deposit not found' });
      this.reviewer(ctx, dep.countryId);
      if (dep.submittedByUserId === ctx.userId) throw new ForbiddenException({ code: 'SELF_REVIEW_DENIED', message: 'Submitter cannot review their own deposit' });
      if (dep.reviewCommandKey === input.commandKey) { if (dep.reviewPayloadHash !== payloadHash) throw new ConflictException({ code: 'DEPOSIT_IDEMPOTENCY_CONFLICT', message: 'Command key already used with different payload' }); return this.depositJson(dep, true); }
      if (dep.status !== 'PENDING_REVIEW') throw new ConflictException({ code: 'DEPOSIT_ALREADY_REVIEWED', message: 'Deposit already reviewed' });
      if (dep.version !== input.expectedVersion) throw new ConflictException({ code: 'DEPOSIT_VERSION_CONFLICT', message: 'Deposit version conflict' });
      if (input.decision === 'REJECT') {
        const updated = await tx.codDeposit.update({ where: { id }, data: { status: 'REJECTED', version: { increment: 1 }, reviewedByUserId: ctx.userId, reviewedAt: new Date(), reviewCommandKey: input.commandKey, reviewPayloadHash: payloadHash, reviewReason: reason } });
        await this.audit(tx, ctx.userId, 'finance.cod.deposit.rejected', 'CodDeposit', id, dep.countryId, reason);
        return this.depositJson(updated);
      }
      // Serialize verification per rider+currency. Append-only collection rows are never UPDATE-locked.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cod-deposit:${dep.riderId}:${dep.currency}`}, 0))`;
      const collections = await tx.$queryRaw`SELECT * FROM "CodCollection" WHERE "riderId"=${dep.riderId}::uuid AND currency=${dep.currency}::varchar ORDER BY "collectedAt", id`;
      let remaining = dep.amountMinor as bigint;
      const allocations: { collectionId: string; amountMinor: bigint }[] = [];
      for (const col of collections as any[]) {
        if (remaining <= 0n) break;
        const allocated = await tx.codAllocation.aggregate({ where: { collectionId: col.id }, _sum: { amountMinor: true } });
        const outstanding = col.amountMinor - (allocated._sum.amountMinor ?? 0n);
        if (outstanding <= 0n) continue;
        const take = remaining < outstanding ? remaining : outstanding;
        allocations.push({ collectionId: col.id, amountMinor: take }); remaining -= take;
      }
      if (remaining > 0n) throw new ConflictException({ code: 'COD_DEPOSIT_EXCEEDS_DUE', message: 'Verified deposit exceeds outstanding COD custody; overpayment requires manual reconciliation' });
      const cash = await this.account(tx, `company-cod-cash:${dep.countryId}:${dep.currency}`, 'Company COD cash/bank', 'ASSET', dep.currency, ctx.userId);
      const custody = await this.account(tx, `rider-cod-custody:${dep.riderId}:${dep.currency}`, 'Rider COD custody', 'ASSET', dep.currency, ctx.userId);
      const journal = await this.postJournalTx(tx, { businessEventKey: `cod-deposit-${dep.id}`, currency: dep.currency, description: 'Verified COD deposit reduces rider custody', actor: ctx.userId, lines: [{ accountId: cash, side: 'DEBIT', amountMinor: dep.amountMinor }, { accountId: custody, side: 'CREDIT', amountMinor: dep.amountMinor }] });
      const updated = await tx.codDeposit.update({ where: { id }, data: { status: 'VERIFIED', version: { increment: 1 }, reviewedByUserId: ctx.userId, reviewedAt: new Date(), reviewCommandKey: input.commandKey, reviewPayloadHash: payloadHash, reviewReason: reason, journalId: journal.journalId } });
      for (const a of allocations) await tx.codAllocation.create({ data: { depositId: dep.id, collectionId: a.collectionId, amountMinor: a.amountMinor } });
      await this.audit(tx, ctx.userId, 'finance.cod.deposit.verified', 'CodDeposit', id, dep.countryId, reason);
      await this.outbox(tx, 'CodDeposit', id, 'finance.cod.deposit.verified', dep.countryId, { amountMinor: dep.amountMinor.toString(), currency: dep.currency, allocations: allocations.length });
      return this.depositJson(updated);
    }, { timeout: 30000 });
  }

  async wallet(ctx: AccessContext) {
    const riderId = this.requireRider(ctx);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const earnings = await tx.riderEarning.groupBy({ by: ['currency'], where: { riderId }, _sum: { amountMinor: true } });
      const collections = await tx.codCollection.groupBy({ by: ['currency'], where: { riderId }, _sum: { amountMinor: true } });
      const allocations = await tx.$queryRaw`SELECT d.currency, COALESCE(SUM(a."amountMinor"),0)::bigint AS allocated FROM "CodAllocation" a JOIN "CodDeposit" d ON d.id=a."depositId" WHERE d."riderId"=${riderId}::uuid AND d.status='VERIFIED' GROUP BY d.currency`;
      const currencies = [...new Set([...earnings.map((e: any) => e.currency), ...collections.map((c: any) => c.currency), ...(allocations as any[]).map(a => a.currency)])].sort();
      const balances = currencies.map(currency => {
        const earned = earnings.find((e: any) => e.currency === currency)?._sum.amountMinor ?? 0n;
        const collected = collections.find((c: any) => c.currency === currency)?._sum.amountMinor ?? 0n;
        const allocated = (allocations as any[]).find(a => a.currency === currency)?.allocated ?? 0n;
        return { currency, earningsPostedMinor: earned.toString(), codCollectedMinor: collected.toString(), codVerifiedDepositsMinor: allocated.toString(), codDueMinor: codDueMinor(collected, allocated).toString() };
      });
      return { riderId, balances, withdrawableMinor: null, payoutEnabled: false, note: 'COD custody is separate from earnings; payout/offset requires a later approved policy.' };
    });
  }
}
