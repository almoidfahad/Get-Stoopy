import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { assertIndependentRiskReview, hasPermission, inGeographicScope, type AccessContext } from '@getstoopy/core';

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const NOT_FOUND = { code: 'RISK_CASE_NOT_FOUND', message: 'Risk case not found' };

/**
 * Scoped, step-up-gated manual review of fraud-risk cases.
 *
 * This service cannot create cases, set signal weights, move money, suspend an
 * account or grant a permission. Evidence and scoring stay in the database and
 * the versioned core policy; a reviewer only records an independent decision.
 */
@Injectable()
export class RiskCasesService {
  constructor(@Inject(PrivilegedPrismaService) private readonly db: PrivilegedPrismaService) {}

  private authority(ctx: AccessContext, countryId: string) {
    if (!hasPermission(ctx, 'risk:case:review')) throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Risk review permission required' });
    if (ctx.assurance !== 'STEP_UP') throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Recent step-up required' });
    // Out-of-scope cases are indistinguishable from missing ones.
    if (!inGeographicScope(ctx, { countryId })) throw new NotFoundException(NOT_FOUND);
  }

  private reason(value: string) {
    if (typeof value !== 'string' || value.trim().length < 8 || value.length > 512) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'Reason must be 8-512 characters' });
    return value.trim();
  }

  private key(value: string) {
    if (!/^[A-Za-z0-9:_-]{8,128}$/.test(value)) throw new BadRequestException({ code: 'COMMAND_KEY_INVALID', message: 'Invalid command key' });
  }

  private async audit(tx: any, ctx: AccessContext, action: string, id: string, countryId: string, reason?: string) {
    await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType","sessionId",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES(gen_random_uuid(),${ctx.userId}::uuid,'USER',${ctx.sessionId}::uuid,${action},'RiskCase',${id}::uuid,${JSON.stringify({ countryId })}::jsonb,${reason ?? null},${randomUUID()}::uuid)`;
  }

  /** Queue listing stays aggregate: no subject identifiers leave this endpoint. */
  async list(ctx: AccessContext, countryId: string) {
    this.authority(ctx, countryId);
    return this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const items = await tx.riskCase.findMany({
        where: { countryId, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
        orderBy: [{ createdAt: 'desc' }],
        take: 100,
        select: { id: true, kind: true, status: true, score: true, band: true, policyVersion: true, version: true, createdAt: true }
      });
      return { items, automatedEnforcement: false as const };
    });
  }

  /** Opening a case file exposes subject linkage, so the read itself is audited. */
  async detail(ctx: AccessContext, id: string) {
    return this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const record = await tx.riskCase.findUnique({ where: { id } });
      if (!record) throw new NotFoundException(NOT_FOUND);
      this.authority(ctx, record.countryId);
      const signals = await tx.riskSignal.findMany({ where: { caseId: id }, orderBy: { observedAt: 'asc' }, select: { code: true, weight: true, summary: true, observedAt: true } });
      const reviews = await tx.riskCaseReview.findMany({ where: { caseId: id }, orderBy: { occurredAt: 'asc' }, select: { decision: true, reason: true, caseVersion: true, occurredAt: true } });
      await this.audit(tx, ctx, 'risk.case.read', id, record.countryId);
      return {
        id: record.id, countryId: record.countryId, subjectUserId: record.subjectUserId, orderId: record.orderId,
        kind: record.kind, status: record.status, score: record.score, band: record.band,
        policyVersion: record.policyVersion, version: record.version, createdAt: record.createdAt,
        resolvedAt: record.resolvedAt, resolutionReason: record.resolutionReason,
        signals, reviews, automatedEnforcement: false as const
      };
    });
  }

  async review(ctx: AccessContext, id: string, input: { expectedVersion: number; decision: 'CLEAR' | 'CONFIRM_FRAUD'; reason: string; commandKey: string }) {
    this.key(input.commandKey);
    const reason = this.reason(input.reason);
    const payloadHash = hash({ id, expectedVersion: input.expectedVersion, decision: input.decision, reason, commandKey: input.commandKey });

    return this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rows = await tx.$queryRaw`SELECT * FROM "RiskCase" WHERE id=${id}::uuid FOR UPDATE`;
      const record = (rows as any[])[0];
      if (!record) throw new NotFoundException(NOT_FOUND);
      this.authority(ctx, record.countryId);

      const prior = await tx.riskCaseReview.findUnique({ where: { caseId_commandKey: { caseId: id, commandKey: input.commandKey } } });
      if (prior) {
        if (prior.payloadHash !== payloadHash) throw new ConflictException({ code: 'RISK_IDEMPOTENCY_CONFLICT', message: 'Command payload conflict' });
        return { caseId: id, status: record.status, version: record.version, duplicate: true, automatedEnforcement: false as const };
      }

      if (!['OPEN', 'UNDER_REVIEW'].includes(record.status) || record.version !== input.expectedVersion) {
        throw new ConflictException({ code: 'RISK_VERSION_OR_STATE', message: 'Case is not reviewable at this version' });
      }

      try {
        assertIndependentRiskReview({ decision: input.decision, reviewerUserId: ctx.userId, openedByUserId: record.openedByUserId, subjectUserId: record.subjectUserId, reason });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'RISK_REVIEW_INVALID';
        throw new ForbiddenException({ code, message: 'Independent, explained review required' });
      }

      const status = input.decision === 'CLEAR' ? 'CLEARED' : 'CONFIRMED_FRAUD';
      const version = record.version + 1;
      // The DB requires this record before it accepts the terminal transition.
      await tx.riskCaseReview.create({ data: { caseId: id, reviewerUserId: ctx.userId, decision: input.decision, caseVersion: version, commandKey: input.commandKey, payloadHash, reason } });
      await tx.riskCase.update({ where: { id }, data: { status, version, resolvedByUserId: ctx.userId, resolvedAt: new Date(), resolutionReason: reason } });
      // Audit and outbox rows are written by the database guard, not here, so a
      // direct SQL path cannot bypass them.
      return { caseId: id, status, version, duplicate: false, automatedEnforcement: false as const };
    }, { timeout: 30000 });
  }
}
