import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService, PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { hasPermission, inGeographicScope, isKycEligible, type AccessContext, type RiderVehicleType, type VendorMembershipRole } from '@getstoopy/core';

const VEHICLE_TYPES: RiderVehicleType[] = ['BICYCLE', 'MOTORBIKE', 'CAR', 'OTHER'];
const ASSIGNABLE_ROLES: VendorMembershipRole[] = ['MANAGER', 'STAFF'];

export interface CreateVendorInput { countryId: string; displayName: string; legalName?: string; }
export interface CreateRiderInput { countryId: string; vehicleType: RiderVehicleType; }
export interface ActivatePartyInput { version: number; kycCaseId: string; reason: string; }
export interface SuspendPartyInput { version: number; reason: string; }
export interface GrantMembershipInput { userId: string; role: VendorMembershipRole; storeId?: string; expiresAt?: string; }

@Injectable()
export class PartyService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService, @Inject(PrivilegedPrismaService) private readonly privileged: PrivilegedPrismaService) {}

  private async audit(tx: any, ctx: AccessContext, action: string, resourceType: string, resourceId: string, countryId: string, reason?: string) {
    await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType","sessionId",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES (gen_random_uuid(), ${ctx.userId}::uuid, 'USER', ${ctx.sessionId}::uuid, ${action}, ${resourceType}, ${resourceId}::uuid, ${JSON.stringify({ countryId })}::jsonb, ${reason ?? null}, ${randomUUID()})`;
  }
  private async outbox(tx: any, aggregateType: string, aggregateId: string, eventType: string, eventKey: string, countryId: string, data: Record<string, unknown>) {
    const occurredAt = new Date();
    await tx.outboxEvent.create({ data: { aggregateType, aggregateId, eventKey, eventType, occurredAt, payload: { schemaVersion: 1, eventKey, eventType, occurredAt: occurredAt.toISOString(), aggregateType, aggregateId, countryId, data } } });
  }
  private requireAdmin(ctx: AccessContext, permission: string, countryId: string) {
    if (!hasPermission(ctx, permission)) throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Party activation permission is required' });
    if (ctx.assurance !== 'STEP_UP') throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Recent step-up is required' });
    if (!inGeographicScope(ctx, { countryId })) throw new NotFoundException({ code: 'PARTY_NOT_FOUND', message: 'Party profile not found' });
  }
  private reason(reason: string) {
    if (typeof reason !== 'string' || reason.trim().length < 8 || reason.length > 512) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'A reason is required' });
    return reason.trim();
  }
  private async assertKycCase(tx: any, kycCaseId: string, subjectUserId: string, subjectType: 'VENDOR' | 'RIDER', countryId: string) {
    const kyc = await tx.kycCase.findUnique({ where: { id: kycCaseId } });
    if (!kyc || kyc.subjectUserId !== subjectUserId || kyc.subjectType !== subjectType || kyc.countryId !== countryId || !isKycEligible(kyc, subjectType)) {
      throw new ConflictException({ code: 'PARTY_KYC_APPROVAL_REQUIRED', message: 'An unexpired approved KYC case for this subject/country is required' });
    }
    return kyc;
  }

  async createVendor(ctx: AccessContext, input: CreateVendorInput) {
    const displayName = input.displayName?.trim();
    if (!displayName || displayName.length < 2 || displayName.length > 120) throw new BadRequestException({ code: 'DISPLAY_NAME_INVALID', message: 'displayName must be 2-120 characters' });
    if (input.legalName !== undefined && input.legalName.trim().length > 200) throw new BadRequestException({ code: 'LEGAL_NAME_INVALID', message: 'legalName is too long' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const country = await tx.country.findFirst({ where: { id: input.countryId, status: 'ACTIVE' } });
      if (!country) throw new BadRequestException({ code: 'COUNTRY_NOT_AVAILABLE', message: 'Country is not available' });
      const existing = await tx.vendor.findUnique({ where: { ownerUserId_countryId: { ownerUserId: ctx.userId, countryId: input.countryId } } });
      if (existing) return { vendorId: existing.id, status: existing.status, version: existing.version, duplicate: true };
      const vendor = await tx.vendor.create({ data: { ownerUserId: ctx.userId, countryId: input.countryId, displayName, ...(input.legalName?.trim() ? { legalName: input.legalName.trim() } : {}) } });
      await tx.vendorMembership.create({ data: { vendorId: vendor.id, userId: ctx.userId, role: 'OWNER', grantedBy: ctx.userId } });
      await this.audit(tx, ctx, 'party.vendor.created', 'Vendor', vendor.id, input.countryId);
      await this.outbox(tx, 'Vendor', vendor.id, 'party.vendor.created', `vendor-created-${vendor.id}`, input.countryId, { version: vendor.version });
      return { vendorId: vendor.id, status: vendor.status, version: vendor.version, duplicate: false };
    });
  }

  async createRider(ctx: AccessContext, input: CreateRiderInput) {
    if (!VEHICLE_TYPES.includes(input.vehicleType)) throw new BadRequestException({ code: 'VEHICLE_TYPE_INVALID', message: 'Vehicle type is not allowed' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const country = await tx.country.findFirst({ where: { id: input.countryId, status: 'ACTIVE' } });
      if (!country) throw new BadRequestException({ code: 'COUNTRY_NOT_AVAILABLE', message: 'Country is not available' });
      const existing = await tx.riderProfile.findUnique({ where: { userId: ctx.userId } });
      if (existing) return { riderId: existing.id, status: existing.status, version: existing.version, duplicate: true };
      const rider = await tx.riderProfile.create({ data: { userId: ctx.userId, countryId: input.countryId, vehicleType: input.vehicleType } });
      await this.audit(tx, ctx, 'party.rider.created', 'RiderProfile', rider.id, input.countryId);
      await this.outbox(tx, 'RiderProfile', rider.id, 'party.rider.created', `rider-created-${rider.id}`, input.countryId, { version: rider.version, vehicleType: rider.vehicleType });
      return { riderId: rider.id, status: rider.status, version: rider.version, duplicate: false };
    });
  }

  async myVendor(ctx: AccessContext) {
    return this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      return tx.vendor.findMany({ where: { ownerUserId: ctx.userId }, orderBy: { createdAt: 'desc' } });
    });
  }
  async myRider(ctx: AccessContext) {
    return this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      return tx.riderProfile.findUnique({ where: { userId: ctx.userId } });
    });
  }

  async activateVendor(ctx: AccessContext, vendorId: string, input: ActivatePartyInput) {
    const reason = this.reason(input.reason);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rows = await tx.$queryRaw`SELECT "id","ownerUserId","countryId","status","version" FROM "Vendor" WHERE "id"=${vendorId}::uuid FOR UPDATE`;
      const vendor = (rows as any[])[0];
      if (!vendor) throw new NotFoundException({ code: 'PARTY_NOT_FOUND', message: 'Party profile not found' });
      this.requireAdmin(ctx, 'vendor:profile:activate', vendor.countryId);
      if (vendor.ownerUserId === ctx.userId) throw new ForbiddenException({ code: 'SELF_ACTIVATION_DENIED', message: 'Owner cannot activate their own vendor profile' });
      if (vendor.version !== input.version) throw new ConflictException({ code: 'PARTY_VERSION_CONFLICT', message: 'Party version conflict' });
      if (!['DRAFT', 'SUSPENDED', 'RESTRICTED'].includes(vendor.status)) throw new ConflictException({ code: 'PARTY_INVALID_TRANSITION', message: 'Vendor cannot be activated from this state' });
      await this.assertKycCase(tx, input.kycCaseId, vendor.ownerUserId, 'VENDOR', vendor.countryId);
      const updated = await tx.vendor.update({ where: { id: vendorId }, data: { status: 'ACTIVE', kycCaseId: input.kycCaseId, activatedAt: new Date(), activatedByUserId: ctx.userId, suspendedAt: null, version: { increment: 1 } } });
      await this.audit(tx, ctx, 'party.vendor.activated', 'Vendor', vendorId, vendor.countryId, reason);
      await this.outbox(tx, 'Vendor', vendorId, 'party.vendor.activated', `vendor-activated-${vendorId}-${updated.version}`, vendor.countryId, { version: updated.version, kycCaseId: input.kycCaseId });
      return { vendorId, status: updated.status, version: updated.version };
    });
  }

  async suspendVendor(ctx: AccessContext, vendorId: string, input: SuspendPartyInput) {
    const reason = this.reason(input.reason);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rows = await tx.$queryRaw`SELECT "id","countryId","status","version" FROM "Vendor" WHERE "id"=${vendorId}::uuid FOR UPDATE`;
      const vendor = (rows as any[])[0];
      if (!vendor) throw new NotFoundException({ code: 'PARTY_NOT_FOUND', message: 'Party profile not found' });
      this.requireAdmin(ctx, 'vendor:profile:suspend', vendor.countryId);
      if (vendor.version !== input.version) throw new ConflictException({ code: 'PARTY_VERSION_CONFLICT', message: 'Party version conflict' });
      if (vendor.status !== 'ACTIVE') throw new ConflictException({ code: 'PARTY_INVALID_TRANSITION', message: 'Vendor cannot be suspended from this state' });
      const updated = await tx.vendor.update({ where: { id: vendorId }, data: { status: 'SUSPENDED', suspendedAt: new Date(), version: { increment: 1 } } });
      await this.audit(tx, ctx, 'party.vendor.suspended', 'Vendor', vendorId, vendor.countryId, reason);
      await this.outbox(tx, 'Vendor', vendorId, 'party.vendor.suspended', `vendor-suspended-${vendorId}-${updated.version}`, vendor.countryId, { version: updated.version });
      return { vendorId, status: updated.status, version: updated.version };
    });
  }

  async activateRider(ctx: AccessContext, riderId: string, input: ActivatePartyInput) {
    const reason = this.reason(input.reason);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rows = await tx.$queryRaw`SELECT "id","userId","countryId","status","version" FROM "RiderProfile" WHERE "id"=${riderId}::uuid FOR UPDATE`;
      const rider = (rows as any[])[0];
      if (!rider) throw new NotFoundException({ code: 'PARTY_NOT_FOUND', message: 'Party profile not found' });
      this.requireAdmin(ctx, 'rider:profile:activate', rider.countryId);
      if (rider.userId === ctx.userId) throw new ForbiddenException({ code: 'SELF_ACTIVATION_DENIED', message: 'Rider cannot activate their own profile' });
      if (rider.version !== input.version) throw new ConflictException({ code: 'PARTY_VERSION_CONFLICT', message: 'Party version conflict' });
      if (!['DRAFT', 'SUSPENDED', 'RESTRICTED'].includes(rider.status)) throw new ConflictException({ code: 'PARTY_INVALID_TRANSITION', message: 'Rider cannot be activated from this state' });
      await this.assertKycCase(tx, input.kycCaseId, rider.userId, 'RIDER', rider.countryId);
      const updated = await tx.riderProfile.update({ where: { id: riderId }, data: { status: 'ACTIVE', kycCaseId: input.kycCaseId, activatedAt: new Date(), activatedByUserId: ctx.userId, suspendedAt: null, version: { increment: 1 } } });
      await this.audit(tx, ctx, 'party.rider.activated', 'RiderProfile', riderId, rider.countryId, reason);
      await this.outbox(tx, 'RiderProfile', riderId, 'party.rider.activated', `rider-activated-${riderId}-${updated.version}`, rider.countryId, { version: updated.version, kycCaseId: input.kycCaseId });
      return { riderId, status: updated.status, version: updated.version };
    });
  }

  async suspendRider(ctx: AccessContext, riderId: string, input: SuspendPartyInput) {
    const reason = this.reason(input.reason);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rows = await tx.$queryRaw`SELECT "id","countryId","status","version" FROM "RiderProfile" WHERE "id"=${riderId}::uuid FOR UPDATE`;
      const rider = (rows as any[])[0];
      if (!rider) throw new NotFoundException({ code: 'PARTY_NOT_FOUND', message: 'Party profile not found' });
      this.requireAdmin(ctx, 'rider:profile:suspend', rider.countryId);
      if (rider.version !== input.version) throw new ConflictException({ code: 'PARTY_VERSION_CONFLICT', message: 'Party version conflict' });
      if (rider.status !== 'ACTIVE') throw new ConflictException({ code: 'PARTY_INVALID_TRANSITION', message: 'Rider cannot be suspended from this state' });
      const updated = await tx.riderProfile.update({ where: { id: riderId }, data: { status: 'SUSPENDED', suspendedAt: new Date(), version: { increment: 1 } } });
      await this.audit(tx, ctx, 'party.rider.suspended', 'RiderProfile', riderId, rider.countryId, reason);
      await this.outbox(tx, 'RiderProfile', riderId, 'party.rider.suspended', `rider-suspended-${riderId}-${updated.version}`, rider.countryId, { version: updated.version });
      return { riderId, status: updated.status, version: updated.version };
    });
  }

  private async requireVendorOwner(tx: any, ctx: AccessContext, vendorId: string) {
    const vendor = await tx.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor || vendor.ownerUserId !== ctx.userId) throw new NotFoundException({ code: 'PARTY_NOT_FOUND', message: 'Party profile not found' });
    if (ctx.assurance !== 'STEP_UP') throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Recent step-up is required' });
    return vendor;
  }

  async grantMembership(ctx: AccessContext, vendorId: string, input: GrantMembershipInput) {
    if (!ASSIGNABLE_ROLES.includes(input.role)) throw new BadRequestException({ code: 'MEMBERSHIP_ROLE_INVALID', message: 'Only MANAGER or STAFF can be granted' });
    if (input.userId === ctx.userId) throw new BadRequestException({ code: 'SELF_MEMBERSHIP_INVALID', message: 'Owner membership is created with the vendor' });
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())) throw new BadRequestException({ code: 'MEMBERSHIP_EXPIRY_INVALID', message: 'Membership expiry must be in the future' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const vendor = await this.requireVendorOwner(tx, ctx, vendorId);
      const target = await tx.user.findUnique({ where: { id: input.userId } });
      if (!target || target.status !== 'ACTIVE') throw new BadRequestException({ code: 'TARGET_USER_INVALID', message: 'Target user is not active' });
      if (input.storeId) {
        const store = await tx.store.findFirst({ where: { id: input.storeId, vendorId, countryId: vendor.countryId } });
        if (!store) throw new NotFoundException({ code: 'MEMBERSHIP_STORE_NOT_FOUND', message: 'Store not found for this vendor' });
      }
      const existing = await tx.vendorMembership.findUnique({ where: { vendorId_userId: { vendorId, userId: input.userId } } });
      if (existing) throw new ConflictException({ code: 'MEMBERSHIP_EXISTS', message: 'Membership already exists; revoke before regranting' });
      const membership = await tx.vendorMembership.create({ data: { vendorId, userId: input.userId, role: input.role, grantedBy: ctx.userId, ...(input.storeId ? { storeId: input.storeId } : {}), ...(expiresAt ? { expiresAt } : {}) } });
      await this.audit(tx, ctx, 'party.vendor.membership.granted', 'Vendor', vendorId, vendor.countryId);
      await this.outbox(tx, 'Vendor', vendorId, 'party.vendor.membership.granted', `membership-granted-${membership.id}`, vendor.countryId, { membershipId: membership.id, role: input.role, storeId: membership.storeId });
      return { membershipId: membership.id, role: membership.role, storeId: membership.storeId, expiresAt: membership.expiresAt };
    });
  }

  async revokeMembership(ctx: AccessContext, vendorId: string, membershipId: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const vendor = await this.requireVendorOwner(tx, ctx, vendorId);
      const membership = await tx.vendorMembership.findFirst({ where: { id: membershipId, vendorId } });
      if (!membership) throw new NotFoundException({ code: 'MEMBERSHIP_NOT_FOUND', message: 'Membership not found' });
      if (membership.role === 'OWNER') throw new ForbiddenException({ code: 'OWNER_MEMBERSHIP_LOCKED', message: 'Owner membership cannot be revoked here' });
      if (membership.revokedAt) return { membershipId, revoked: true, duplicate: true };
      const updated = await tx.vendorMembership.update({ where: { id: membershipId }, data: { revokedAt: new Date() } });
      await this.audit(tx, ctx, 'party.vendor.membership.revoked', 'Vendor', vendorId, vendor.countryId);
      await this.outbox(tx, 'Vendor', vendorId, 'party.vendor.membership.revoked', `membership-revoked-${membershipId}`, vendor.countryId, { membershipId });
      return { membershipId, revoked: true, duplicate: false, revokedAt: updated.revokedAt };
    });
  }

  async listMemberships(ctx: AccessContext, vendorId: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      await this.requireVendorOwner(tx, ctx, vendorId);
      return tx.vendorMembership.findMany({ where: { vendorId }, orderBy: { createdAt: 'asc' }, select: { id: true, userId: true, storeId: true, role: true, expiresAt: true, revokedAt: true, createdAt: true } });
    });
  }
}
