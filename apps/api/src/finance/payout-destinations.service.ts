import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { ENV } from '../common/env.js';
import type { ApiEnv } from '@getstoopy/config';
import { encryptJson } from '@getstoopy/bff';
import { assertDestinationUsable, DESTINATION_COOLDOWN_HOURS, destinationEligibleAt, destinationFingerprint, destinationMask, destinationPayloadHash, hasPermission, inGeographicScope, isPartyActiveWithKyc, normalizeDestinationDetails, normalizeRecipientPhone, type AccessContext, type DestinationDetails, type PayoutRail } from '@getstoopy/core';

export interface SubmitDestinationInput { countryId: string; currency: string; rail: PayoutRail; accountHolderName: string; accountNumber: string; institutionName: string; proofStorageObjectId: string; commandKey: string; }
export interface ReviewDestinationInput { expectedVersion: number; decision: 'VERIFY' | 'REJECT'; verificationReference: string; reason: string; commandKey: string; }

@Injectable()
export class PayoutDestinationsService {
  constructor(@Inject(PrivilegedPrismaService) private readonly privileged: PrivilegedPrismaService, @Inject(ENV) private readonly env: ApiEnv) {}
  private key(): string {
    const key = this.env.PAYOUT_DESTINATION_ENCRYPTION_KEY;
    if (!key) throw new ServiceUnavailableException({ code: 'DESTINATION_KEY_REQUIRED', message: 'Payout destination encryption is not configured' });
    return key;
  }
  private command(value: string) { if (!/^[A-Za-z0-9:_-]{8,128}$/.test(value)) throw new BadRequestException({ code: 'COMMAND_KEY_INVALID', message: 'Invalid command key' }); }
  private reason(value: string) { const r = value?.trim(); if (!r || r.length < 8 || r.length > 512) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'A reason of 8–512 characters is required' }); return r; }
  private reference(value: string) { const r = value?.trim(); if (!r || r.length < 8 || r.length > 128 || /[\r\n\0]/.test(r)) throw new BadRequestException({ code: 'VERIFICATION_REFERENCE_INVALID', message: 'A trusted verification reference of 8–128 characters is required' }); return r; }
  private owner(ctx: AccessContext, vendor: any) {
    if (!vendor || vendor.ownerUserId !== ctx.userId) throw new NotFoundException({ code: 'VENDOR_NOT_FOUND', message: 'Vendor not found' });
    if (ctx.assurance !== 'STEP_UP') throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Recent step-up is required' });
  }
  private reviewer(ctx: AccessContext, countryId: string) {
    if (!hasPermission(ctx, 'finance:payout-destination:review')) throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Payout destination review permission is required' });
    if (ctx.assurance !== 'STEP_UP') throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Recent step-up is required' });
    if (!inGeographicScope(ctx, { countryId })) throw new NotFoundException({ code: 'DESTINATION_NOT_FOUND', message: 'Destination not found' });
  }
  private async audit(tx: any, ctx: AccessContext, action: string, id: string, countryId: string, reason?: string) {
    await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType","sessionId",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES (gen_random_uuid(),${ctx.userId}::uuid,'USER'::"ActorType",${ctx.sessionId}::uuid,${action},'PayoutDestination',${id}::uuid,${JSON.stringify({ countryId })}::jsonb,${reason ?? null},${randomUUID()}::uuid)`;
  }
  private async outbox(tx: any, id: string, eventType: string, countryId: string, data: Record<string, unknown>) {
    const occurredAt = new Date(); const eventKey = `${eventType}-${id}`;
    await tx.outboxEvent.create({ data: { aggregateType: 'PayoutDestination', aggregateId: id, eventKey, eventType, occurredAt, payload: { schemaVersion: 1, eventKey, eventType, occurredAt: occurredAt.toISOString(), aggregateType: 'PayoutDestination', aggregateId: id, countryId, data } } });
  }
  private json(d: any, duplicate = false) { return { destinationId: d.id, vendorId: d.vendorId, countryId: d.countryId, currency: d.currency, rail: d.rail, displayMask: d.displayMask, proofStorageObjectId: d.proofStorageObjectId, status: d.status, version: d.version, verifiedAt: d.verifiedAt, eligibleAt: d.eligibleAt, cooldownHours: DESTINATION_COOLDOWN_HOURS, payoutEnabled: false, moneyMoved: false, duplicate }; }
  private async lockVendor(tx: any, id: string) {
    const rows = await tx.$queryRaw`SELECT v.* FROM "Vendor" v WHERE v.id=${id}::uuid FOR UPDATE`;
    const vendor = (rows as any[])[0];
    if (!vendor) throw new NotFoundException({ code: 'VENDOR_NOT_FOUND', message: 'Vendor not found' });
    return vendor;
  }
  private async eligibleVendor(tx: any, vendor: any) {
    const kyc = vendor.kycCaseId ? await tx.kycCase.findUnique({ where: { id: vendor.kycCaseId } }) : null;
    if (!isPartyActiveWithKyc({ ...vendor, kycCase: kyc }, 'VENDOR', vendor.countryId)) throw new ConflictException({ code: 'VENDOR_KYC_REQUIRED', message: 'Active KYC-approved vendor is required' });
  }
  async submit(ctx: AccessContext, vendorId: string, input: SubmitDestinationInput) {
    this.command(input.commandKey); const key = this.key();
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const vendor = await this.lockVendor(tx, vendorId); this.owner(ctx, vendor);
      const country = await tx.country.findUniqueOrThrow({ where: { id: vendor.countryId } });
      if (input.countryId !== vendor.countryId || input.currency !== country.currencyCode) throw new BadRequestException({ code: 'DESTINATION_COUNTRY_CURRENCY_MISMATCH', message: 'Destination must use the vendor country and its configured currency' });
      let details: DestinationDetails;
      try {
        const accountNumber = input.rail === 'MERCHANT_MFS' ? normalizeRecipientPhone(input.accountNumber, country.callingCode) : input.accountNumber;
        details = normalizeDestinationDetails({ rail: input.rail, accountHolderName: input.accountHolderName, accountNumber, institutionName: input.institutionName });
      } catch (e: any) { throw new BadRequestException({ code: e.message ?? 'DESTINATION_DETAILS_INVALID', message: 'Invalid destination details' }); }
      const fingerprint = destinationFingerprint(details, key);
      const payloadHash = destinationPayloadHash({ details, proofStorageObjectId: input.proofStorageObjectId }, key);
      const prior = await tx.payoutDestination.findUnique({ where: { vendorId_commandKey: { vendorId, commandKey: input.commandKey } } });
      if (prior) { if (prior.payloadHash !== payloadHash) throw new ConflictException({ code: 'DESTINATION_IDEMPOTENCY_CONFLICT', message: 'Command key already used with different payload' }); return this.json(prior, true); }
      await this.eligibleVendor(tx, vendor);
      const duplicate = await tx.payoutDestination.findFirst({ where: { vendorId, currency: input.currency, rail: input.rail, fingerprint, status: { in: ['PENDING_REVIEW', 'VERIFIED'] } } });
      if (duplicate) throw new ConflictException({ code: 'DESTINATION_ALREADY_EXISTS', message: 'An equivalent pending or verified destination already exists' });
      const proof = await tx.storageObject.findUnique({ where: { id: input.proofStorageObjectId } });
      if (!proof || proof.ownerUserId !== ctx.userId || proof.purpose !== 'payout-destination-proof' || proof.state !== 'UPLOADED' || !proof.magicValid || proof.deletedAt) throw new ConflictException({ code: 'DESTINATION_PROOF_REQUIRED', message: 'Independently reviewed ownership proof is required' });
      const proofUsed = await tx.payoutDestination.findUnique({ where: { proofStorageObjectId: proof.id } });
      if (proofUsed) throw new ConflictException({ code: 'DESTINATION_PROOF_ALREADY_USED', message: 'Ownership proof is already linked to a destination' });
      const destination = await tx.payoutDestination.create({ data: { vendorId, countryId: vendor.countryId, currency: input.currency, rail: input.rail, detailsEnvelope: Buffer.from(encryptJson(details, key)), encryptionKeyId: 'payout-field-aes-256-gcm-v1', fingerprint, displayMask: destinationMask(details), proofStorageObjectId: proof.id, commandKey: input.commandKey, payloadHash, submittedByUserId: ctx.userId } });
      await this.audit(tx, ctx, 'finance.payout_destination.submitted', destination.id, vendor.countryId);
      await this.outbox(tx, destination.id, 'finance.payout_destination.submitted', vendor.countryId, { vendorId, rail: input.rail, currency: input.currency, status: destination.status });
      return this.json(destination);
    }, { timeout: 30000 });
  }
  async listMine(ctx: AccessContext, vendorId: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const vendor = await tx.vendor.findUnique({ where: { id: vendorId } }); this.owner(ctx, vendor);
      const rows = await tx.payoutDestination.findMany({ where: { vendorId }, orderBy: { createdAt: 'desc' }, take: 100 });
      return { items: rows.map(d => this.json(d)), nextCursor: null, payoutEnabled: false };
    });
  }
  async listPending(ctx: AccessContext, countryId: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      this.reviewer(ctx, countryId);
      const rows = await tx.payoutDestination.findMany({ where: { countryId, status: 'PENDING_REVIEW' }, orderBy: { createdAt: 'asc' }, take: 100 });
      return { items: rows.map(d => this.json(d)), nextCursor: null, payoutEnabled: false };
    });
  }
  async review(ctx: AccessContext, id: string, input: ReviewDestinationInput) {
    this.command(input.commandKey); const reason = this.reason(input.reason); const reference = this.reference(input.verificationReference);
    if (!['VERIFY', 'REJECT'].includes(input.decision)) throw new BadRequestException({ code: 'DECISION_INVALID', message: 'Invalid decision' });
    const payloadHash = destinationPayloadHash({ id, expectedVersion: input.expectedVersion, decision: input.decision, reference, reason }, this.key());
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const initial = await tx.payoutDestination.findUnique({ where: { id } });
      if (!initial) throw new NotFoundException({ code: 'DESTINATION_NOT_FOUND', message: 'Destination not found' });
      this.reviewer(ctx, initial.countryId);
      // Same vendor-first lock order as submission/retirement; serializes replacement.
      const vendor = await this.lockVendor(tx, initial.vendorId);
      const d = await tx.payoutDestination.findUniqueOrThrow({ where: { id } });
      if (d.submittedByUserId === ctx.userId || vendor.ownerUserId === ctx.userId) throw new ForbiddenException({ code: 'SELF_REVIEW_DENIED', message: 'Vendor owner cannot review their own destination' });
      const existing = await tx.payoutDestinationReview.findUnique({ where: { destinationId_commandKey: { destinationId: id, commandKey: input.commandKey } } });
      if (existing) { if (existing.payloadHash !== payloadHash) throw new ConflictException({ code: 'DESTINATION_IDEMPOTENCY_CONFLICT', message: 'Command key already used with different payload' }); return this.json(d, true); }
      if (d.status !== 'PENDING_REVIEW') throw new ConflictException({ code: 'DESTINATION_ALREADY_REVIEWED', message: 'Destination already reviewed' });
      if (d.version !== input.expectedVersion) throw new ConflictException({ code: 'DESTINATION_VERSION_CONFLICT', message: 'Destination version conflict' });
      await this.eligibleVendor(tx, vendor);
      const now = new Date(); const status = input.decision === 'VERIFY' ? 'VERIFIED' : 'REJECTED';
      if (status === 'VERIFIED') {
        const previous = await tx.payoutDestination.findFirst({ where: { vendorId: d.vendorId, currency: d.currency, status: 'VERIFIED', id: { not: id } } });
        if (previous) {
          const retired = await tx.payoutDestination.update({ where: { id: previous.id }, data: { status: 'RETIRED', version: { increment: 1 }, eligibleAt: null, reviewedByUserId: ctx.userId, reviewedAt: now, retiredAt: now, reviewReason: 'Replaced by independently verified destination' } });
          await tx.payoutDestinationReview.create({ data: { destinationId: previous.id, fromStatus: 'VERIFIED', toStatus: 'RETIRED', destinationVersion: retired.version, decision: 'RETIRE', actorUserId: ctx.userId, commandKey: `replace-${id}`, payloadHash: destinationPayloadHash({ id: previous.id, replacementId: id, decision: 'RETIRE' }, this.key()), reason: 'Replaced by independently verified destination; new destination cooldown applies' } });
          await this.audit(tx, ctx, 'finance.payout_destination.retired', previous.id, d.countryId, 'Replacement verified');
        }
      }
      const updated = await tx.payoutDestination.update({ where: { id }, data: { status, version: { increment: 1 }, reviewedByUserId: ctx.userId, reviewedAt: now, verificationReference: reference, reviewReason: reason, ...(status === 'VERIFIED' ? { verifiedAt: now, eligibleAt: destinationEligibleAt(now) } : {}) } });
      await tx.payoutDestinationReview.create({ data: { destinationId: id, fromStatus: 'PENDING_REVIEW', toStatus: status, destinationVersion: updated.version, decision: input.decision, actorUserId: ctx.userId, commandKey: input.commandKey, payloadHash, reason, verificationReference: reference } });
      await this.audit(tx, ctx, `finance.payout_destination.${status.toLowerCase()}`, id, d.countryId, reason);
      await this.outbox(tx, id, `finance.payout_destination.${status.toLowerCase()}`, d.countryId, { vendorId: d.vendorId, status, version: updated.version, eligibleAt: updated.eligibleAt?.toISOString() ?? null, payoutEnabled: false });
      return this.json(updated);
    }, { timeout: 30000 });
  }
  async retire(ctx: AccessContext, vendorId: string, id: string, input: { expectedVersion: number; commandKey: string; reason: string }) {
    this.command(input.commandKey); const reason = this.reason(input.reason); const key = this.key();
    const payloadHash = destinationPayloadHash({ id, expectedVersion: input.expectedVersion, reason, decision: 'RETIRE' }, key);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const vendor = await this.lockVendor(tx, vendorId); this.owner(ctx, vendor);
      const d = await tx.payoutDestination.findFirst({ where: { id, vendorId } });
      if (!d) throw new NotFoundException({ code: 'DESTINATION_NOT_FOUND', message: 'Destination not found' });
      const existing = await tx.payoutDestinationReview.findUnique({ where: { destinationId_commandKey: { destinationId: id, commandKey: input.commandKey } } });
      if (existing) { if (existing.payloadHash !== payloadHash) throw new ConflictException({ code: 'DESTINATION_IDEMPOTENCY_CONFLICT', message: 'Command key already used with different payload' }); return this.json(d, true); }
      if (d.status !== 'VERIFIED') throw new ConflictException({ code: 'DESTINATION_NOT_VERIFIED', message: 'Only a verified destination can be retired' });
      if (d.version !== input.expectedVersion) throw new ConflictException({ code: 'DESTINATION_VERSION_CONFLICT', message: 'Destination version conflict' });
      const now = new Date();
      const updated = await tx.payoutDestination.update({ where: { id }, data: { status: 'RETIRED', version: { increment: 1 }, eligibleAt: null, reviewedByUserId: ctx.userId, reviewedAt: now, retiredAt: now, reviewReason: reason } });
      await tx.payoutDestinationReview.create({ data: { destinationId: id, fromStatus: 'VERIFIED', toStatus: 'RETIRED', destinationVersion: updated.version, decision: 'RETIRE', actorUserId: ctx.userId, commandKey: input.commandKey, payloadHash, reason } });
      await this.audit(tx, ctx, 'finance.payout_destination.retired', id, vendor.countryId, reason);
      await this.outbox(tx, id, 'finance.payout_destination.retired', vendor.countryId, { vendorId, status: 'RETIRED', version: updated.version, payoutEnabled: false });
      return this.json(updated);
    }, { timeout: 30000 });
  }
  /** Future settlement must call this inside its transaction; never trust a client destination status. */
  async assertUsableTx(tx: any, destinationId: string, vendorId: string, countryId: string, currency: string) {
    const d = await tx.payoutDestination.findFirst({ where: { id: destinationId, vendorId }, include: { vendor: { include: { kycCase: true } } } });
    try { assertDestinationUsable(d ? { ...d, vendor: { ...d.vendor, kycCase: d.vendor.kycCase } } : null, countryId, currency); }
    catch { throw new ConflictException({ code: 'PAYOUT_DESTINATION_REQUIRED', message: 'A usable, verified, cooldown-complete destination with active vendor KYC is required' }); }
    return d;
  }
}
