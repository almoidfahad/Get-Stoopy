import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { ENV } from '../common/env.js';
import type { ApiEnv } from '@getstoopy/config';
import { assertDispatchCommandKey, assertLatitudeLongitude, dispatchOfferToken, dispatchOfferTokenHash, hasPermission, inGeographicScope, rankDispatchCandidates, roadRouteEvidenceHash, verifyDispatchOfferToken, DISPATCH_MAX_CANDIDATES, type AccessContext, type DispatchCandidate, type RoadRoutePoint } from '@getstoopy/core';
import { DisabledRoadRouteMatrix, GoogleRoutesRoadRouteMatrix, type RoadRouteMatrixPort, type RoadTravelMode } from './road-route.adapter.js';
import { FinanceService } from '../finance/finance.service.js';
import { assertCodSuborderSafe } from '../finance/cod-collection-safety.js';

function hashPayload(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function assertVersion(version: number): void { if (!Number.isInteger(version) || version < 1) throw new BadRequestException({ code: 'VERSION_INVALID', message: 'Invalid version' }); }
function reasonText(reason: string): string { const t = reason?.trim(); if (!t || t.length < 8 || t.length > 512) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'A reason is required' }); return t; }
function travelMode(vehicle: string): RoadTravelMode { return vehicle === 'BICYCLE' ? 'BICYCLE' : vehicle === 'MOTORBIKE' ? 'TWO_WHEELER' : 'DRIVE'; }

@Injectable()
export class DispatchService {
  private readonly roadMatrix: RoadRouteMatrixPort;
  constructor(@Inject(PrivilegedPrismaService) private readonly privileged: PrivilegedPrismaService, @Inject(ENV) private readonly env: ApiEnv, @Inject(FinanceService) private readonly finance: FinanceService) {
    this.roadMatrix = env.ROAD_ROUTING_ENABLED && env.ROAD_ROUTING_PROVIDER === 'google_routes' && env.GOOGLE_ROUTES_API_KEY
      ? new GoogleRoutesRoadRouteMatrix({ apiKey: env.GOOGLE_ROUTES_API_KEY, baseUrl: env.GOOGLE_ROUTES_BASE_URL, testMode: env.NODE_ENV === 'test' })
      : new DisabledRoadRouteMatrix();
  }

  private async audit(tx: any, ctx: AccessContext | null, action: string, resourceId: string, countryId: string, reason?: string) {
    if (ctx) await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType","sessionId",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES (gen_random_uuid(), ${ctx.userId}::uuid, 'USER'::"ActorType", ${ctx.sessionId}::uuid, ${action}, 'DispatchRun', ${resourceId}::uuid, ${JSON.stringify({ countryId })}::jsonb, ${reason ?? null}, ${randomUUID()}::uuid)`;
    else await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorType",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES (gen_random_uuid(), 'SYSTEM'::"ActorType", ${action}, 'DispatchRun', ${resourceId}::uuid, ${JSON.stringify({ countryId })}::jsonb, ${reason ?? null}, ${randomUUID()}::uuid)`;
  }
  private async outbox(tx: any, runId: string, eventType: string, eventKey: string, countryId: string, data: Record<string, unknown>) {
    const occurredAt = new Date();
    await tx.outboxEvent.create({ data: { aggregateType: 'DispatchRun', aggregateId: runId, eventKey, eventType, occurredAt, payload: { schemaVersion: 1, eventKey, eventType, occurredAt: occurredAt.toISOString(), aggregateType: 'DispatchRun', aggregateId: runId, countryId, data } } });
  }
  private async event(tx: any, runId: string, eventType: string, commandKey: string, payload: unknown, opts: { actorUserId?: string; offerId?: string; assignmentId?: string; reason?: string } = {}) {
    await tx.dispatchEvent.create({ data: { runId, eventType, commandKey, payloadHash: hashPayload(payload), ...(opts.actorUserId ? { actorUserId: opts.actorUserId } : {}), ...(opts.offerId ? { offerId: opts.offerId } : {}), ...(opts.assignmentId ? { assignmentId: opts.assignmentId } : {}), ...(opts.reason ? { reason: opts.reason } : {}) } });
  }
  private requireAdmin(ctx: AccessContext, countryId: string) {
    if (!hasPermission(ctx, 'dispatch:run:manage')) throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Dispatch management permission is required' });
    if (ctx.assurance !== 'STEP_UP') throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Recent step-up is required' });
    if (!inGeographicScope(ctx, { countryId })) throw new NotFoundException({ code: 'DISPATCH_NOT_FOUND', message: 'Dispatch resource not found' });
  }
  private async zonePath(tx: any, zoneId: string) {
    const rows = await tx.$queryRaw`SELECT r."countryId", r."id" AS "regionId", d."id" AS "districtId", c."id" AS "cityId", z."id" AS "zoneId" FROM "ServiceZone" z JOIN "City" c ON c."id"=z."cityId" JOIN "District" d ON d."id"=c."districtId" JOIN "Region" r ON r."id"=d."regionId" WHERE z."id"=${zoneId}::uuid`;
    const path = (rows as any[])[0];
    if (!path) throw new NotFoundException({ code: 'DISPATCH_NOT_FOUND', message: 'Dispatch resource not found' });
    return path as { countryId: string; regionId: string; districtId: string; cityId: string; zoneId: string };
  }
  private async requireRunAdmin(ctx: AccessContext, tx: any, run: { countryId: string; pickupZoneId: string; destinationZoneId: string }) {
    this.requireAdmin(ctx, run.countryId);
    const pickup = await this.zonePath(tx, run.pickupZoneId);
    const destination = await this.zonePath(tx, run.destinationZoneId);
    if (!inGeographicScope(ctx, pickup) || !inGeographicScope(ctx, destination)) throw new NotFoundException({ code: 'DISPATCH_NOT_FOUND', message: 'Dispatch resource not found' });
  }
  private requireRider(ctx: AccessContext) { if (!ctx.riderId) throw new ForbiddenException({ code: 'RIDER_KYC_REQUIRED', message: 'Active KYC-eligible rider profile is required' }); }
  private commandKey(key: string) { try { assertDispatchCommandKey(key); } catch (e: any) { throw new BadRequestException({ code: e.message ?? 'DISPATCH_COMMAND_KEY_INVALID', message: 'Invalid dispatch command key' }); } }
  private async lockRun(tx: any, runId: string) {
    const rows = await tx.$queryRaw`SELECT "id","suborderId","countryId","storeId","destinationId","pickupZoneId","destinationZoneId","status","version","attemptCount","maxAttempts","commandKey","payloadHash","createdByUserId","createdAt","updatedAt" FROM "DispatchRun" WHERE "id"=${runId}::uuid FOR UPDATE`;
    const run = (rows as any[])[0];
    if (!run) throw new NotFoundException({ code: 'DISPATCH_NOT_FOUND', message: 'Dispatch resource not found' });
    return run;
  }
  private runJson(r: any, duplicate = false) { return { runId: r.id, suborderId: r.suborderId, storeId: r.storeId, countryId: r.countryId, pickupZoneId: r.pickupZoneId, destinationZoneId: r.destinationZoneId, status: r.status, version: r.version, attemptCount: r.attemptCount, maxAttempts: r.maxAttempts, createdAt: r.createdAt, updatedAt: r.updatedAt, duplicate }; }

  async setDestination(ctx: AccessContext, orderId: string, input: { serviceZoneId: string; boundaryVersionId: string; latitude: number; longitude: number; addressLine: string; commandKey: string }) {
    this.commandKey(input.commandKey);
    try { assertLatitudeLongitude(input.latitude, input.longitude); } catch (e: any) { throw new BadRequestException({ code: e.message ?? 'COORDINATE_INVALID', message: 'Invalid coordinate' }); }
    const addressLine = input.addressLine?.trim();
    if (!addressLine || addressLine.length < 5 || addressLine.length > 500) throw new BadRequestException({ code: 'ADDRESS_INVALID', message: 'Invalid address line' });
    const payloadHash = hashPayload({ serviceZoneId: input.serviceZoneId, boundaryVersionId: input.boundaryVersionId, latitude: input.latitude, longitude: input.longitude, addressLine });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      // The order row coordinates one-time destination creation with both
      // duplicate requests and cancellation. Retain buyer-scoped lookup.
      const rows = await tx.$queryRaw`SELECT * FROM "Order" WHERE "id"=${orderId}::uuid AND "buyerId"=${ctx.userId}::uuid FOR UPDATE`;
      const order = (rows as any[])[0];
      if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
      const existing = await tx.orderDeliveryDestination.findUnique({ where: { orderId } });
      if (existing) {
        if (existing.commandKey !== input.commandKey || existing.payloadHash !== payloadHash) throw new ConflictException({ code: 'DESTINATION_ALREADY_SET', message: 'Delivery destination is immutable once set' });
        return { destinationId: existing.id, orderId, duplicate: true };
      }
      if (order.lifecycleStatus !== 'ACTIVE') throw new ConflictException({ code: 'ORDER_NOT_ACTIVE', message: 'Destination cannot be added to a cancelled order' });
      const id = randomUUID();
      try {
        await tx.$executeRaw`INSERT INTO "OrderDeliveryDestination"("id","orderId","countryId","cityId","serviceZoneId","boundaryVersionId","destinationPoint","addressLine","commandKey","payloadHash","setByUserId") VALUES (${id}::uuid, ${orderId}::uuid, ${order.countryId}::uuid, ${order.destinationCityId}::uuid, ${input.serviceZoneId}::uuid, ${input.boundaryVersionId}::uuid, ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}),4326), ${addressLine}, ${input.commandKey}, ${payloadHash}, ${ctx.userId}::uuid)`;
      } catch (e: any) {
        const msg = String(e?.meta?.message ?? e?.message ?? '');
        if (msg.includes('delivery_destination_boundary_not_approved')) throw new ConflictException({ code: 'BOUNDARY_NOT_APPROVED', message: 'Approved effective zone boundary is required' });
        if (msg.includes('delivery_destination_outside_zone')) throw new ConflictException({ code: 'DESTINATION_OUTSIDE_ZONE', message: 'Destination point is outside the approved zone boundary' });
        if (msg.includes('delivery_destination_zone_mismatch')) throw new BadRequestException({ code: 'DESTINATION_ZONE_MISMATCH', message: 'Destination zone must be active and in the order city' });
        throw e;
      }
      await this.audit(tx, ctx, 'commerce.order.destination_set', orderId, order.countryId);
      await this.outbox(tx, orderId, 'commerce.order.destination_set', `order-destination-${orderId}`, order.countryId, { destinationId: id, serviceZoneId: input.serviceZoneId });
      return { destinationId: id, orderId, duplicate: false };
    });
  }

  async createRun(ctx: AccessContext, suborderId: string, input: { commandKey: string }) {
    this.commandKey(input.commandKey);
    const payloadHash = hashPayload({ suborderId });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rows = await tx.$queryRaw`SELECT s.*, o."countryId", o."paymentStatus" FROM "VendorSuborder" s JOIN "Order" o ON o."id"=s."orderId" WHERE s."id"=${suborderId}::uuid FOR UPDATE OF s`;
      const sub = (rows as any[])[0];
      if (!sub) throw new NotFoundException({ code: 'SUBORDER_NOT_FOUND', message: 'Suborder not found' });
      this.requireAdmin(ctx, sub.countryId);
      const existing = await tx.dispatchRun.findUnique({ where: { suborderId } });
      if (existing) {
        if (existing.commandKey !== input.commandKey || existing.payloadHash !== payloadHash) throw new ConflictException({ code: 'DISPATCH_RUN_EXISTS', message: 'Dispatch run already exists for suborder' });
        return this.runJson(existing, true);
      }
      // Do not dispatch a COD order whose custody allocation cannot be posted
      // safely by the legacy completion flow. Existing runs need separate review.
      await assertCodSuborderSafe(tx, suborderId);
      if (sub.status !== 'READY_FOR_PICKUP') throw new ConflictException({ code: 'SUBORDER_NOT_READY', message: 'Suborder must be manually ready for pickup' });
      if (!['PAYMENT_VERIFIED', 'AWAITING_COD'].includes(sub.paymentStatus)) throw new ConflictException({ code: 'PAYMENT_NOT_READY', message: 'Order payment is not verified or COD' });
      const destination = await tx.orderDeliveryDestination.findUnique({ where: { orderId: sub.orderId } });
      if (!destination) throw new ConflictException({ code: 'DESTINATION_REQUIRED', message: 'Buyer must set a delivery destination first' });
      const destinationPath = await this.zonePath(tx, destination.serviceZoneId);
      if (!inGeographicScope(ctx, destinationPath)) throw new NotFoundException({ code: 'DISPATCH_NOT_FOUND', message: 'Dispatch resource not found' });
      const pickupRows = await tx.$queryRaw`SELECT ST_X("pickupPoint") AS longitude, ST_Y("pickupPoint") AS latitude FROM "StorePickupPoint" WHERE "storeId"=${sub.storeId}::uuid AND "status"='APPROVED'`;
      const pickup = (pickupRows as any[])[0];
      if (!pickup) throw new ConflictException({ code: 'PICKUP_NOT_APPROVED', message: 'Approved store pickup point is required' });
      const pickupZones = await tx.$queryRaw`SELECT z."id" FROM "ServiceZone" z JOIN "BoundaryVersion" b ON b."ownerType"='ZONE' AND b."ownerId"=z."id" WHERE z."status"='ACTIVE' AND z."cityId"=(SELECT "cityId" FROM "Store" WHERE "id"=${sub.storeId}::uuid) AND b."approvedBy" IS NOT NULL AND b."validFrom"<=gs_dispatch_now() AND ST_Covers(b."boundary", ST_SetSRID(ST_MakePoint(${pickup.longitude}, ${pickup.latitude}),4326)) GROUP BY z."id" ORDER BY z."id"`;
      if ((pickupZones as any[]).length !== 1) throw new ConflictException({ code: 'PICKUP_ZONE_AMBIGUOUS', message: 'Exactly one approved active pickup zone must cover the store point' });
      const pickupZoneId = (pickupZones as any[])[0].id as string;
      const pickupPath = await this.zonePath(tx, pickupZoneId);
      if (!inGeographicScope(ctx, pickupPath)) throw new NotFoundException({ code: 'DISPATCH_NOT_FOUND', message: 'Dispatch resource not found' });
      const id = randomUUID();
      try {
        await tx.$executeRaw`INSERT INTO "DispatchRun"("id","suborderId","countryId","storeId","destinationId","pickupZoneId","destinationZoneId","pickupPoint","destinationPoint","commandKey","payloadHash","createdByUserId","updatedAt") VALUES (${id}::uuid, ${suborderId}::uuid, ${sub.countryId}::uuid, ${sub.storeId}::uuid, ${destination.id}::uuid, ${pickupZoneId}::uuid, ${destination.serviceZoneId}::uuid, ST_SetSRID(ST_MakePoint(${pickup.longitude}, ${pickup.latitude}),4326), (SELECT "destinationPoint" FROM "OrderDeliveryDestination" WHERE "id"=${destination.id}::uuid), ${input.commandKey}, ${payloadHash}, ${ctx.userId}::uuid, now())`;
      } catch (e: any) {
        const msg = String(e?.meta?.message ?? e?.message ?? '');
        if (msg.includes('dispatch_store_area_not_approved')) throw new ConflictException({ code: 'STORE_SERVICE_AREA_NOT_APPROVED', message: 'Store must have an approved service area for the destination zone' });
        if (msg.includes('dispatch_store_not_serviceable')) throw new ConflictException({ code: 'STORE_NOT_SERVICEABLE', message: 'Store is not dispatch-serviceable' });
        throw e;
      }
      const run = await tx.dispatchRun.findUniqueOrThrow({ where: { id } });
      await this.event(tx, id, 'dispatch.run.created', input.commandKey, { suborderId }, { actorUserId: ctx.userId });
      await this.audit(tx, ctx, 'dispatch.run.created', id, sub.countryId);
      await this.outbox(tx, id, 'dispatch.run.created', `dispatch-run-created-${id}`, sub.countryId, { suborderId, pickupZoneId, destinationZoneId: destination.serviceZoneId });
      return this.runJson(run);
    });
  }

  async nextOffer(ctx: AccessContext, runId: string, input: { expectedVersion: number; commandKey: string }) {
    assertVersion(input.expectedVersion); this.commandKey(input.commandKey);
    if (!this.env.DISPATCH_OFFER_TOKEN_SECRET) throw new ServiceUnavailableException({ code: 'DISPATCH_OFFER_TOKEN_SECRET_REQUIRED', message: 'Dispatch offer token secret is not configured' });
    const offerSecret = this.env.DISPATCH_OFFER_TOKEN_SECRET;
    const payloadHash = hashPayload({ expectedVersion: input.expectedVersion });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const run = await this.lockRun(tx, runId);
      await this.requireRunAdmin(ctx, tx, run);
      const existingCommand = await tx.dispatchOffer.findUnique({ where: { runId_commandKey: { runId, commandKey: input.commandKey } } });
      if (existingCommand) {
        if (existingCommand.payloadHash !== payloadHash) throw new ConflictException({ code: 'DISPATCH_IDEMPOTENCY_CONFLICT', message: 'Command key already used with different payload' });
        return { runId, offerId: existingCommand.id, riderId: existingCommand.riderId, status: existingCommand.status, expiresAt: existingCommand.expiresAt, duplicate: true };
      }
      if (run.version !== input.expectedVersion) throw new ConflictException({ code: 'DISPATCH_VERSION_CONFLICT', message: 'Dispatch run version conflict' });
      if (run.status !== 'SEARCHING') throw new ConflictException({ code: 'DISPATCH_INVALID_STATE', message: 'Dispatch run is not searching' });
      // A run may predate the COD allocation guard. Do not issue another offer.
      await assertCodSuborderSafe(tx, run.suborderId);
      if (run.attemptCount >= run.maxAttempts) {
        await tx.dispatchRun.update({ where: { id: runId }, data: { status: 'MANUAL_REVIEW', version: { increment: 1 } } });
        await this.event(tx, runId, 'dispatch.run.manual_review', input.commandKey, { reason: 'MAX_ATTEMPTS' }, { actorUserId: ctx.userId, reason: 'Maximum dispatch attempts reached' });
        return { runId, status: 'MANUAL_REVIEW', offerId: null };
      }
      const candidateRows = await tx.$queryRaw`SELECT * FROM gs_dispatch_candidate_rows(${runId}::uuid) LIMIT ${DISPATCH_MAX_CANDIDATES}`;
      const candidates = (candidateRows as any[]).map(c => ({ riderId: c.riderId, shiftId: c.shiftId, locationSampleId: c.locationSampleId, pickupZoneGrantId: c.pickupZoneGrantId, destinationZoneGrantId: c.destinationZoneGrantId, latitude: Number(c.latitude), longitude: Number(c.longitude), priority: c.priority, lastOfferAt: c.lastOfferAt ? new Date(c.lastOfferAt).toISOString() : null, vehicleType: c.vehicleType, pickupDistanceMeters: 0 } as DispatchCandidate));
      if (!candidates.length) {
        await tx.dispatchRun.update({ where: { id: runId }, data: { status: 'MANUAL_REVIEW', version: { increment: 1 } } });
        await this.event(tx, runId, 'dispatch.run.manual_review', input.commandKey, { reason: 'NO_ELIGIBLE_RIDER' }, { actorUserId: ctx.userId, reason: 'No eligible rider available' });
        await this.audit(tx, ctx, 'dispatch.run.manual_review', runId, run.countryId, 'No eligible rider available');
        await this.outbox(tx, runId, 'dispatch.run.manual_review', `dispatch-manual-review-${runId}-${run.version + 1}`, run.countryId, { reason: 'NO_ELIGIBLE_RIDER' });
        return { runId, status: 'MANUAL_REVIEW', offerId: null };
      }
      const pickupRows = await tx.$queryRaw`SELECT ST_X("pickupPoint") AS longitude, ST_Y("pickupPoint") AS latitude, ST_X("destinationPoint") AS dlongitude, ST_Y("destinationPoint") AS dlatitude FROM "DispatchRun" WHERE "id"=${runId}::uuid`;
      const points = (pickupRows as any[])[0];
      const pickupPoint: RoadRoutePoint = { latitude: Number(points.latitude), longitude: Number(points.longitude) };
      const destinationPoint: RoadRoutePoint = { latitude: Number(points.dlatitude), longitude: Number(points.dlongitude) };
      const byMode = new Map<RoadTravelMode, DispatchCandidate[]>();
      for (const c of candidates) { const mode = travelMode(c.vehicleType); byMode.set(mode, [...(byMode.get(mode) ?? []), c]); }
      const routed: DispatchCandidate[] = [];
      const routeEvidence: Record<string, unknown> = { runId, pickupPoint, destinationPoint, modes: {} as Record<string, unknown> };
      for (const [mode, group] of byMode) {
        let result;
        try { result = await this.roadMatrix.computeMatrix({ origins: [...group.map(c => ({ latitude: c.latitude, longitude: c.longitude })), pickupPoint], destinations: [pickupPoint, destinationPoint], travelMode: mode }); }
        catch (e: any) { throw new ServiceUnavailableException({ code: e?.message === 'ROAD_ROUTING_DISABLED' ? 'ROAD_ROUTING_DISABLED' : 'ROAD_ROUTE_UNAVAILABLE', message: 'Road-route matrix evidence is required; no straight-line fallback is allowed' }); }
        (routeEvidence.modes as any)[mode] = { provider: result.provider, mode: result.mode, elements: result.elements };
        const storeToDest = result.elements.find(e => e.originIndex === group.length && e.destinationIndex === 1)!;
        for (let i = 0; i < group.length; i++) {
          const pickupElement = result.elements.find(e => e.originIndex === i && e.destinationIndex === 0)!;
          routed.push({ ...group[i]!, pickupDistanceMeters: pickupElement.distanceMeters });
        }
        (routeEvidence as any).storeToDestination = { distanceMeters: storeToDest.distanceMeters, durationSeconds: storeToDest.durationSeconds };
      }
      const selected = rankDispatchCandidates(routed)[0]!;
      const mode = travelMode(selected.vehicleType);
      const modeEvidence = (routeEvidence.modes as any)[mode] as { provider: string; mode: string; elements: any[] };
      const group = byMode.get(mode)!;
      const storeToDest = modeEvidence.elements.find((e: any) => e.originIndex === group.length && e.destinationIndex === 1)!;
      const offerId = randomUUID();
      const offerToken = dispatchOfferToken(offerSecret, offerId);
      const evidenceHash = roadRouteEvidenceHash(routeEvidence);
      await tx.dispatchRun.update({ where: { id: runId }, data: { status: 'OFFERING', attemptCount: { increment: 1 }, version: { increment: 1 } } });
      // One millisecond-precision DB instant supplies both TTL endpoints; never use the API process clock.
      await tx.$executeRaw`INSERT INTO "DispatchOffer"("id","runId","riderId","sequence","offerTokenHash","shiftId","locationSampleId","pickupZoneGrantId","destinationZoneGrantId","pickupDistanceMeters","roadDistanceMeters","durationSeconds","routingProvider","routingMode","routeEvidenceHash","commandKey","payloadHash","offeredAt","expiresAt") SELECT ${offerId}::uuid, ${runId}::uuid, ${selected.riderId}::uuid, ${run.attemptCount + 1}, ${dispatchOfferTokenHash(offerToken)}, ${selected.shiftId}::uuid, ${selected.locationSampleId}::uuid, ${selected.pickupZoneGrantId}::uuid, ${selected.destinationZoneGrantId}::uuid, ${selected.pickupDistanceMeters}, ${storeToDest.distanceMeters}, ${storeToDest.durationSeconds}, ${modeEvidence.provider}, ${modeEvidence.mode}::"RoadRoutingMode", ${evidenceHash}, ${input.commandKey}, ${payloadHash}, t.now, t.now + interval '30 seconds' FROM LATERAL (SELECT gs_dispatch_now() AS now) t`;
      const offer = await tx.dispatchOffer.findUniqueOrThrow({ where: { id: offerId } });
      await this.event(tx, runId, 'dispatch.offer.created', input.commandKey, { offerId, riderId: selected.riderId, sequence: offer.sequence }, { actorUserId: ctx.userId, offerId });
      await this.audit(tx, ctx, 'dispatch.offer.created', runId, run.countryId);
      await this.outbox(tx, runId, 'dispatch.offer.created', `dispatch-offer-created-${offerId}`, run.countryId, { offerId, riderId: selected.riderId, sequence: offer.sequence, expiresAt: offer.expiresAt.toISOString() });
      return { runId, offerId, riderId: selected.riderId, status: offer.status, sequence: offer.sequence, expiresAt: offer.expiresAt, roadDistanceMeters: offer.roadDistanceMeters, pickupDistanceMeters: offer.pickupDistanceMeters, duplicate: false };
    }, { timeout: 30000 });
  }

  private async respond(ctx: AccessContext, offerId: string, action: 'accept' | 'reject', input: { offerToken: string; commandKey: string; reason?: string }) {
    this.requireRider(ctx); this.commandKey(input.commandKey);
    const reason = action === 'reject' ? reasonText(input.reason!) : undefined;
    const payloadHash = hashPayload({ action, offerTokenHash: dispatchOfferTokenHash(input.offerToken), reason: reason ?? null });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const offerLookup = await tx.dispatchOffer.findUnique({ where: { id: offerId } });
      if (!offerLookup || offerLookup.riderId !== ctx.riderId) throw new NotFoundException({ code: 'OFFER_NOT_FOUND', message: 'Dispatch offer not found' });
      const run = await this.lockRun(tx, offerLookup.runId);
      const offerRows = await tx.$queryRaw`SELECT * FROM "DispatchOffer" WHERE "id"=${offerId}::uuid FOR UPDATE`;
      const offer = (offerRows as any[])[0];
      await tx.$queryRaw`SELECT "id" FROM "RiderProfile" WHERE "id"=${ctx.riderId}::uuid FOR UPDATE`;
      if (!this.env.DISPATCH_OFFER_TOKEN_SECRET || !verifyDispatchOfferToken(this.env.DISPATCH_OFFER_TOKEN_SECRET, offerId, input.offerToken, offer.offerTokenHash)) throw new ForbiddenException({ code: 'OFFER_TOKEN_INVALID', message: 'Invalid offer token' });
      if (offer.responseCommandKey === input.commandKey) {
        if (offer.responsePayloadHash !== payloadHash) throw new ConflictException({ code: 'DISPATCH_IDEMPOTENCY_CONFLICT', message: 'Command key already used with different payload' });
        return { offerId, status: offer.status, runId: run.id, duplicate: true };
      }
      if (offer.status !== 'OFFERED') throw new ConflictException({ code: 'OFFER_NOT_OPEN', message: 'Dispatch offer is not open' });
      const nowRows = await tx.$queryRaw`SELECT gs_dispatch_now() AS now`;
      if (new Date((nowRows as any[])[0].now) >= offer.expiresAt) throw new ConflictException({ code: 'OFFER_EXPIRED', message: 'Dispatch offer has expired' });
      if (action === 'accept') {
        if (run.status !== 'OFFERING') throw new ConflictException({ code: 'DISPATCH_INVALID_STATE', message: 'Dispatch run is not offering' });
        // Old offers may still exist; reject remains available for recovery.
        await assertCodSuborderSafe(tx, run.suborderId);
        const eligible = await tx.$queryRaw`SELECT gs_rider_dispatch_eligible(${ctx.riderId}::uuid, ${run.countryId}::uuid, ${run.pickupZoneId}::uuid, ${run.destinationZoneId}::uuid, ${offer.shiftId}::uuid, ${offer.locationSampleId}::uuid, ${offer.pickupZoneGrantId}::uuid, ${offer.destinationZoneGrantId}::uuid) AS eligible`;
        if (!(eligible as any[])[0]?.eligible) throw new ConflictException({ code: 'RIDER_NOT_ELIGIBLE', message: 'Rider is no longer eligible for this offer' });
        await tx.dispatchRun.update({ where: { id: run.id }, data: { status: 'ASSIGNED', version: { increment: 1 } } });
        await tx.$executeRaw`UPDATE "DispatchOffer" SET "status"='ACCEPTED', "respondedAt"=gs_dispatch_now(), "responseCommandKey"=${input.commandKey}, "responsePayloadHash"=${payloadHash} WHERE "id"=${offerId}::uuid`;
        const assignmentId = randomUUID();
        await tx.$executeRaw`INSERT INTO "RiderAssignment"("id","runId","offerId","riderId","suborderId","countryId","shiftId","locationSampleId","pickupDistanceMeters","roadDistanceMeters","durationSeconds","routingProvider","routingMode","routeEvidenceHash") VALUES (${assignmentId}::uuid, ${run.id}::uuid, ${offerId}::uuid, ${ctx.riderId}::uuid, ${run.suborderId}::uuid, ${run.countryId}::uuid, ${offer.shiftId}::uuid, ${offer.locationSampleId}::uuid, ${offer.pickupDistanceMeters}, ${offer.roadDistanceMeters}, ${offer.durationSeconds}, ${offer.routingProvider}, ${offer.routingMode}::"RoadRoutingMode", ${offer.routeEvidenceHash})`;
        const suborder = await tx.vendorSuborder.findUniqueOrThrow({ where: { id: run.suborderId } });
        await this.finance.snapshotRateTx(tx, { id: assignmentId, riderId: ctx.riderId!, countryId: run.countryId, roadDistanceMeters: offer.roadDistanceMeters, routeEvidenceHash: offer.routeEvidenceHash }, suborder.currency);
        await this.event(tx, run.id, 'dispatch.offer.accepted', input.commandKey, { offerId, assignmentId }, { actorUserId: ctx.userId, offerId, assignmentId });
        await this.audit(tx, ctx, 'dispatch.offer.accepted', run.id, run.countryId);
        await this.outbox(tx, run.id, 'dispatch.offer.accepted', `dispatch-offer-accepted-${offerId}`, run.countryId, { offerId, assignmentId, riderId: ctx.riderId, suborderId: run.suborderId });
        return { offerId, assignmentId, runId: run.id, status: 'ACCEPTED', duplicate: false };
      }
      const nextStatus = run.attemptCount >= run.maxAttempts ? 'MANUAL_REVIEW' : 'SEARCHING';
      await tx.$executeRaw`UPDATE "DispatchOffer" SET "status"='REJECTED', "respondedAt"=gs_dispatch_now(), "responseCommandKey"=${input.commandKey}, "responsePayloadHash"=${payloadHash}, "responseReason"=${reason} WHERE "id"=${offerId}::uuid`;
      await tx.dispatchRun.update({ where: { id: run.id }, data: { status: nextStatus, version: { increment: 1 } } });
      await this.event(tx, run.id, 'dispatch.offer.rejected', input.commandKey, { offerId, nextStatus }, { actorUserId: ctx.userId, offerId, ...(reason ? { reason } : {}) });
      await this.audit(tx, ctx, 'dispatch.offer.rejected', run.id, run.countryId, reason);
      await this.outbox(tx, run.id, 'dispatch.offer.rejected', `dispatch-offer-rejected-${offerId}`, run.countryId, { offerId, riderId: ctx.riderId, nextStatus });
      return { offerId, runId: run.id, status: 'REJECTED', nextStatus, duplicate: false };
    }, { timeout: 30000 });
  }
  async acceptOffer(ctx: AccessContext, offerId: string, input: { offerToken: string; commandKey: string }) { return this.respond(ctx, offerId, 'accept', input); }
  async rejectOffer(ctx: AccessContext, offerId: string, input: { offerToken: string; commandKey: string; reason: string }) { return this.respond(ctx, offerId, 'reject', input); }

  async listMyOffers(ctx: AccessContext) {
    this.requireRider(ctx);
    if (!this.env.DISPATCH_OFFER_TOKEN_SECRET) throw new ServiceUnavailableException({ code: 'DISPATCH_OFFER_TOKEN_SECRET_REQUIRED', message: 'Dispatch offer token secret is not configured' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const offers = await tx.$queryRaw`SELECT o.* FROM "DispatchOffer" o WHERE o."riderId"=${ctx.riderId}::uuid AND o."status"='OFFERED' AND o."expiresAt">gs_dispatch_now() ORDER BY o."offeredAt" DESC`;
      return { items: (offers as any[]).map(o => ({ offerId: o.id, runId: o.runId, sequence: o.sequence, expiresAt: o.expiresAt, roadDistanceMeters: o.roadDistanceMeters, pickupDistanceMeters: o.pickupDistanceMeters, offerToken: dispatchOfferToken(this.env.DISPATCH_OFFER_TOKEN_SECRET!, o.id) })) };
    });
  }
  async myAssignment(ctx: AccessContext) {
    this.requireRider(ctx);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const assignment = await tx.riderAssignment.findFirst({ where: { riderId: ctx.riderId!, status: 'ACTIVE' } });
      if (!assignment) return { assignment: null };
      return { assignment: { assignmentId: assignment.id, runId: assignment.runId, offerId: assignment.offerId, suborderId: assignment.suborderId, status: assignment.status, roadDistanceMeters: assignment.roadDistanceMeters, pickupDistanceMeters: assignment.pickupDistanceMeters, routingProvider: assignment.routingProvider, routingMode: assignment.routingMode, assignedAt: assignment.assignedAt } };
    });
  }
  async getRun(ctx: AccessContext, runId: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const run = await tx.dispatchRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException({ code: 'DISPATCH_NOT_FOUND', message: 'Dispatch resource not found' });
      await this.requireRunAdmin(ctx, tx, run);
      const offers = await tx.dispatchOffer.findMany({ where: { runId }, orderBy: { sequence: 'asc' } });
      const assignment = await tx.riderAssignment.findUnique({ where: { runId } });
      return { ...this.runJson(run), offers: offers.map(o => ({ offerId: o.id, riderId: o.riderId, sequence: o.sequence, status: o.status, expiresAt: o.expiresAt, respondedAt: o.respondedAt, roadDistanceMeters: o.roadDistanceMeters, pickupDistanceMeters: o.pickupDistanceMeters })), assignment: assignment ? { assignmentId: assignment.id, riderId: assignment.riderId, status: assignment.status, assignedAt: assignment.assignedAt } : null };
    });
  }
  async history(ctx: AccessContext, runId: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const run = await tx.dispatchRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException({ code: 'DISPATCH_NOT_FOUND', message: 'Dispatch resource not found' });
      await this.requireRunAdmin(ctx, tx, run);
      const events = await tx.dispatchEvent.findMany({ where: { runId }, orderBy: { occurredAt: 'asc' } });
      return { items: events.map(e => ({ id: e.id, eventType: e.eventType, offerId: e.offerId, assignmentId: e.assignmentId, reason: e.reason, occurredAt: e.occurredAt })) };
    });
  }
  async manualQueue(ctx: AccessContext, countryId: string) {
    this.requireAdmin(ctx, countryId);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const runs = await tx.dispatchRun.findMany({ where: { countryId, status: 'MANUAL_REVIEW' }, orderBy: { updatedAt: 'asc' }, take: 100 });
      return { items: runs.map(r => this.runJson(r)) };
    });
  }
}
