import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { assertLatitudeLongitude, hasPermission, inGeographicScope, riderDispatchEligibilityReasons, type AccessContext } from '@getstoopy/core';

function assertConsentVersion(version: string): string {
  const trimmed = version?.trim();
  if (!trimmed || trimmed.length > 64) throw new BadRequestException({ code: 'CONSENT_VERSION_INVALID', message: 'Invalid consent version' });
  return trimmed;
}
function assertReason(reason: string): string {
  const trimmed = reason?.trim();
  if (!trimmed || trimmed.length < 8 || trimmed.length > 512) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'A reason is required' });
  return trimmed;
}

@Injectable()
export class RiderEligibilityService {
  constructor(@Inject(PrivilegedPrismaService) private readonly privileged: PrivilegedPrismaService) {}

  private async audit(tx: any, ctx: AccessContext, action: string, resourceType: string, resourceId: string, countryId: string, reason?: string) {
    await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType","sessionId",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES (gen_random_uuid(), ${ctx.userId}::uuid, 'USER'::"ActorType", ${ctx.sessionId}::uuid, ${action}, ${resourceType}, ${resourceId}::uuid, ${JSON.stringify({ countryId })}::jsonb, ${reason ?? null}, ${randomUUID()}::uuid)`;
  }
  private async outbox(tx: any, aggregateType: string, aggregateId: string, eventType: string, eventKey: string, countryId: string, data: Record<string, unknown>) {
    const occurredAt = new Date();
    await tx.outboxEvent.create({ data: { aggregateType, aggregateId, eventKey, eventType, occurredAt, payload: { schemaVersion: 1, eventKey, eventType, occurredAt: occurredAt.toISOString(), aggregateType, aggregateId, countryId, data } } });
  }
  private async ownRider(tx: any, ctx: AccessContext) {
    const rider = await tx.riderProfile.findUnique({ where: { userId: ctx.userId }, include: { kycCase: true } });
    if (!rider) throw new NotFoundException({ code: 'RIDER_NOT_FOUND', message: 'Rider profile not found' });
    return rider;
  }
  private requireActiveRider(ctx: AccessContext) {
    if (!ctx.riderId) throw new ForbiddenException({ code: 'RIDER_KYC_REQUIRED', message: 'Active KYC-eligible rider profile is required' });
  }
  private requireZoneAdmin(ctx: AccessContext, countryId: string) {
    if (!hasPermission(ctx, 'rider:zone:grant')) throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Rider zone grant permission is required' });
    if (ctx.assurance !== 'STEP_UP') throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Recent step-up is required' });
    if (!inGeographicScope(ctx, { countryId })) throw new NotFoundException({ code: 'RIDER_NOT_FOUND', message: 'Rider profile not found' });
  }

  async setConsent(ctx: AccessContext, input: { consented: boolean; consentVersion: string }) {
    const consentVersion = assertConsentVersion(input.consentVersion);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rider = await this.ownRider(tx, ctx);
      const consent = await tx.riderLocationConsent.upsert({ where: { riderId: rider.id }, create: { riderId: rider.id, consented: input.consented, consentVersion }, update: { consented: input.consented, consentVersion } });
      await this.audit(tx, ctx, input.consented ? 'rider.location_consent.granted' : 'rider.location_consent.withdrawn', 'RiderProfile', rider.id, rider.countryId, consentVersion);
      await this.outbox(tx, 'RiderProfile', rider.id, input.consented ? 'rider.location_consent.granted' : 'rider.location_consent.withdrawn', `rider-consent-${rider.id}-${randomUUID()}`, rider.countryId, { consentVersion });
      return { riderId: rider.id, consented: consent.consented, consentVersion: consent.consentVersion };
    });
  }

  async startShift(ctx: AccessContext, input: { consentVersion: string }) {
    this.requireActiveRider(ctx);
    const consentVersion = assertConsentVersion(input.consentVersion);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rider = await this.ownRider(tx, ctx);
      const consent = await tx.riderLocationConsent.findUnique({ where: { riderId: rider.id } });
      if (!consent?.consented || consent.consentVersion !== consentVersion) throw new ConflictException({ code: 'RIDER_LOCATION_CONSENT_REQUIRED', message: 'Current location consent is required' });
      const existing = await tx.riderShift.findFirst({ where: { riderId: rider.id, status: 'ACTIVE' } });
      if (existing) {
        if (existing.consentVersion !== consentVersion) throw new ConflictException({ code: 'SHIFT_ALREADY_ACTIVE', message: 'An active shift already exists' });
        return { shiftId: existing.id, status: existing.status, consentVersion: existing.consentVersion, duplicate: true };
      }
      const shift = await tx.riderShift.create({ data: { riderId: rider.id, consentVersion } });
      await this.audit(tx, ctx, 'rider.shift.started', 'RiderShift', shift.id, rider.countryId, consentVersion);
      await this.outbox(tx, 'RiderProfile', rider.id, 'rider.shift.started', `rider-shift-started-${shift.id}`, rider.countryId, { shiftId: shift.id, consentVersion });
      return { shiftId: shift.id, status: shift.status, consentVersion: shift.consentVersion, duplicate: false };
    });
  }

  async endShift(ctx: AccessContext, shiftId: string) {
    this.requireActiveRider(ctx);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rider = await this.ownRider(tx, ctx);
      const shift = await tx.riderShift.findFirst({ where: { id: shiftId, riderId: rider.id } });
      if (!shift) throw new NotFoundException({ code: 'SHIFT_NOT_FOUND', message: 'Shift not found' });
      if (shift.status === 'ENDED') return { shiftId, status: shift.status, duplicate: true };
      const updated = await tx.riderShift.update({ where: { id: shiftId }, data: { status: 'ENDED', endedAt: new Date() } });
      await this.audit(tx, ctx, 'rider.shift.ended', 'RiderShift', shiftId, rider.countryId);
      await this.outbox(tx, 'RiderProfile', rider.id, 'rider.shift.ended', `rider-shift-ended-${shiftId}`, rider.countryId, { shiftId });
      return { shiftId, status: updated.status, duplicate: false };
    });
  }

  async recordLocation(ctx: AccessContext, input: { shiftId: string; latitude: number; longitude: number; accuracyMeters: number; recordedAt: string }) {
    this.requireActiveRider(ctx);
    try { assertLatitudeLongitude(input.latitude, input.longitude); } catch (e: any) { throw new BadRequestException({ code: e.message ?? 'COORDINATE_INVALID', message: 'Invalid coordinate' }); }
    if (!Number.isInteger(input.accuracyMeters) || input.accuracyMeters < 0 || input.accuracyMeters > 1000) throw new BadRequestException({ code: 'ACCURACY_INVALID', message: 'Invalid accuracy' });
    const recordedAt = new Date(input.recordedAt);
    if (!Number.isFinite(recordedAt.getTime())) throw new BadRequestException({ code: 'RECORDED_AT_INVALID', message: 'Invalid recordedAt' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rider = await this.ownRider(tx, ctx);
      const shift = await tx.riderShift.findFirst({ where: { id: input.shiftId, riderId: rider.id } });
      if (!shift) throw new NotFoundException({ code: 'SHIFT_NOT_FOUND', message: 'Shift not found' });
      if (shift.status !== 'ACTIVE') throw new ConflictException({ code: 'SHIFT_NOT_ACTIVE', message: 'Shift is not active' });
      const consent = await tx.riderLocationConsent.findUnique({ where: { riderId: rider.id } });
      if (!consent?.consented || consent.consentVersion !== shift.consentVersion) throw new ConflictException({ code: 'RIDER_LOCATION_CONSENT_REQUIRED', message: 'Current location consent is required' });
      const id = randomUUID();
      await tx.$executeRaw`INSERT INTO "RiderLocationSample"("id","riderId","shiftId","location","accuracyMeters","recordedAt") VALUES (${id}::uuid, ${rider.id}::uuid, ${input.shiftId}::uuid, ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}),4326), ${input.accuracyMeters}, ${recordedAt})`;
      return { sampleId: id, shiftId: input.shiftId, receivedAt: new Date() };
    });
  }

  async eligibility(ctx: AccessContext, serviceZoneId: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rider = await this.ownRider(tx, ctx);
      const activeShift = await tx.riderShift.findFirst({ where: { riderId: rider.id, status: 'ACTIVE' } });
      const consent = await tx.riderLocationConsent.findUnique({ where: { riderId: rider.id } });
      const zoneGrant = await tx.riderZoneGrant.findFirst({ where: { riderId: rider.id, serviceZoneId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { createdAt: 'desc' } });
      const latest = activeShift ? await tx.riderLocationSample.findFirst({ where: { riderId: rider.id, shiftId: activeShift.id }, orderBy: [{ recordedAt: 'desc' }, { receivedAt: 'desc' }] }) : null;
      const reasons = riderDispatchEligibilityReasons({
        status: rider.status, countryId: rider.countryId, kycCase: rider.kycCase,
        activeShift: activeShift ? { id: activeShift.id, consentVersion: activeShift.consentVersion } : null,
        consent: consent ? { consented: consent.consented, consentVersion: consent.consentVersion } : null,
        zoneGrant: zoneGrant ? { id: zoneGrant.id, expiresAt: zoneGrant.expiresAt?.toISOString() ?? null, revokedAt: zoneGrant.revokedAt?.toISOString() ?? null } : null,
        latestLocation: latest ? { accuracyMeters: latest.accuracyMeters, recordedAt: latest.recordedAt.toISOString(), receivedAt: latest.receivedAt.toISOString() } : null
      }, rider.countryId);
      return { riderId: rider.id, serviceZoneId, eligible: reasons.length === 0, reasons };
    });
  }

  async grantZone(ctx: AccessContext, riderId: string, input: { serviceZoneId: string; reason: string; expiresAt?: string }) {
    const reason = assertReason(input.reason);
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())) throw new BadRequestException({ code: 'EXPIRY_INVALID', message: 'Expiry must be in the future' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rider = await tx.riderProfile.findUnique({ where: { id: riderId } });
      if (!rider) throw new NotFoundException({ code: 'RIDER_NOT_FOUND', message: 'Rider profile not found' });
      this.requireZoneAdmin(ctx, rider.countryId);
      if (rider.userId === ctx.userId) throw new ForbiddenException({ code: 'SELF_GRANT_DENIED', message: 'Cannot grant own rider zone' });
      const grant = await tx.riderZoneGrant.create({ data: { riderId, serviceZoneId: input.serviceZoneId, grantedBy: ctx.userId, reason, ...(expiresAt ? { expiresAt } : {}) } });
      await this.audit(tx, ctx, 'rider.zone_grant.granted', 'RiderZoneGrant', grant.id, rider.countryId, reason);
      await this.outbox(tx, 'RiderProfile', riderId, 'rider.zone_grant.granted', `rider-zone-grant-${grant.id}`, rider.countryId, { serviceZoneId: input.serviceZoneId, expiresAt: expiresAt?.toISOString() ?? null });
      return { grantId: grant.id, riderId, serviceZoneId: grant.serviceZoneId, expiresAt: grant.expiresAt };
    });
  }

  async revokeZoneGrant(ctx: AccessContext, grantId: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const grant = await tx.riderZoneGrant.findUnique({ where: { id: grantId }, include: { rider: true } });
      if (!grant) throw new NotFoundException({ code: 'ZONE_GRANT_NOT_FOUND', message: 'Zone grant not found' });
      this.requireZoneAdmin(ctx, grant.rider.countryId);
      if (grant.revokedAt) return { grantId, revoked: true, duplicate: true };
      const updated = await tx.riderZoneGrant.update({ where: { id: grantId }, data: { revokedAt: new Date() } });
      await this.audit(tx, ctx, 'rider.zone_grant.revoked', 'RiderZoneGrant', grantId, grant.rider.countryId);
      await this.outbox(tx, 'RiderProfile', grant.riderId, 'rider.zone_grant.revoked', `rider-zone-grant-revoked-${grantId}`, grant.rider.countryId, { grantId });
      return { grantId, revoked: true, duplicate: false, revokedAt: updated.revokedAt };
    });
  }
}
