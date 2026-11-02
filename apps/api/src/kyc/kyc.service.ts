import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService, PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { ENV } from '../common/env.js';
import type { ApiEnv } from '@getstoopy/config';
import { hasPermission, inGeographicScope, isKycEligible, kycDecisionTarget, type AccessContext, type KycCaseStatus, type KycDecision, type KycSubjectType } from '@getstoopy/core';
import { signStorageToken } from '@getstoopy/storage';

const REVIEW_PERMISSION = 'kyc:case:review';
const SELF_SERVICE_SUBJECTS: KycSubjectType[] = ['VENDOR', 'RIDER'];
const DOCUMENT_TYPES = new Set([
  'NID_FRONT', 'NID_BACK', 'PASSPORT', 'TRADE_LICENSE', 'TIN', 'BIN', 'VAT',
  'DRIVING_LICENSE', 'VEHICLE_REGISTRATION', 'VEHICLE_FITNESS', 'TAX_TOKEN', 'INSURANCE',
  'AUTHORIZATION_LETTER', 'BOARD_RESOLUTION', 'STORE_PHOTO', 'ADDRESS_PROOF', 'PROFILE_PHOTO'
]);

export interface CreateKycCaseInput { subjectType: KycSubjectType; countryId: string; policyVersion: string; consentVersion: string; consent: boolean; }
export interface LinkKycDocumentInput { storageObjectId: string; documentType: string; expiresAt?: string; }
export interface KycDecisionInput { version: number; commandKey: string; decision: KycDecision; reason: string; verificationMethod?: string; expiresAt?: string; }

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function decisionHash(input: KycDecisionInput): string {
  return sha256(JSON.stringify({ version: input.version, decision: input.decision, reason: input.reason.trim(), verificationMethod: input.verificationMethod ?? 'MANUAL_DOCUMENT_REVIEW', expiresAt: input.expiresAt ?? null }));
}

@Injectable()
export class KycService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService, @Inject(PrivilegedPrismaService) private readonly privileged: PrivilegedPrismaService, @Inject(ENV) private readonly env: ApiEnv) {}

  private async audit(tx: any, ctx: AccessContext, action: string, resourceId: string, countryId: string, reason?: string) {
    await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType","sessionId",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES (gen_random_uuid(), ${ctx.userId}::uuid, 'USER', ${ctx.sessionId}::uuid, ${action}, 'KycCase', ${resourceId}::uuid, ${JSON.stringify({ countryId })}::jsonb, ${reason ?? null}, ${randomUUID()})`;
  }
  private async outbox(tx: any, caseId: string, eventType: string, eventKey: string, countryId: string, data: Record<string, unknown>) {
    const occurredAt = new Date();
    await tx.outboxEvent.create({ data: { aggregateType: 'KycCase', aggregateId: caseId, eventKey, eventType, occurredAt, payload: { schemaVersion: 1, eventKey, eventType, occurredAt: occurredAt.toISOString(), aggregateType: 'KycCase', aggregateId: caseId, countryId, data } } });
  }
  private requireReviewerBase(ctx: AccessContext) {
    if (!hasPermission(ctx, REVIEW_PERMISSION)) throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'KYC review permission is required' });
    if (ctx.assurance !== 'STEP_UP') throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Recent step-up is required' });
  }
  private assertScope(ctx: AccessContext, countryId: string) {
    // Fail closed: this slice has only a country anchor. City/zone-delegated KYC needs vendor/rider address anchors first.
    if (!inGeographicScope(ctx, { countryId })) throw new NotFoundException({ code: 'KYC_CASE_NOT_FOUND', message: 'KYC case not found' });
  }
  private async lockCase(tx: any, caseId: string) {
    const rows = await tx.$queryRaw`SELECT "id","subjectUserId","subjectType","countryId","status","version" FROM "KycCase" WHERE "id"=${caseId}::uuid FOR UPDATE`;
    const row = (rows as any[])[0];
    if (!row) throw new NotFoundException({ code: 'KYC_CASE_NOT_FOUND', message: 'KYC case not found' });
    return row as { id: string; subjectUserId: string; subjectType: KycSubjectType; countryId: string; status: KycCaseStatus; version: number };
  }

  async createCase(ctx: AccessContext, input: CreateKycCaseInput) {
    if (!SELF_SERVICE_SUBJECTS.includes(input.subjectType)) throw new BadRequestException({ code: 'KYC_SUBJECT_NOT_SELF_SERVICE', message: 'Admin KYC requires an authorized invitation flow' });
    if (input.consent !== true) throw new BadRequestException({ code: 'KYC_CONSENT_REQUIRED', message: 'Explicit KYC consent is required' });
    if (!input.policyVersion?.trim() || !input.consentVersion?.trim()) throw new BadRequestException({ code: 'KYC_POLICY_VERSION_REQUIRED', message: 'Policy and consent versions are required' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const country = await tx.country.findFirst({ where: { id: input.countryId, status: 'ACTIVE' } });
      if (!country) throw new BadRequestException({ code: 'COUNTRY_NOT_AVAILABLE', message: 'Country is not available' });
      const existing = await tx.kycCase.findFirst({ where: { subjectUserId: ctx.userId, subjectType: input.subjectType, countryId: input.countryId, status: { in: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'MORE_INFORMATION'] } } });
      if (existing) {
        if (existing.policyVersion === input.policyVersion.trim() && existing.consentVersion === input.consentVersion.trim()) return { caseId: existing.id, status: existing.status, version: existing.version, duplicate: true };
        throw new ConflictException({ code: 'KYC_OPEN_CASE_EXISTS', message: 'An open KYC case already exists' });
      }
      const created = await tx.kycCase.create({ data: { subjectUserId: ctx.userId, subjectType: input.subjectType, countryId: input.countryId, policyVersion: input.policyVersion.trim(), consentVersion: input.consentVersion.trim(), consentedAt: new Date() } });
      await this.audit(tx, ctx, 'kyc.case.created', created.id, input.countryId);
      await this.outbox(tx, created.id, 'kyc.case.created', `kyc-created-${created.id}`, input.countryId, { subjectType: input.subjectType, version: created.version });
      return { caseId: created.id, status: created.status, version: created.version, duplicate: false };
    });
  }

  async linkDocument(ctx: AccessContext, caseId: string, input: LinkKycDocumentInput) {
    if (!DOCUMENT_TYPES.has(input.documentType)) throw new BadRequestException({ code: 'KYC_DOCUMENT_TYPE_INVALID', message: 'Document type is not allowed' });
    const documentExpiry = input.expiresAt ? new Date(input.expiresAt) : null;
    if (documentExpiry && (!Number.isFinite(documentExpiry.getTime()) || documentExpiry <= new Date())) throw new BadRequestException({ code: 'KYC_DOCUMENT_EXPIRY_INVALID', message: 'Document expiry must be in the future' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const kycCase = await this.lockCase(tx, caseId);
      if (kycCase.subjectUserId !== ctx.userId) throw new NotFoundException({ code: 'KYC_CASE_NOT_FOUND', message: 'KYC case not found' });
      if (!['DRAFT', 'MORE_INFORMATION'].includes(kycCase.status)) throw new ConflictException({ code: 'KYC_CASE_NOT_EDITABLE', message: 'KYC case is not editable' });
      const object = await tx.storageObject.findUnique({ where: { id: input.storageObjectId } });
      if (!object || object.ownerUserId !== ctx.userId || object.purpose !== 'kyc-document') throw new NotFoundException({ code: 'KYC_STORAGE_OBJECT_NOT_FOUND', message: 'KYC storage object not found' });
      if (object.state !== 'UPLOADED' || !object.magicValid || !object.sha256 || object.deletedAt) throw new ConflictException({ code: 'KYC_STORAGE_OBJECT_NOT_READY', message: 'KYC storage object must pass storage review before linking' });
      const existing = await tx.kycDocument.findUnique({ where: { storageObjectId: input.storageObjectId } });
      if (existing) {
        if (existing.caseId === caseId) return { documentId: existing.id, duplicate: true };
        throw new ConflictException({ code: 'KYC_DOCUMENT_ALREADY_LINKED', message: 'Storage object is already linked to a KYC case' });
      }
      const doc = await tx.kycDocument.create({ data: { caseId, storageObjectId: input.storageObjectId, documentType: input.documentType, contentHash: object.sha256, linkedByUserId: ctx.userId, ...(documentExpiry ? { expiresAt: documentExpiry } : {}) } });
      await this.audit(tx, ctx, 'kyc.document.linked', caseId, kycCase.countryId);
      return { documentId: doc.id, duplicate: false };
    });
  }

  async submitCase(ctx: AccessContext, caseId: string, version: number) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const kycCase = await this.lockCase(tx, caseId);
      if (kycCase.subjectUserId !== ctx.userId) throw new NotFoundException({ code: 'KYC_CASE_NOT_FOUND', message: 'KYC case not found' });
      if (kycCase.version !== version) throw new ConflictException({ code: 'KYC_VERSION_CONFLICT', message: 'KYC case version conflict' });
      if (!['DRAFT', 'MORE_INFORMATION'].includes(kycCase.status)) throw new ConflictException({ code: 'KYC_INVALID_TRANSITION', message: 'KYC case cannot be submitted from this state' });
      const docs = await tx.kycDocument.count({ where: { caseId } });
      if (docs < 1) throw new BadRequestException({ code: 'KYC_DOCUMENTS_REQUIRED', message: 'At least one reviewed KYC document is required' });
      const updated = await tx.kycCase.update({ where: { id: caseId }, data: { status: 'SUBMITTED', submittedAt: new Date(), version: { increment: 1 } } });
      await this.audit(tx, ctx, 'kyc.case.submitted', caseId, kycCase.countryId);
      await this.outbox(tx, caseId, 'kyc.case.submitted', `kyc-submitted-${caseId}-${updated.version}`, kycCase.countryId, { version: updated.version });
      return { caseId, status: updated.status, version: updated.version };
    });
  }

  async getOwnCase(ctx: AccessContext, caseId: string) {
    return this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      const found = await tx.kycCase.findFirst({ where: { id: caseId, subjectUserId: ctx.userId }, include: { documents: { select: { id: true, documentType: true, expiresAt: true, createdAt: true } }, reviews: { select: { decision: true, fromStatus: true, toStatus: true, reason: true, occurredAt: true }, orderBy: { occurredAt: 'asc' } } } });
      if (!found) throw new NotFoundException({ code: 'KYC_CASE_NOT_FOUND', message: 'KYC case not found' });
      return found;
    });
  }

  async eligibility(ctx: AccessContext, subjectType: KycSubjectType, countryId: string) {
    if (!SELF_SERVICE_SUBJECTS.includes(subjectType)) throw new BadRequestException({ code: 'KYC_SUBJECT_NOT_SELF_SERVICE', message: 'Admin eligibility is not exposed by this endpoint' });
    return this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      const found = await tx.kycCase.findFirst({ where: { subjectUserId: ctx.userId, subjectType, countryId, status: 'APPROVED', expiresAt: { gt: new Date() } }, orderBy: { reviewedAt: 'desc' } });
      const eligible = isKycEligible(found, subjectType);
      return { eligible, subjectType, countryId, caseId: eligible ? found!.id : null, expiresAt: eligible ? found!.expiresAt : null };
    });
  }

  async reviewQueue(ctx: AccessContext, countryId: string, status?: KycCaseStatus, limit = 20, cursor?: string) {
    this.requireReviewerBase(ctx);
    this.assertScope(ctx, countryId);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const items = await tx.kycCase.findMany({ where: { countryId, ...(status ? { status } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { documents: { select: { id: true, documentType: true, expiresAt: true } } } });
      const next = items.length > limit ? items[limit - 1]!.id : null;
      return { items: items.slice(0, limit), nextCursor: next };
    });
  }

  async decide(ctx: AccessContext, caseId: string, input: KycDecisionInput) {
    this.requireReviewerBase(ctx);
    if (!Number.isInteger(input.version) || input.version < 1) throw new BadRequestException({ code: 'KYC_VERSION_INVALID', message: 'A positive case version is required' });
    if (typeof input.commandKey !== 'string' || input.commandKey.trim().length < 8 || input.commandKey.length > 128) throw new BadRequestException({ code: 'KYC_COMMAND_KEY_INVALID', message: 'commandKey must be 8-128 characters' });
    if (typeof input.reason !== 'string' || input.reason.trim().length < 8 || input.reason.length > 512) throw new BadRequestException({ code: 'KYC_REASON_REQUIRED', message: 'A review reason is required' });
    const method = input.verificationMethod ?? 'MANUAL_DOCUMENT_REVIEW';
    if (method !== 'MANUAL_DOCUMENT_REVIEW') throw new BadRequestException({ code: 'KYC_VERIFICATION_METHOD_INVALID', message: 'Only manual document review is implemented' });
    const approvalExpiry = input.expiresAt ? new Date(input.expiresAt) : null;
    if (input.decision === 'APPROVE' && (!approvalExpiry || !Number.isFinite(approvalExpiry.getTime()) || approvalExpiry <= new Date())) throw new BadRequestException({ code: 'KYC_FUTURE_EXPIRY_REQUIRED', message: 'Approval requires a future expiry' });
    const payloadHash = decisionHash(input);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const kycCase = await this.lockCase(tx, caseId);
      this.assertScope(ctx, kycCase.countryId);
      if (kycCase.subjectUserId === ctx.userId) throw new ForbiddenException({ code: 'SELF_REVIEW_DENIED', message: 'Reviewer cannot review their own KYC case' });
      const existing = await tx.kycReview.findUnique({ where: { caseId_commandKey: { caseId, commandKey: input.commandKey } } });
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new ConflictException({ code: 'KYC_IDEMPOTENCY_CONFLICT', message: 'commandKey was already used with a different payload' });
        return { caseId, reviewId: existing.id, status: existing.toStatus, duplicate: true };
      }
      if (kycCase.version !== input.version) throw new ConflictException({ code: 'KYC_VERSION_CONFLICT', message: 'KYC case version conflict' });
      let target: KycCaseStatus;
      try { target = kycDecisionTarget(kycCase.status, input.decision); }
      catch { throw new ConflictException({ code: 'KYC_INVALID_TRANSITION', message: 'Decision is not valid from the current case state' }); }
      if (input.decision === 'APPROVE') {
        const docs = await tx.kycDocument.findMany({ where: { caseId }, include: { storageObject: true } });
        if (docs.length < 1) throw new BadRequestException({ code: 'KYC_DOCUMENTS_REQUIRED', message: 'At least one KYC document is required' });
        for (const doc of docs) {
          if (doc.expiresAt && doc.expiresAt <= new Date()) throw new ConflictException({ code: 'KYC_DOCUMENT_EXPIRED', message: 'A linked KYC document is expired' });
          if (doc.storageObject.state !== 'UPLOADED' || doc.storageObject.deletedAt || !doc.storageObject.magicValid) throw new ConflictException({ code: 'KYC_STORAGE_OBJECT_NOT_READY', message: 'Linked KYC evidence is not ready' });
        }
      }
      const review = await tx.kycReview.create({ data: { caseId, reviewerUserId: ctx.userId, commandKey: input.commandKey, payloadHash, decision: input.decision, fromStatus: kycCase.status, toStatus: target, reason: input.reason.trim(), verificationMethod: method } });
      const updated = await tx.kycCase.update({ where: { id: caseId }, data: { status: target, version: { increment: 1 }, reviewedAt: new Date(), ...(input.decision === 'APPROVE' ? { expiresAt: approvalExpiry } : {}), ...(input.decision === 'REVOKE' ? { expiresAt: null } : {}) } });
      await this.audit(tx, ctx, `kyc.case.${input.decision.toLowerCase()}`, caseId, kycCase.countryId, input.reason.trim());
      await this.outbox(tx, caseId, 'kyc.case.reviewed', `kyc-review-${review.id}`, kycCase.countryId, { decision: input.decision, fromStatus: kycCase.status, toStatus: target, version: updated.version });
      return { caseId, reviewId: review.id, status: updated.status, version: updated.version, duplicate: false };
    });
  }

  async documentAccess(ctx: AccessContext, caseId: string, documentId: string) {
    this.requireReviewerBase(ctx);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const kycCase = await tx.kycCase.findUnique({ where: { id: caseId } });
      if (!kycCase) throw new NotFoundException({ code: 'KYC_CASE_NOT_FOUND', message: 'KYC case not found' });
      this.assertScope(ctx, kycCase.countryId);
      if (kycCase.subjectUserId === ctx.userId) throw new ForbiddenException({ code: 'SELF_REVIEW_DENIED', message: 'Use owner storage access for your own documents' });
      const doc = await tx.kycDocument.findFirst({ where: { id: documentId, caseId }, include: { storageObject: true } });
      if (!doc || doc.storageObject.state !== 'UPLOADED' || doc.storageObject.deletedAt) throw new NotFoundException({ code: 'KYC_DOCUMENT_NOT_FOUND', message: 'KYC document not found' });
      await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType","sessionId",action,"resourceType","resourceId","scopeSnapshot","requestId") VALUES (gen_random_uuid(), ${ctx.userId}::uuid, 'USER', ${ctx.sessionId}::uuid, 'kyc.document.access', 'KycDocument', ${doc.id}::uuid, ${JSON.stringify({ countryId: kycCase.countryId, caseId })}::jsonb, ${randomUUID()})`;
      const token = signStorageToken({ objectId: doc.storageObjectId, action: 'download', exp: Date.now() + 60_000 }, this.env.STORAGE_ENCRYPTION_KEY);
      return { documentId: doc.id, downloadUrl: `/api/v1/storage/downloads/${doc.storageObjectId}?token=${encodeURIComponent(token)}`, expiresIn: 60, contentType: doc.storageObject.contentType };
    });
  }
}
