-- Atomic dispatch foundation: destination snapshot, dispatch runs, 30-second offers,
-- single active rider assignment, append-only dispatch events and DB-time expiry.
-- Additive only. OTP proof, delivery completion, earnings/COD/settlement and live
-- paid routing remain disabled/pending. Road routing evidence is required; there is
-- no straight-line fallback.

CREATE TYPE "DispatchRunStatus" AS ENUM ('SEARCHING','OFFERING','ASSIGNED','MANUAL_REVIEW');
CREATE TYPE "DispatchOfferStatus" AS ENUM ('OFFERED','ACCEPTED','REJECTED','EXPIRED','CANCELLED');
CREATE TYPE "RiderAssignmentStatus" AS ENUM ('ACTIVE','RELEASED','COMPLETED');
CREATE TYPE "RoadRoutingMode" AS ENUM ('DISABLED','TEST_ONLY','GOOGLE_ROUTES');

ALTER TABLE "RiderProfile" ADD COLUMN "dispatchPriority" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RiderProfile" ADD CONSTRAINT "RiderProfile_dispatchPriority_bounds" CHECK ("dispatchPriority" BETWEEN 0 AND 1000);

CREATE TABLE "OrderDeliveryDestination" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orderId" UUID NOT NULL,
  "countryId" UUID NOT NULL,
  "cityId" UUID NOT NULL,
  "serviceZoneId" UUID NOT NULL,
  "boundaryVersionId" UUID NOT NULL,
  "destinationPoint" geometry(Point,4326) NOT NULL,
  "addressLine" VARCHAR(500) NOT NULL,
  "commandKey" VARCHAR(128) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "setByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderDeliveryDestination_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderDeliveryDestination_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderDeliveryDestination_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderDeliveryDestination_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderDeliveryDestination_serviceZoneId_fkey" FOREIGN KEY ("serviceZoneId") REFERENCES "ServiceZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderDeliveryDestination_boundaryVersionId_fkey" FOREIGN KEY ("boundaryVersionId") REFERENCES "BoundaryVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderDeliveryDestination_setByUserId_fkey" FOREIGN KEY ("setByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderDeliveryDestination_point_valid" CHECK (ST_SRID("destinationPoint")=4326 AND ST_IsValid("destinationPoint") AND ST_X("destinationPoint") BETWEEN -180 AND 180 AND ST_Y("destinationPoint") BETWEEN -90 AND 90),
  CONSTRAINT "OrderDeliveryDestination_address_length" CHECK (length(trim("addressLine")) BETWEEN 5 AND 500),
  CONSTRAINT "OrderDeliveryDestination_command_key" CHECK ("commandKey" ~ '^[A-Za-z0-9:_-]{8,128}$'),
  CONSTRAINT "OrderDeliveryDestination_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "OrderDeliveryDestination_orderId_key" ON "OrderDeliveryDestination"("orderId");
CREATE INDEX "OrderDeliveryDestination_serviceZoneId_idx" ON "OrderDeliveryDestination"("serviceZoneId");
CREATE INDEX "OrderDeliveryDestination_point_gist" ON "OrderDeliveryDestination" USING GIST ("destinationPoint");

CREATE TABLE "DispatchRun" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "suborderId" UUID NOT NULL,
  "countryId" UUID NOT NULL,
  "storeId" UUID NOT NULL,
  "destinationId" UUID NOT NULL,
  "pickupZoneId" UUID NOT NULL,
  "destinationZoneId" UUID NOT NULL,
  "pickupPoint" geometry(Point,4326) NOT NULL,
  "destinationPoint" geometry(Point,4326) NOT NULL,
  "status" "DispatchRunStatus" NOT NULL DEFAULT 'SEARCHING',
  "version" INTEGER NOT NULL DEFAULT 1,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "commandKey" VARCHAR(128) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DispatchRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DispatchRun_suborderId_fkey" FOREIGN KEY ("suborderId") REFERENCES "VendorSuborder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DispatchRun_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DispatchRun_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DispatchRun_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "OrderDeliveryDestination"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DispatchRun_pickupZoneId_fkey" FOREIGN KEY ("pickupZoneId") REFERENCES "ServiceZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DispatchRun_destinationZoneId_fkey" FOREIGN KEY ("destinationZoneId") REFERENCES "ServiceZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DispatchRun_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DispatchRun_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "DispatchRun_attempt_bounds" CHECK ("attemptCount" >= 0 AND "maxAttempts" BETWEEN 1 AND 10 AND "attemptCount" <= "maxAttempts"),
  CONSTRAINT "DispatchRun_command_key" CHECK ("commandKey" ~ '^[A-Za-z0-9:_-]{8,128}$'),
  CONSTRAINT "DispatchRun_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "DispatchRun_pickup_point_valid" CHECK (ST_SRID("pickupPoint")=4326 AND ST_IsValid("pickupPoint")),
  CONSTRAINT "DispatchRun_destination_point_valid" CHECK (ST_SRID("destinationPoint")=4326 AND ST_IsValid("destinationPoint"))
);
CREATE UNIQUE INDEX "DispatchRun_suborderId_key" ON "DispatchRun"("suborderId");
CREATE INDEX "DispatchRun_countryId_status_createdAt_idx" ON "DispatchRun"("countryId","status","createdAt");
CREATE INDEX "DispatchRun_storeId_status_idx" ON "DispatchRun"("storeId","status");
CREATE INDEX "DispatchRun_status_updatedAt_idx" ON "DispatchRun"("status","updatedAt");
CREATE INDEX "DispatchRun_pickup_point_gist" ON "DispatchRun" USING GIST ("pickupPoint");
CREATE INDEX "DispatchRun_destination_point_gist" ON "DispatchRun" USING GIST ("destinationPoint");

CREATE TABLE "DispatchOffer" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "runId" UUID NOT NULL,
  "riderId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "status" "DispatchOfferStatus" NOT NULL DEFAULT 'OFFERED',
  "offerTokenHash" VARCHAR(64) NOT NULL,
  "shiftId" UUID NOT NULL,
  "locationSampleId" UUID NOT NULL,
  "pickupZoneGrantId" UUID NOT NULL,
  "destinationZoneGrantId" UUID NOT NULL,
  "pickupDistanceMeters" INTEGER NOT NULL,
  "roadDistanceMeters" INTEGER NOT NULL,
  "durationSeconds" INTEGER,
  "routingProvider" VARCHAR(40) NOT NULL,
  "routingMode" "RoadRoutingMode" NOT NULL,
  "routeEvidenceHash" VARCHAR(64) NOT NULL,
  "commandKey" VARCHAR(128) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),
  "responseCommandKey" VARCHAR(128),
  "responsePayloadHash" VARCHAR(64),
  "responseReason" VARCHAR(512),
  CONSTRAINT "DispatchOffer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DispatchOffer_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DispatchRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DispatchOffer_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DispatchOffer_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "RiderShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DispatchOffer_locationSampleId_fkey" FOREIGN KEY ("locationSampleId") REFERENCES "RiderLocationSample"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DispatchOffer_pickupZoneGrantId_fkey" FOREIGN KEY ("pickupZoneGrantId") REFERENCES "RiderZoneGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DispatchOffer_destinationZoneGrantId_fkey" FOREIGN KEY ("destinationZoneGrantId") REFERENCES "RiderZoneGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DispatchOffer_sequence_positive" CHECK ("sequence" >= 1),
  CONSTRAINT "DispatchOffer_distances" CHECK ("pickupDistanceMeters" >= 0 AND "roadDistanceMeters" >= 0),
  CONSTRAINT "DispatchOffer_duration" CHECK ("durationSeconds" IS NULL OR "durationSeconds" >= 0),
  CONSTRAINT "DispatchOffer_routing_mode" CHECK ("routingMode" <> 'DISABLED'),
  CONSTRAINT "DispatchOffer_hashes" CHECK ("offerTokenHash" ~ '^[0-9a-f]{64}$' AND "routeEvidenceHash" ~ '^[0-9a-f]{64}$' AND "payloadHash" ~ '^[0-9a-f]{64}$' AND ("responsePayloadHash" IS NULL OR "responsePayloadHash" ~ '^[0-9a-f]{64}$')),
  CONSTRAINT "DispatchOffer_command_key" CHECK ("commandKey" ~ '^[A-Za-z0-9:_-]{8,128}$' AND ("responseCommandKey" IS NULL OR "responseCommandKey" ~ '^[A-Za-z0-9:_-]{8,128}$')),
  CONSTRAINT "DispatchOffer_ttl_30_seconds" CHECK ("expiresAt" = "offeredAt" + interval '30 seconds'),
  CONSTRAINT "DispatchOffer_response_reason" CHECK ("responseReason" IS NULL OR length(trim("responseReason")) BETWEEN 8 AND 512)
);
CREATE UNIQUE INDEX "DispatchOffer_runId_sequence_key" ON "DispatchOffer"("runId","sequence");
CREATE UNIQUE INDEX "DispatchOffer_runId_commandKey_key" ON "DispatchOffer"("runId","commandKey");
CREATE UNIQUE INDEX "DispatchOffer_one_open_per_run" ON "DispatchOffer"("runId") WHERE "status" = 'OFFERED';
CREATE UNIQUE INDEX "DispatchOffer_one_accepted_per_run" ON "DispatchOffer"("runId") WHERE "status" = 'ACCEPTED';
CREATE INDEX "DispatchOffer_riderId_status_expiresAt_idx" ON "DispatchOffer"("riderId","status","expiresAt");
CREATE INDEX "DispatchOffer_runId_status_idx" ON "DispatchOffer"("runId","status");
CREATE INDEX "DispatchOffer_expiresAt_idx" ON "DispatchOffer"("expiresAt") WHERE "status" = 'OFFERED';

CREATE TABLE "RiderAssignment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "runId" UUID NOT NULL,
  "offerId" UUID NOT NULL,
  "riderId" UUID NOT NULL,
  "suborderId" UUID NOT NULL,
  "countryId" UUID NOT NULL,
  "status" "RiderAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "shiftId" UUID NOT NULL,
  "locationSampleId" UUID NOT NULL,
  "pickupDistanceMeters" INTEGER NOT NULL,
  "roadDistanceMeters" INTEGER NOT NULL,
  "durationSeconds" INTEGER,
  "routingProvider" VARCHAR(40) NOT NULL,
  "routingMode" "RoadRoutingMode" NOT NULL,
  "routeEvidenceHash" VARCHAR(64) NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RiderAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RiderAssignment_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DispatchRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RiderAssignment_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "DispatchOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RiderAssignment_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RiderAssignment_suborderId_fkey" FOREIGN KEY ("suborderId") REFERENCES "VendorSuborder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RiderAssignment_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RiderAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "RiderShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RiderAssignment_locationSampleId_fkey" FOREIGN KEY ("locationSampleId") REFERENCES "RiderLocationSample"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RiderAssignment_distances" CHECK ("pickupDistanceMeters" >= 0 AND "roadDistanceMeters" >= 0),
  CONSTRAINT "RiderAssignment_duration" CHECK ("durationSeconds" IS NULL OR "durationSeconds" >= 0),
  CONSTRAINT "RiderAssignment_routing_mode" CHECK ("routingMode" <> 'DISABLED'),
  CONSTRAINT "RiderAssignment_route_hash" CHECK ("routeEvidenceHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "RiderAssignment_runId_key" ON "RiderAssignment"("runId");
CREATE UNIQUE INDEX "RiderAssignment_offerId_key" ON "RiderAssignment"("offerId");
CREATE UNIQUE INDEX "RiderAssignment_one_active_per_rider" ON "RiderAssignment"("riderId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "RiderAssignment_one_active_per_suborder" ON "RiderAssignment"("suborderId") WHERE "status" = 'ACTIVE';
CREATE INDEX "RiderAssignment_riderId_status_idx" ON "RiderAssignment"("riderId","status");
CREATE INDEX "RiderAssignment_suborderId_idx" ON "RiderAssignment"("suborderId");

CREATE TABLE "DispatchEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "runId" UUID NOT NULL,
  "offerId" UUID,
  "assignmentId" UUID,
  "eventType" VARCHAR(80) NOT NULL,
  "actorUserId" UUID,
  "commandKey" VARCHAR(128) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "reason" VARCHAR(512),
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DispatchEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DispatchEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DispatchRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DispatchEvent_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "DispatchOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DispatchEvent_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "RiderAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DispatchEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DispatchEvent_command_key" CHECK ("commandKey" ~ '^[A-Za-z0-9:_-]{8,128}$'),
  CONSTRAINT "DispatchEvent_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "DispatchEvent_reason_length" CHECK ("reason" IS NULL OR length(trim("reason")) BETWEEN 8 AND 512)
);
CREATE UNIQUE INDEX "DispatchEvent_runId_commandKey_key" ON "DispatchEvent"("runId","commandKey");
CREATE INDEX "DispatchEvent_runId_occurredAt_idx" ON "DispatchEvent"("runId","occurredAt");

-- Helpers --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gs_dispatch_now() RETURNS TIMESTAMP LANGUAGE sql STABLE AS $$
  SELECT clock_timestamp()::timestamp;
$$;

CREATE OR REPLACE FUNCTION gs_rider_dispatch_eligible(
  rider_uuid UUID, country_uuid UUID, pickup_zone UUID, destination_zone UUID,
  shift_uuid UUID, location_uuid UUID, pickup_grant_uuid UUID, destination_grant_uuid UUID
) RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE r "RiderProfile"%ROWTYPE; s "RiderShift"%ROWTYPE; c "RiderLocationConsent"%ROWTYPE; l "RiderLocationSample"%ROWTYPE;
BEGIN
  SELECT * INTO r FROM "RiderProfile" WHERE "id" = rider_uuid;
  IF NOT FOUND OR r."countryId" <> country_uuid OR NOT gs_rider_kyc_eligible(rider_uuid) THEN RETURN false; END IF;
  SELECT * INTO s FROM "RiderShift" WHERE "id" = shift_uuid;
  IF NOT FOUND OR s."riderId" <> rider_uuid OR s."status" <> 'ACTIVE' THEN RETURN false; END IF;
  SELECT * INTO c FROM "RiderLocationConsent" WHERE "riderId" = rider_uuid;
  IF NOT FOUND OR c."consented" <> true OR c."consentVersion" <> s."consentVersion" THEN RETURN false; END IF;
  SELECT * INTO l FROM "RiderLocationSample" WHERE "id" = location_uuid;
  IF NOT FOUND OR l."riderId" <> rider_uuid OR l."shiftId" <> shift_uuid OR l."accuracyMeters" > 100
     OR l."recordedAt" < gs_dispatch_now() - interval '120 seconds'
     OR l."recordedAt" > gs_dispatch_now() + interval '30 seconds' THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM "RiderZoneGrant" g WHERE g."id"=pickup_grant_uuid AND g."riderId"=rider_uuid AND g."serviceZoneId"=pickup_zone AND g."revokedAt" IS NULL AND (g."expiresAt" IS NULL OR g."expiresAt">gs_dispatch_now())) THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM "RiderZoneGrant" g WHERE g."id"=destination_grant_uuid AND g."riderId"=rider_uuid AND g."serviceZoneId"=destination_zone AND g."revokedAt" IS NULL AND (g."expiresAt" IS NULL OR g."expiresAt">gs_dispatch_now())) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM "RiderAssignment" a WHERE a."riderId"=rider_uuid AND a."status"='ACTIVE') THEN RETURN false; END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION gs_dispatch_candidate_rows(run_uuid UUID)
RETURNS TABLE (
  "riderId" UUID, "shiftId" UUID, "locationSampleId" UUID, "pickupZoneGrantId" UUID, "destinationZoneGrantId" UUID,
  latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, priority INTEGER, "lastOfferAt" TIMESTAMP, "vehicleType" "RiderVehicleType"
) LANGUAGE sql STABLE AS $$
  WITH run AS (SELECT * FROM "DispatchRun" WHERE "id"=run_uuid),
  latest_location AS (
    SELECT DISTINCT ON (l."riderId") l.* FROM "RiderLocationSample" l
    JOIN "RiderShift" s ON s."id"=l."shiftId" AND s."status"='ACTIVE'
    ORDER BY l."riderId", l."recordedAt" DESC, l."receivedAt" DESC
  ),
  pickup_grant AS (
    SELECT DISTINCT ON (g."riderId") g.* FROM "RiderZoneGrant" g JOIN run ON g."serviceZoneId"=run."pickupZoneId"
    WHERE g."revokedAt" IS NULL AND (g."expiresAt" IS NULL OR g."expiresAt">gs_dispatch_now())
    ORDER BY g."riderId", g."createdAt" DESC
  ),
  destination_grant AS (
    SELECT DISTINCT ON (g."riderId") g.* FROM "RiderZoneGrant" g JOIN run ON g."serviceZoneId"=run."destinationZoneId"
    WHERE g."revokedAt" IS NULL AND (g."expiresAt" IS NULL OR g."expiresAt">gs_dispatch_now())
    ORDER BY g."riderId", g."createdAt" DESC
  )
  SELECT r."id", s."id", l."id", pg."id", dg."id", ST_Y(l."location"), ST_X(l."location"), r."dispatchPriority",
         (SELECT max(o."offeredAt") FROM "DispatchOffer" o WHERE o."runId"=run_uuid AND o."riderId"=r."id"), r."vehicleType"
  FROM "RiderProfile" r
  JOIN run ON r."countryId"=run."countryId"
  JOIN "RiderShift" s ON s."riderId"=r."id" AND s."status"='ACTIVE'
  JOIN "RiderLocationConsent" c ON c."riderId"=r."id" AND c."consented"=true AND c."consentVersion"=s."consentVersion"
  JOIN latest_location l ON l."riderId"=r."id" AND l."shiftId"=s."id"
  JOIN pickup_grant pg ON pg."riderId"=r."id"
  JOIN destination_grant dg ON dg."riderId"=r."id"
  WHERE gs_rider_kyc_eligible(r."id")
    AND l."accuracyMeters" <= 100
    AND l."recordedAt" >= gs_dispatch_now() - interval '120 seconds'
    AND l."recordedAt" <= gs_dispatch_now() + interval '30 seconds'
    AND NOT EXISTS (SELECT 1 FROM "RiderAssignment" a WHERE a."riderId"=r."id" AND a."status"='ACTIVE')
    AND NOT EXISTS (SELECT 1 FROM "DispatchOffer" o WHERE o."runId"=run_uuid AND o."riderId"=r."id")
    AND r."vehicleType" IN ('BICYCLE','MOTORBIKE','CAR')
  ORDER BY r."dispatchPriority" DESC, r."id";
$$;

-- Guards ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gs_delivery_destination_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o "Order"%ROWTYPE; z "ServiceZone"%ROWTYPE; b "BoundaryVersion"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'dispatch_write_privileged_only'; END IF;
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'delivery_destination_immutable'; END IF;
  SELECT * INTO o FROM "Order" WHERE "id"=NEW."orderId";
  IF NOT FOUND OR o."buyerId" <> NEW."setByUserId" OR NEW."setByUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'delivery_destination_actor_mismatch'; END IF;
  IF o."countryId" <> NEW."countryId" OR o."destinationCityId" <> NEW."cityId" THEN RAISE EXCEPTION 'delivery_destination_order_mismatch'; END IF;
  SELECT * INTO z FROM "ServiceZone" WHERE "id"=NEW."serviceZoneId";
  IF NOT FOUND OR z."status" <> 'ACTIVE' OR z."cityId" <> NEW."cityId" THEN RAISE EXCEPTION 'delivery_destination_zone_mismatch'; END IF;
  SELECT * INTO b FROM "BoundaryVersion" WHERE "id"=NEW."boundaryVersionId";
  IF NOT FOUND OR b."ownerType" <> 'ZONE' OR b."ownerId" <> NEW."serviceZoneId" OR b."approvedBy" IS NULL OR b."validFrom" > gs_dispatch_now() THEN RAISE EXCEPTION 'delivery_destination_boundary_not_approved'; END IF;
  IF NOT ST_Covers(b."boundary", NEW."destinationPoint") THEN RAISE EXCEPTION 'delivery_destination_outside_zone'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER delivery_destination_guard BEFORE INSERT OR UPDATE OR DELETE ON "OrderDeliveryDestination" FOR EACH ROW EXECUTE FUNCTION gs_delivery_destination_guard();

CREATE OR REPLACE FUNCTION gs_dispatch_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "VendorSuborder"%ROWTYPE; o "Order"%ROWTYPE; d "OrderDeliveryDestination"%ROWTYPE; p "StorePickupPoint"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'dispatch_write_privileged_only'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'SEARCHING' OR NEW."version" <> 1 OR NEW."attemptCount" <> 0 THEN RAISE EXCEPTION 'dispatch_run_must_start_searching'; END IF;
    IF NEW."createdByUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'dispatch_run_actor_mismatch'; END IF;
    SELECT * INTO s FROM "VendorSuborder" WHERE "id"=NEW."suborderId";
    IF NOT FOUND OR s."status" <> 'READY_FOR_PICKUP' OR s."storeId" <> NEW."storeId" THEN RAISE EXCEPTION 'dispatch_suborder_not_ready'; END IF;
    SELECT * INTO o FROM "Order" WHERE "id"=s."orderId";
    IF NOT FOUND OR o."countryId" <> NEW."countryId" OR o."paymentStatus" NOT IN ('PAYMENT_VERIFIED','AWAITING_COD') THEN RAISE EXCEPTION 'dispatch_payment_not_ready'; END IF;
    IF NOT gs_store_serviceable(NEW."storeId") THEN RAISE EXCEPTION 'dispatch_store_not_serviceable'; END IF;
    SELECT * INTO d FROM "OrderDeliveryDestination" WHERE "id"=NEW."destinationId";
    IF NOT FOUND OR d."orderId" <> o."id" OR d."countryId" <> NEW."countryId" OR d."serviceZoneId" <> NEW."destinationZoneId" OR d."destinationPoint" <> NEW."destinationPoint" THEN RAISE EXCEPTION 'dispatch_destination_mismatch'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "StoreServiceArea" a WHERE a."storeId"=NEW."storeId" AND a."serviceZoneId"=NEW."destinationZoneId" AND a."status"='APPROVED') THEN RAISE EXCEPTION 'dispatch_store_area_not_approved'; END IF;
    SELECT * INTO p FROM "StorePickupPoint" WHERE "storeId"=NEW."storeId" AND "status"='APPROVED';
    IF NOT FOUND OR p."pickupPoint" <> NEW."pickupPoint" THEN RAISE EXCEPTION 'dispatch_pickup_mismatch'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ServiceZone" z JOIN "BoundaryVersion" b ON b."ownerType"='ZONE' AND b."ownerId"=z."id" WHERE z."id"=NEW."pickupZoneId" AND z."status"='ACTIVE' AND b."approvedBy" IS NOT NULL AND b."validFrom"<=gs_dispatch_now() AND ST_Covers(b."boundary", NEW."pickupPoint")) THEN RAISE EXCEPTION 'dispatch_pickup_zone_not_covered'; END IF;
  ELSE
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."suborderId" IS DISTINCT FROM OLD."suborderId" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."storeId" IS DISTINCT FROM OLD."storeId" OR NEW."destinationId" IS DISTINCT FROM OLD."destinationId" OR NEW."pickupZoneId" IS DISTINCT FROM OLD."pickupZoneId" OR NEW."destinationZoneId" IS DISTINCT FROM OLD."destinationZoneId" OR NEW."pickupPoint" IS DISTINCT FROM OLD."pickupPoint" OR NEW."destinationPoint" IS DISTINCT FROM OLD."destinationPoint" OR NEW."commandKey" IS DISTINCT FROM OLD."commandKey" OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash" OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW."maxAttempts" IS DISTINCT FROM OLD."maxAttempts" THEN RAISE EXCEPTION 'dispatch_run_immutable_fields'; END IF;
    IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'dispatch_run_version_conflict'; END IF;
    IF NOT ((OLD."status"='SEARCHING' AND NEW."status" IN ('OFFERING','MANUAL_REVIEW')) OR (OLD."status"='OFFERING' AND NEW."status" IN ('SEARCHING','ASSIGNED','MANUAL_REVIEW'))) THEN RAISE EXCEPTION 'dispatch_run_invalid_transition'; END IF;
    IF NEW."status"='OFFERING' THEN
      IF NEW."attemptCount" <> OLD."attemptCount" + 1 OR NEW."attemptCount" > NEW."maxAttempts" THEN RAISE EXCEPTION 'dispatch_attempt_invalid'; END IF;
    ELSIF NEW."attemptCount" <> OLD."attemptCount" THEN RAISE EXCEPTION 'dispatch_attempt_immutable'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dispatch_run_guard BEFORE INSERT OR UPDATE ON "DispatchRun" FOR EACH ROW EXECUTE FUNCTION gs_dispatch_run_guard();

CREATE OR REPLACE FUNCTION gs_dispatch_offer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "DispatchRun"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'dispatch_write_privileged_only'; END IF;
  SELECT * INTO r FROM "DispatchRun" WHERE "id"=NEW."runId";
  IF NOT FOUND THEN RAISE EXCEPTION 'dispatch_run_not_found'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'OFFERED' OR NEW."respondedAt" IS NOT NULL OR NEW."responseCommandKey" IS NOT NULL OR NEW."responsePayloadHash" IS NOT NULL THEN RAISE EXCEPTION 'dispatch_offer_must_start_offered'; END IF;
    IF r."status" <> 'OFFERING' OR r."attemptCount" <> NEW."sequence" THEN RAISE EXCEPTION 'dispatch_offer_run_mismatch'; END IF;
    IF NEW."offeredAt" > gs_dispatch_now() OR NEW."offeredAt" < gs_dispatch_now() - interval '5 seconds' THEN RAISE EXCEPTION 'dispatch_offer_must_use_db_time'; END IF;
    IF NOT gs_rider_dispatch_eligible(NEW."riderId", r."countryId", r."pickupZoneId", r."destinationZoneId", NEW."shiftId", NEW."locationSampleId", NEW."pickupZoneGrantId", NEW."destinationZoneGrantId") THEN RAISE EXCEPTION 'dispatch_rider_not_eligible'; END IF;
  ELSE
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."runId" IS DISTINCT FROM OLD."runId" OR NEW."riderId" IS DISTINCT FROM OLD."riderId" OR NEW."sequence" IS DISTINCT FROM OLD."sequence" OR NEW."offerTokenHash" IS DISTINCT FROM OLD."offerTokenHash" OR NEW."shiftId" IS DISTINCT FROM OLD."shiftId" OR NEW."locationSampleId" IS DISTINCT FROM OLD."locationSampleId" OR NEW."pickupZoneGrantId" IS DISTINCT FROM OLD."pickupZoneGrantId" OR NEW."destinationZoneGrantId" IS DISTINCT FROM OLD."destinationZoneGrantId" OR NEW."pickupDistanceMeters" IS DISTINCT FROM OLD."pickupDistanceMeters" OR NEW."roadDistanceMeters" IS DISTINCT FROM OLD."roadDistanceMeters" OR NEW."durationSeconds" IS DISTINCT FROM OLD."durationSeconds" OR NEW."routingProvider" IS DISTINCT FROM OLD."routingProvider" OR NEW."routingMode" IS DISTINCT FROM OLD."routingMode" OR NEW."routeEvidenceHash" IS DISTINCT FROM OLD."routeEvidenceHash" OR NEW."commandKey" IS DISTINCT FROM OLD."commandKey" OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash" OR NEW."offeredAt" IS DISTINCT FROM OLD."offeredAt" OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" THEN RAISE EXCEPTION 'dispatch_offer_immutable_fields'; END IF;
    IF OLD."status" <> 'OFFERED' OR NEW."status" NOT IN ('ACCEPTED','REJECTED','EXPIRED','CANCELLED') THEN RAISE EXCEPTION 'dispatch_offer_invalid_transition'; END IF;
    IF NEW."respondedAt" IS NULL OR NEW."responseCommandKey" IS NULL OR NEW."responsePayloadHash" IS NULL THEN RAISE EXCEPTION 'dispatch_offer_response_metadata_required'; END IF;
    IF NEW."status"='ACCEPTED' THEN
      IF gs_dispatch_now() >= OLD."expiresAt" THEN RAISE EXCEPTION 'dispatch_offer_expired'; END IF;
      IF r."status" <> 'ASSIGNED' THEN RAISE EXCEPTION 'dispatch_offer_run_not_assigned'; END IF;
      IF NOT gs_rider_dispatch_eligible(NEW."riderId", r."countryId", r."pickupZoneId", r."destinationZoneId", NEW."shiftId", NEW."locationSampleId", NEW."pickupZoneGrantId", NEW."destinationZoneGrantId") THEN RAISE EXCEPTION 'dispatch_rider_not_eligible'; END IF;
    END IF;
    IF NEW."status" IN ('REJECTED','CANCELLED') AND NEW."responseReason" IS NULL THEN RAISE EXCEPTION 'dispatch_offer_reason_required'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dispatch_offer_guard BEFORE INSERT OR UPDATE ON "DispatchOffer" FOR EACH ROW EXECUTE FUNCTION gs_dispatch_offer_guard();

CREATE OR REPLACE FUNCTION gs_rider_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o "DispatchOffer"%ROWTYPE; r "DispatchRun"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'dispatch_write_privileged_only'; END IF;
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'rider_assignment_immutable'; END IF;
  IF NEW."status" <> 'ACTIVE' THEN RAISE EXCEPTION 'rider_assignment_must_start_active'; END IF;
  SELECT * INTO o FROM "DispatchOffer" WHERE "id"=NEW."offerId";
  IF NOT FOUND OR o."status" <> 'ACCEPTED' OR o."runId" <> NEW."runId" OR o."riderId" <> NEW."riderId" THEN RAISE EXCEPTION 'assignment_offer_mismatch'; END IF;
  SELECT * INTO r FROM "DispatchRun" WHERE "id"=NEW."runId";
  IF NOT FOUND OR r."status" <> 'ASSIGNED' OR r."suborderId" <> NEW."suborderId" OR r."countryId" <> NEW."countryId" THEN RAISE EXCEPTION 'assignment_run_mismatch'; END IF;
  IF NEW."shiftId" <> o."shiftId" OR NEW."locationSampleId" <> o."locationSampleId" OR NEW."pickupDistanceMeters" <> o."pickupDistanceMeters" OR NEW."roadDistanceMeters" <> o."roadDistanceMeters" OR NEW."durationSeconds" IS DISTINCT FROM o."durationSeconds" OR NEW."routingProvider" <> o."routingProvider" OR NEW."routingMode" <> o."routingMode" OR NEW."routeEvidenceHash" <> o."routeEvidenceHash" THEN RAISE EXCEPTION 'assignment_route_snapshot_mismatch'; END IF;
  IF gs_dispatch_now() >= o."expiresAt" THEN RAISE EXCEPTION 'dispatch_offer_expired'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rider_assignment_guard BEFORE INSERT OR UPDATE OR DELETE ON "RiderAssignment" FOR EACH ROW EXECUTE FUNCTION gs_rider_assignment_guard();

CREATE OR REPLACE FUNCTION gs_dispatch_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'dispatch_write_privileged_only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "DispatchRun" WHERE "id"=NEW."runId") THEN RAISE EXCEPTION 'dispatch_event_run_missing'; END IF;
  IF NEW."actorUserId" IS NOT NULL AND NEW."actorUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'dispatch_event_actor_mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dispatch_event_guard BEFORE INSERT ON "DispatchEvent" FOR EACH ROW EXECUTE FUNCTION gs_dispatch_event_guard();
CREATE TRIGGER dispatch_event_append_only BEFORE UPDATE OR DELETE ON "DispatchEvent" FOR EACH ROW EXECUTE FUNCTION gs_append_only();

CREATE OR REPLACE FUNCTION gs_dispatch_run_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status"='OFFERING' THEN
    IF NOT EXISTS (SELECT 1 FROM "DispatchOffer" o WHERE o."runId"=NEW."id" AND o."status"='OFFERED' AND o."sequence"=NEW."attemptCount") THEN RAISE EXCEPTION 'dispatch_open_offer_required'; END IF;
  ELSIF NEW."status"='ASSIGNED' THEN
    IF NOT EXISTS (SELECT 1 FROM "RiderAssignment" a WHERE a."runId"=NEW."id" AND a."status"='ACTIVE') THEN RAISE EXCEPTION 'dispatch_assignment_required'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "DispatchOffer" o WHERE o."runId"=NEW."id" AND o."status"='ACCEPTED') THEN RAISE EXCEPTION 'dispatch_accepted_offer_required'; END IF;
  ELSIF EXISTS (SELECT 1 FROM "DispatchOffer" o WHERE o."runId"=NEW."id" AND o."status"='OFFERED') THEN
    RAISE EXCEPTION 'dispatch_open_offer_not_allowed';
  END IF;
  IF NEW."attemptCount" <> (SELECT count(*) FROM "DispatchOffer" o WHERE o."runId"=NEW."id") THEN RAISE EXCEPTION 'dispatch_attempt_count_mismatch'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER dispatch_run_consistent AFTER INSERT OR UPDATE ON "DispatchRun" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_dispatch_run_consistent();

-- DB-time expiry / escalation -------------------------------------------------
CREATE OR REPLACE FUNCTION gs_expire_dispatch_offers(batch_size INTEGER)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE offer_row RECORD; run_row "DispatchRun"%ROWTYPE; expired INTEGER := 0; next_status "DispatchRunStatus"; event_key TEXT; payload JSONB;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'dispatch_write_privileged_only'; END IF;
  IF batch_size < 1 OR batch_size > 500 THEN RAISE EXCEPTION 'dispatch_expiry_batch_invalid'; END IF;
  FOR offer_row IN
    SELECT o.* FROM "DispatchOffer" o WHERE o."status"='OFFERED' AND o."expiresAt" <= gs_dispatch_now()
    ORDER BY o."expiresAt" LIMIT batch_size FOR UPDATE SKIP LOCKED
  LOOP
    SELECT * INTO run_row FROM "DispatchRun" WHERE "id"=offer_row."runId" FOR UPDATE;
    UPDATE "DispatchOffer" SET "status"='EXPIRED', "respondedAt"=gs_dispatch_now(), "responseCommandKey"='expire-'||offer_row."id", "responsePayloadHash"=encode(sha256(convert_to('expire:'||offer_row."id"::text,'UTF8')),'hex'), "responseReason"='Offer expired after 30 seconds' WHERE "id"=offer_row."id";
    next_status := CASE WHEN run_row."attemptCount" >= run_row."maxAttempts" THEN 'MANUAL_REVIEW'::"DispatchRunStatus" ELSE 'SEARCHING'::"DispatchRunStatus" END;
    UPDATE "DispatchRun" SET "status"=next_status, "version"="version"+1, "updatedAt"=gs_dispatch_now() WHERE "id"=run_row."id";
    event_key := 'offer-expired-'||offer_row."id";
    payload := jsonb_build_object('offerId',offer_row."id",'riderId',offer_row."riderId",'sequence',offer_row."sequence",'nextStatus',next_status);
    INSERT INTO "DispatchEvent"("runId","offerId","eventType","commandKey","payloadHash","reason") VALUES (run_row."id",offer_row."id",'dispatch.offer.expired',event_key,encode(sha256(convert_to(payload::text,'UTF8')),'hex'),'Offer expired after 30 seconds');
    INSERT INTO "AuditLog"(id,"actorType",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES (gen_random_uuid(),'SYSTEM','dispatch.offer.expired','DispatchRun',run_row."id",jsonb_build_object('countryId',run_row."countryId"),'Offer expired after 30 seconds',gen_random_uuid());
    INSERT INTO "OutboxEvent"(id,"aggregateType","aggregateId","eventKey","eventType","occurredAt",payload) VALUES (gen_random_uuid(),'DispatchRun',run_row."id",event_key,'dispatch.offer.expired',gs_dispatch_now(),jsonb_build_object('schemaVersion',1,'eventKey',event_key,'eventType','dispatch.offer.expired','occurredAt',gs_dispatch_now(),'aggregateType','DispatchRun','aggregateId',run_row."id",'countryId',run_row."countryId",'data',payload));
    expired := expired + 1;
  END LOOP;
  RETURN expired;
END;
$$;

-- RLS ------------------------------------------------------------------------
ALTER TABLE "OrderDeliveryDestination" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OrderDeliveryDestination" FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_destination_select_buyer_or_super ON "OrderDeliveryDestination" FOR SELECT USING (gs_is_super() OR EXISTS (SELECT 1 FROM "Order" o WHERE o."id"="OrderDeliveryDestination"."orderId" AND o."buyerId"=gs_current_user_id()));
CREATE POLICY delivery_destination_insert_super ON "OrderDeliveryDestination" FOR INSERT WITH CHECK (gs_is_super());

ALTER TABLE "DispatchRun" ENABLE ROW LEVEL SECURITY; ALTER TABLE "DispatchRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY dispatch_run_select_authorized ON "DispatchRun" FOR SELECT USING (
  gs_is_super()
  OR EXISTS (SELECT 1 FROM "RiderAssignment" a JOIN "RiderProfile" r ON r."id"=a."riderId" WHERE a."runId"="DispatchRun"."id" AND r."userId"=gs_current_user_id())
  OR EXISTS (SELECT 1 FROM "DispatchOffer" o JOIN "RiderProfile" r ON r."id"=o."riderId" WHERE o."runId"="DispatchRun"."id" AND r."userId"=gs_current_user_id())
);
CREATE POLICY dispatch_run_insert_super ON "DispatchRun" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY dispatch_run_update_super ON "DispatchRun" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

ALTER TABLE "DispatchOffer" ENABLE ROW LEVEL SECURITY; ALTER TABLE "DispatchOffer" FORCE ROW LEVEL SECURITY;
CREATE POLICY dispatch_offer_select_rider_or_super ON "DispatchOffer" FOR SELECT USING (gs_is_super() OR EXISTS (SELECT 1 FROM "RiderProfile" r WHERE r."id"="DispatchOffer"."riderId" AND r."userId"=gs_current_user_id()));
CREATE POLICY dispatch_offer_insert_super ON "DispatchOffer" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY dispatch_offer_update_super ON "DispatchOffer" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

ALTER TABLE "RiderAssignment" ENABLE ROW LEVEL SECURITY; ALTER TABLE "RiderAssignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY rider_assignment_select_rider_or_super ON "RiderAssignment" FOR SELECT USING (gs_is_super() OR EXISTS (SELECT 1 FROM "RiderProfile" r WHERE r."id"="RiderAssignment"."riderId" AND r."userId"=gs_current_user_id()));
CREATE POLICY rider_assignment_insert_super ON "RiderAssignment" FOR INSERT WITH CHECK (gs_is_super());

ALTER TABLE "DispatchEvent" ENABLE ROW LEVEL SECURITY; ALTER TABLE "DispatchEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY dispatch_event_select_super ON "DispatchEvent" FOR SELECT USING (gs_is_super());
CREATE POLICY dispatch_event_insert_super ON "DispatchEvent" FOR INSERT WITH CHECK (gs_is_super());

COMMENT ON TABLE "DispatchRun" IS 'One dispatch run per ready suborder; atomic 30-second offers and single active assignment.';
COMMENT ON TABLE "DispatchOffer" IS 'One open offer per run; DB-time 30-second TTL; road-route evidence required.';
COMMENT ON TABLE "RiderAssignment" IS 'Single active assignment per rider and suborder; immutable route snapshot at acceptance.';
COMMENT ON FUNCTION gs_expire_dispatch_offers(INTEGER) IS 'Privileged bounded expiry/escalation wake; database status/time is authoritative.';
