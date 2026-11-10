import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { assertLatitudeLongitude, assertOperatingHours, authorize, hasPermission, inGeographicScope, isAllowedPickupReview, isAllowedServiceAreaReview, isStoreDispatchServiceable, type AccessContext, type OperatingHourInput } from '@getstoopy/core';
import { MAX_PUBLIC_SERVICEABLE_CITIES, serviceableStoreWhere } from './serviceable-store.js';

function reasonText(reason: string): string {
  const trimmed = reason?.trim();
  if (!trimmed || trimmed.length < 8 || trimmed.length > 512) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'A reason is required' });
  return trimmed;
}
function assertVersion(version: number): void {
  if (!Number.isInteger(version) || version < 1) throw new BadRequestException({ code: 'VERSION_INVALID', message: 'Invalid version' });
}
const OPERATING_HOURS_ERRORS = new Set([
  'OPERATING_HOURS_INVALID', 'OPERATING_DAY_INVALID', 'OPERATING_OPEN_INVALID',
  'OPERATING_CLOSE_INVALID', 'OPERATING_WINDOW_INVALID', 'OPERATING_HOURS_OVERLAP',
]);

@Injectable()
export class ServiceabilityService {
  constructor(@Inject(PrivilegedPrismaService) private readonly privileged: PrivilegedPrismaService) {}

  /**
   * Cities a buyer can currently choose as a delivery destination.
   *
   * Aggregated with a groupBy so a large store table is never materialised in the
   * API process, and capped so an unbounded public query is impossible. `truncated`
   * is reported rather than silently dropping cities.
   */
  async publicServiceableCities(countryId: string, q?: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: '00000000-0000-0000-0000-000000000000', authorizationVersion: 0, isSuper: true });
      const country = await tx.country.findFirst({ where: { id: countryId, status: 'ACTIVE' } });
      if (!country) throw new NotFoundException({ code: 'COUNTRY_NOT_AVAILABLE', message: 'Country is not available' });
      const base = serviceableStoreWhere(countryId, new Date());
      const where = q ? { ...base, city: { status: 'ACTIVE' as const, name: { contains: q, mode: 'insensitive' as const } } } : base;
      const grouped = await tx.store.groupBy({
        by: ['cityId'],
        where,
        _count: { _all: true },
        orderBy: { cityId: 'asc' },
        take: MAX_PUBLIC_SERVICEABLE_CITIES + 1,
      });
      const truncated = grouped.length > MAX_PUBLIC_SERVICEABLE_CITIES;
      const page = truncated ? grouped.slice(0, MAX_PUBLIC_SERVICEABLE_CITIES) : grouped;
      const cities = page.length
        ? await tx.city.findMany({ where: { id: { in: page.map(g => g.cityId) } }, select: { id: true, name: true, code: true } })
        : [];
      const byId = new Map(cities.map(c => [c.id, c]));
      const items = page
        .map(g => {
          const city = byId.get(g.cityId);
          return city ? { cityId: city.id, name: city.name, code: city.code, storeCount: g._count._all } : null;
        })
        .filter((x): x is { cityId: string; name: string; code: string; storeCount: number } => x !== null)
        .sort((a, b) => (a.name === b.name ? a.cityId.localeCompare(b.cityId) : a.name.localeCompare(b.name)));
      return { countryId, currency: country.currencyCode, items, truncated };
    });
  }

  private async audit(tx: any, ctx: AccessContext, action: string, resourceType: string, resourceId: string, countryId: string, reason?: string) {
    await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType","sessionId",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES (gen_random_uuid(), ${ctx.userId}::uuid, 'USER'::"ActorType", ${ctx.sessionId}::uuid, ${action}, ${resourceType}, ${resourceId}::uuid, ${JSON.stringify({ countryId })}::jsonb, ${reason ?? null}, ${randomUUID()}::uuid)`;
  }
  private async outbox(tx: any, aggregateType: string, aggregateId: string, eventType: string, eventKey: string, countryId: string, data: Record<string, unknown>) {
    const occurredAt = new Date();
    await tx.outboxEvent.create({ data: { aggregateType, aggregateId, eventKey, eventType, occurredAt, payload: { schemaVersion: 1, eventKey, eventType, occurredAt: occurredAt.toISOString(), aggregateType, aggregateId, countryId, data } } });
  }
  private assertStoreMembership(ctx: AccessContext, vendorId: string, countryId: string, storeId: string) {
    const member = ctx.vendorMemberships.some(m => m.vendorId === vendorId && m.countryId === countryId && (!m.storeId || m.storeId === storeId));
    if (!member) throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'Store not found' });
  }
  private vendorWrite(ctx: AccessContext, vendorId: string, countryId: string, storeId: string) {
    const decision = authorize(ctx, 'vendor:catalog:write', { vendorId, countryId, storeId }, { allowVendor: true });
    if (!decision.allow) {
      if (decision.reason === 'GEOGRAPHIC_SCOPE_DENIED') throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'Store not found' });
      throw new ForbiddenException({ code: decision.reason ?? 'PERMISSION_DENIED', message: 'Vendor catalog permission denied' });
    }
  }
  private requireAdmin(ctx: AccessContext, permission: string, countryId: string) {
    if (!hasPermission(ctx, permission)) throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Serviceability review permission is required' });
    if (ctx.assurance !== 'STEP_UP') throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Recent step-up is required' });
    if (!inGeographicScope(ctx, { countryId })) throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'Store not found' });
  }
  private async lockStore(tx: any, storeId: string) {
    const rows = await tx.$queryRaw`SELECT s.*, v."ownerUserId" FROM "Store" s JOIN "Vendor" v ON v."id"=s."vendorId" WHERE s."id"=${storeId}::uuid FOR UPDATE OF s`;
    const store = (rows as any[])[0];
    if (!store) throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'Store not found' });
    return store;
  }

  async proposePickup(ctx: AccessContext, storeId: string, input: { latitude: number; longitude: number; expectedVersion?: number }) {
    try { assertLatitudeLongitude(input.latitude, input.longitude); } catch (e: any) { throw new BadRequestException({ code: e.message ?? 'COORDINATE_INVALID', message: 'Invalid coordinate' }); }
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const store = await this.lockStore(tx, storeId);
      this.assertStoreMembership(ctx, store.vendorId, store.countryId, store.id);
      this.vendorWrite(ctx, store.vendorId, store.countryId, store.id);
      const existing = await tx.storePickupPoint.findUnique({ where: { storeId } });
      if (existing && existing.status === 'APPROVED') throw new ConflictException({ code: 'PICKUP_ALREADY_APPROVED', message: 'Approved pickup geometry cannot be replaced here' });
      if (existing) {
        assertVersion(input.expectedVersion!);
        if (existing.version !== input.expectedVersion) throw new ConflictException({ code: 'PICKUP_VERSION_CONFLICT', message: 'Pickup version conflict' });
        await tx.$executeRaw`UPDATE "StorePickupPoint" SET "pickupPoint"=ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}),4326), "status"='DRAFT', "reviewedByUserId"=NULL, "reviewReason"=NULL, "reviewedAt"=NULL, "version"="version"+1, "updatedAt"=now() WHERE "id"=${existing.id}::uuid`;
        const updated = await tx.storePickupPoint.findUniqueOrThrow({ where: { id: existing.id } });
        await this.audit(tx, ctx, 'catalog.store.pickup.proposed', 'StorePickupPoint', updated.id, store.countryId);
        await this.outbox(tx, 'Store', storeId, 'catalog.store.pickup.proposed', `store-pickup-proposed-${storeId}-${updated.version}`, store.countryId, { version: updated.version });
        return { pickupId: updated.id, status: updated.status, version: updated.version };
      }
      const id = randomUUID();
      await tx.$executeRaw`INSERT INTO "StorePickupPoint"("id","storeId","pickupPoint","proposedByUserId","updatedAt") VALUES (${id}::uuid, ${storeId}::uuid, ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}),4326), ${ctx.userId}::uuid, now())`;
      await this.audit(tx, ctx, 'catalog.store.pickup.proposed', 'StorePickupPoint', id, store.countryId);
      await this.outbox(tx, 'Store', storeId, 'catalog.store.pickup.proposed', `store-pickup-proposed-${storeId}-1`, store.countryId, { version: 1 });
      return { pickupId: id, status: 'DRAFT', version: 1 };
    });
  }

  async reviewPickup(ctx: AccessContext, storeId: string, input: { version: number; decision: 'APPROVE' | 'REJECT'; reason: string }) {
    assertVersion(input.version); const reason = reasonText(input.reason);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const store = await this.lockStore(tx, storeId);
      this.requireAdmin(ctx, 'catalog:store:serviceability:review', store.countryId);
      const pickup = await tx.storePickupPoint.findUnique({ where: { storeId } });
      if (!pickup) throw new NotFoundException({ code: 'PICKUP_NOT_FOUND', message: 'Pickup point not found' });
      if (pickup.proposedByUserId === ctx.userId || store.ownerUserId === ctx.userId) throw new ForbiddenException({ code: 'SELF_REVIEW_DENIED', message: 'Proposer/owner cannot review their own pickup point' });
      if (pickup.version !== input.version) throw new ConflictException({ code: 'PICKUP_VERSION_CONFLICT', message: 'Pickup version conflict' });
      if (!isAllowedPickupReview(pickup.status, input.decision)) throw new ConflictException({ code: 'PICKUP_INVALID_TRANSITION', message: 'Pickup review is not allowed in its current state' });
      const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const updated = await tx.storePickupPoint.update({ where: { id: pickup.id }, data: { status, reviewedByUserId: ctx.userId, reviewReason: reason, reviewedAt: new Date(), version: { increment: 1 } } });
      await this.audit(tx, ctx, `catalog.store.pickup.${status.toLowerCase()}`, 'StorePickupPoint', pickup.id, store.countryId, reason);
      await this.outbox(tx, 'Store', storeId, `catalog.store.pickup.${status.toLowerCase()}`, `store-pickup-${status.toLowerCase()}-${storeId}-${updated.version}`, store.countryId, { version: updated.version });
      return { pickupId: pickup.id, status: updated.status, version: updated.version };
    });
  }

  async replaceOperatingHours(ctx: AccessContext, storeId: string, hours: OperatingHourInput[]) {
    try { assertOperatingHours(hours); } catch (error: unknown) {
      // Only known domain codes are client errors. Unexpected internal errors
      // must go through the generic exception filter, not into the response.
      if (!(error instanceof Error) || !OPERATING_HOURS_ERRORS.has(error.message)) throw error;
      throw new BadRequestException({ code: error.message, message: 'Invalid operating hours' });
    }
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const store = await this.lockStore(tx, storeId);
      this.assertStoreMembership(ctx, store.vendorId, store.countryId, store.id);
      this.vendorWrite(ctx, store.vendorId, store.countryId, store.id);
      await tx.storeOperatingHour.deleteMany({ where: { storeId } });
      await tx.storeOperatingHour.createMany({ data: hours.map(h => ({ storeId, dayOfWeek: h.dayOfWeek, openMinute: h.openMinute, closeMinute: h.closeMinute })) });
      await this.audit(tx, ctx, 'catalog.store.hours.replaced', 'Store', storeId, store.countryId);
      await this.outbox(tx, 'Store', storeId, 'catalog.store.hours.replaced', `store-hours-replaced-${storeId}-${randomUUID()}`, store.countryId, { count: hours.length });
      return { storeId, count: hours.length };
    });
  }

  async proposeServiceArea(ctx: AccessContext, storeId: string, serviceZoneId: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const store = await this.lockStore(tx, storeId);
      this.assertStoreMembership(ctx, store.vendorId, store.countryId, store.id);
      this.vendorWrite(ctx, store.vendorId, store.countryId, store.id);
      const zone = await tx.serviceZone.findUnique({ where: { id: serviceZoneId } });
      if (!zone || zone.status !== 'ACTIVE' || zone.cityId !== store.cityId) throw new BadRequestException({ code: 'SERVICE_ZONE_MISMATCH', message: 'Service zone must be active and in the store city' });
      const existing = await tx.storeServiceArea.findUnique({ where: { storeId_serviceZoneId: { storeId, serviceZoneId } } });
      if (existing) {
        if (existing.status === 'DRAFT') return { serviceAreaId: existing.id, status: existing.status, version: existing.version, duplicate: true };
        if (existing.status !== 'REJECTED') throw new ConflictException({ code: 'SERVICE_AREA_EXISTS', message: 'Service area already exists' });
        const updated = await tx.storeServiceArea.update({ where: { id: existing.id }, data: { status: 'DRAFT', reviewedByUserId: null, reviewReason: null, reviewedAt: null, version: { increment: 1 } } });
        return { serviceAreaId: updated.id, status: updated.status, version: updated.version, duplicate: false };
      }
      const area = await tx.storeServiceArea.create({ data: { storeId, serviceZoneId, proposedByUserId: ctx.userId } });
      await this.audit(tx, ctx, 'catalog.store.service_area.proposed', 'StoreServiceArea', area.id, store.countryId);
      await this.outbox(tx, 'Store', storeId, 'catalog.store.service_area.proposed', `store-service-area-proposed-${area.id}`, store.countryId, { serviceZoneId });
      return { serviceAreaId: area.id, status: area.status, version: area.version, duplicate: false };
    });
  }

  async reviewServiceArea(ctx: AccessContext, serviceAreaId: string, input: { version: number; decision: 'APPROVE' | 'REJECT' | 'SUSPEND'; reason: string }) {
    assertVersion(input.version); const reason = reasonText(input.reason);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      // Lock before reading the version and review metadata. Without this, two
      // reviewers can both accept the same version before either update commits.
      // The later update might otherwise apply a different decision or fail as
      // an opaque database error rather than a stable version conflict.
      const locked = await tx.$queryRaw`SELECT "id" FROM "StoreServiceArea" WHERE "id"=${serviceAreaId}::uuid FOR UPDATE`;
      if (!(locked as unknown[]).length) throw new NotFoundException({ code: 'SERVICE_AREA_NOT_FOUND', message: 'Service area not found' });
      const area = await tx.storeServiceArea.findUnique({ where: { id: serviceAreaId }, include: { store: { include: { vendor: true } } } });
      if (!area) throw new NotFoundException({ code: 'SERVICE_AREA_NOT_FOUND', message: 'Service area not found' });
      this.requireAdmin(ctx, 'catalog:store:serviceability:review', area.store.countryId);
      if (area.proposedByUserId === ctx.userId || area.store.vendor.ownerUserId === ctx.userId) throw new ForbiddenException({ code: 'SELF_REVIEW_DENIED', message: 'Proposer/owner cannot review their own service area' });
      if (area.version !== input.version) throw new ConflictException({ code: 'SERVICE_AREA_VERSION_CONFLICT', message: 'Service area version conflict' });
      if (!isAllowedServiceAreaReview(area.status, input.decision)) throw new ConflictException({ code: 'SERVICE_AREA_INVALID_TRANSITION', message: 'Service area review is not allowed in its current state' });
      const status = input.decision === 'APPROVE' ? 'APPROVED' : input.decision === 'REJECT' ? 'REJECTED' : 'SUSPENDED';
      const updated = await tx.storeServiceArea.update({ where: { id: serviceAreaId }, data: { status, reviewedByUserId: ctx.userId, reviewReason: reason, reviewedAt: new Date(), version: { increment: 1 } } });
      await this.audit(tx, ctx, `catalog.store.service_area.${status.toLowerCase()}`, 'StoreServiceArea', serviceAreaId, area.store.countryId, reason);
      await this.outbox(tx, 'Store', area.storeId, `catalog.store.service_area.${status.toLowerCase()}`, `store-service-area-${status.toLowerCase()}-${serviceAreaId}-${updated.version}`, area.store.countryId, { version: updated.version });
      return { serviceAreaId, status: updated.status, version: updated.version };
    });
  }

  async get(ctx: AccessContext, storeId: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const store = await this.lockStore(tx, storeId);
      this.assertStoreMembership(ctx, store.vendorId, store.countryId, store.id);
      this.vendorWrite(ctx, store.vendorId, store.countryId, store.id);
      const pickup = await tx.storePickupPoint.findUnique({ where: { storeId } });
      const hours = await tx.storeOperatingHour.findMany({ where: { storeId }, orderBy: [{ dayOfWeek: 'asc' }, { openMinute: 'asc' }] });
      const areas = await tx.storeServiceArea.findMany({ where: { storeId }, orderBy: { createdAt: 'asc' } });
      const rows = await tx.$queryRaw`SELECT gs_store_serviceable(${storeId}::uuid) AS serviceable, ST_X(p."pickupPoint") AS longitude, ST_Y(p."pickupPoint") AS latitude FROM "Store" s LEFT JOIN "StorePickupPoint" p ON p."storeId"=s."id" WHERE s."id"=${storeId}::uuid`;
      const projection = (rows as any[])[0];
      const vendorRows = await tx.$queryRaw`SELECT gs_inventory_vendor_eligible(${store.vendorId}::uuid) AS eligible`;
      const serviceable = isStoreDispatchServiceable({ storeStatus: store.status, vendorEligible: !!(vendorRows as any[])[0]?.eligible, pickupStatus: pickup?.status ?? null, serviceAreaStatuses: areas.map(a => a.status), operatingHourCount: hours.length }) && !!projection?.serviceable;
      return {
        storeId, serviceable,
        pickup: pickup ? { pickupId: pickup.id, status: pickup.status, version: pickup.version, latitude: projection?.latitude ?? null, longitude: projection?.longitude ?? null } : null,
        operatingHours: hours.map(h => ({ dayOfWeek: h.dayOfWeek, openMinute: h.openMinute, closeMinute: h.closeMinute })),
        serviceAreas: areas.map(a => ({ serviceAreaId: a.id, serviceZoneId: a.serviceZoneId, status: a.status, version: a.version }))
      };
    });
  }
}
