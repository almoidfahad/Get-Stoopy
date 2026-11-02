-- Store pickup geometry/hours/service-area approval and rider eligibility foundation.
-- Additive only. Dispatch offers/assignments, OTP, earnings and payouts remain pending.
CREATE TYPE "ServiceabilityStatus" AS ENUM ('DRAFT','APPROVED','REJECTED');
CREATE TYPE "StoreServiceAreaStatus" AS ENUM ('DRAFT','APPROVED','REJECTED','SUSPENDED');
CREATE TYPE "RiderShiftStatus" AS ENUM ('ACTIVE','ENDED');

CREATE TABLE "StorePickupPoint" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "storeId" UUID NOT NULL,
  "pickupPoint" geometry(Point,4326) NOT NULL,
  "status" "ServiceabilityStatus" NOT NULL DEFAULT 'DRAFT',
  "proposedByUserId" UUID NOT NULL,
  "reviewedByUserId" UUID,
  "reviewReason" VARCHAR(512),
  "reviewedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StorePickupPoint_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StorePickupPoint_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StorePickupPoint_proposedByUserId_fkey" FOREIGN KEY ("proposedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StorePickupPoint_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StorePickupPoint_point_valid" CHECK (ST_SRID("pickupPoint") = 4326 AND ST_IsValid("pickupPoint") AND ST_X("pickupPoint") BETWEEN -180 AND 180 AND ST_Y("pickupPoint") BETWEEN -90 AND 90),
  CONSTRAINT "StorePickupPoint_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "StorePickupPoint_reason_length" CHECK ("reviewReason" IS NULL OR length(trim("reviewReason")) BETWEEN 8 AND 512)
);
CREATE UNIQUE INDEX "StorePickupPoint_storeId_key" ON "StorePickupPoint"("storeId");
CREATE INDEX "StorePickupPoint_status_idx" ON "StorePickupPoint"("status");
CREATE INDEX "StorePickupPoint_point_gist" ON "StorePickupPoint" USING GIST ("pickupPoint");

CREATE TABLE "StoreOperatingHour" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "storeId" UUID NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "openMinute" INTEGER NOT NULL,
  "closeMinute" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoreOperatingHour_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StoreOperatingHour_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StoreOperatingHour_day_bounds" CHECK ("dayOfWeek" BETWEEN 0 AND 6),
  CONSTRAINT "StoreOperatingHour_open_bounds" CHECK ("openMinute" BETWEEN 0 AND 1439),
  CONSTRAINT "StoreOperatingHour_close_bounds" CHECK ("closeMinute" BETWEEN 1 AND 1440),
  CONSTRAINT "StoreOperatingHour_window" CHECK ("closeMinute" > "openMinute")
);
CREATE UNIQUE INDEX "StoreOperatingHour_storeId_dayOfWeek_openMinute_key" ON "StoreOperatingHour"("storeId","dayOfWeek","openMinute");
CREATE INDEX "StoreOperatingHour_storeId_dayOfWeek_idx" ON "StoreOperatingHour"("storeId","dayOfWeek");

CREATE TABLE "StoreServiceArea" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "storeId" UUID NOT NULL,
  "serviceZoneId" UUID NOT NULL,
  "status" "StoreServiceAreaStatus" NOT NULL DEFAULT 'DRAFT',
  "proposedByUserId" UUID NOT NULL,
  "reviewedByUserId" UUID,
  "reviewReason" VARCHAR(512),
  "reviewedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StoreServiceArea_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StoreServiceArea_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StoreServiceArea_serviceZoneId_fkey" FOREIGN KEY ("serviceZoneId") REFERENCES "ServiceZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StoreServiceArea_proposedByUserId_fkey" FOREIGN KEY ("proposedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StoreServiceArea_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StoreServiceArea_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "StoreServiceArea_reason_length" CHECK ("reviewReason" IS NULL OR length(trim("reviewReason")) BETWEEN 8 AND 512)
);
CREATE UNIQUE INDEX "StoreServiceArea_storeId_serviceZoneId_key" ON "StoreServiceArea"("storeId","serviceZoneId");
CREATE INDEX "StoreServiceArea_serviceZoneId_status_idx" ON "StoreServiceArea"("serviceZoneId","status");

CREATE TABLE "RiderShift" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "riderId" UUID NOT NULL,
  "status" "RiderShiftStatus" NOT NULL DEFAULT 'ACTIVE',
  "consentVersion" VARCHAR(64) NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RiderShift_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RiderShift_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RiderShift_consent_version" CHECK (length(trim("consentVersion")) BETWEEN 1 AND 64)
);
CREATE UNIQUE INDEX "RiderShift_one_active_per_rider" ON "RiderShift"("riderId") WHERE "status" = 'ACTIVE';
CREATE INDEX "RiderShift_riderId_status_idx" ON "RiderShift"("riderId","status");

CREATE TABLE "RiderLocationConsent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "riderId" UUID NOT NULL,
  "consented" BOOLEAN NOT NULL DEFAULT false,
  "consentVersion" VARCHAR(64) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RiderLocationConsent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RiderLocationConsent_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RiderLocationConsent_consent_version" CHECK (length(trim("consentVersion")) BETWEEN 1 AND 64)
);
CREATE UNIQUE INDEX "RiderLocationConsent_riderId_key" ON "RiderLocationConsent"("riderId");

CREATE TABLE "RiderLocationSample" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "riderId" UUID NOT NULL,
  "shiftId" UUID NOT NULL,
  "location" geometry(Point,4326) NOT NULL,
  "accuracyMeters" INTEGER NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RiderLocationSample_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RiderLocationSample_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RiderLocationSample_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "RiderShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RiderLocationSample_point_valid" CHECK (ST_SRID("location") = 4326 AND ST_IsValid("location") AND ST_X("location") BETWEEN -180 AND 180 AND ST_Y("location") BETWEEN -90 AND 90),
  CONSTRAINT "RiderLocationSample_accuracy_bounds" CHECK ("accuracyMeters" BETWEEN 0 AND 1000),
  CONSTRAINT "RiderLocationSample_not_future" CHECK ("recordedAt" <= CURRENT_TIMESTAMP + interval '30 seconds'),
  CONSTRAINT "RiderLocationSample_not_ancient" CHECK ("recordedAt" >= CURRENT_TIMESTAMP - interval '24 hours')
);
CREATE INDEX "RiderLocationSample_riderId_receivedAt_idx" ON "RiderLocationSample"("riderId","receivedAt");
CREATE INDEX "RiderLocationSample_shiftId_receivedAt_idx" ON "RiderLocationSample"("shiftId","receivedAt");
CREATE INDEX "RiderLocationSample_location_gist" ON "RiderLocationSample" USING GIST ("location");

CREATE TABLE "RiderZoneGrant" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "riderId" UUID NOT NULL,
  "serviceZoneId" UUID NOT NULL,
  "grantedBy" UUID NOT NULL,
  "reason" VARCHAR(512) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RiderZoneGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RiderZoneGrant_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RiderZoneGrant_serviceZoneId_fkey" FOREIGN KEY ("serviceZoneId") REFERENCES "ServiceZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RiderZoneGrant_grantedBy_fkey" FOREIGN KEY ("grantedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RiderZoneGrant_reason_length" CHECK (length(trim("reason")) BETWEEN 8 AND 512)
);
CREATE INDEX "RiderZoneGrant_riderId_revokedAt_idx" ON "RiderZoneGrant"("riderId","revokedAt");
CREATE INDEX "RiderZoneGrant_serviceZoneId_revokedAt_idx" ON "RiderZoneGrant"("serviceZoneId","revokedAt");

-- Helpers
CREATE OR REPLACE FUNCTION gs_rider_kyc_eligible(rider_uuid UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "RiderProfile" r JOIN "KycCase" k ON k."id" = r."kycCaseId"
    WHERE r."id" = rider_uuid AND r."status" = 'ACTIVE'
      AND k."subjectUserId" = r."userId" AND k."subjectType" = 'RIDER'
      AND k."countryId" = r."countryId" AND k."status" = 'APPROVED'
      AND k."expiresAt" IS NOT NULL AND k."expiresAt" > CURRENT_TIMESTAMP
  );
$$;

CREATE OR REPLACE FUNCTION gs_store_serviceable(store_uuid UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Store" s
    WHERE s."id" = store_uuid AND s."status" = 'ACTIVE' AND gs_inventory_vendor_eligible(s."vendorId")
      AND EXISTS (SELECT 1 FROM "StorePickupPoint" p WHERE p."storeId" = s."id" AND p."status" = 'APPROVED')
      AND EXISTS (SELECT 1 FROM "StoreOperatingHour" h WHERE h."storeId" = s."id")
      AND EXISTS (SELECT 1 FROM "StoreServiceArea" a WHERE a."storeId" = s."id" AND a."status" = 'APPROVED')
  );
$$;

-- Guards
CREATE OR REPLACE FUNCTION gs_store_pickup_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "Store"%ROWTYPE; v "Vendor"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'serviceability_write_privileged_only'; END IF;
  SELECT * INTO s FROM "Store" WHERE "id" = NEW."storeId";
  IF NOT FOUND OR s."status" <> 'ACTIVE' OR NOT gs_inventory_vendor_eligible(s."vendorId") THEN RAISE EXCEPTION 'pickup_store_not_eligible'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' OR NEW."version" <> 1 OR NEW."reviewedByUserId" IS NOT NULL OR NEW."reviewedAt" IS NOT NULL THEN RAISE EXCEPTION 'pickup_must_start_draft'; END IF;
    IF NEW."proposedByUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'pickup_actor_mismatch'; END IF;
  ELSE
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."storeId" IS DISTINCT FROM OLD."storeId" OR NEW."proposedByUserId" IS DISTINCT FROM OLD."proposedByUserId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN RAISE EXCEPTION 'pickup_immutable_fields'; END IF;
    IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'pickup_version_conflict'; END IF;
    IF NOT ((OLD."status" = 'DRAFT' AND NEW."status" IN ('DRAFT','APPROVED','REJECTED')) OR (OLD."status" = 'REJECTED' AND NEW."status" = 'DRAFT')) THEN RAISE EXCEPTION 'pickup_invalid_transition'; END IF;
    IF NEW."status" IN ('APPROVED','REJECTED') AND NEW."pickupPoint" IS DISTINCT FROM OLD."pickupPoint" THEN RAISE EXCEPTION 'pickup_review_cannot_change_geometry'; END IF;
    IF NEW."status" IN ('APPROVED','REJECTED') THEN
      IF NEW."reviewedByUserId" IS NULL OR NEW."reviewedAt" IS NULL OR NEW."reviewReason" IS NULL THEN RAISE EXCEPTION 'pickup_review_metadata_required'; END IF;
      IF NEW."reviewedByUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'pickup_actor_mismatch'; END IF;
      SELECT * INTO v FROM "Vendor" WHERE "id" = s."vendorId";
      IF NEW."reviewedByUserId" = v."ownerUserId" THEN RAISE EXCEPTION 'pickup_self_review_denied'; END IF;
    END IF;
    IF NEW."status" = 'DRAFT' AND (NEW."reviewedByUserId" IS NOT NULL OR NEW."reviewedAt" IS NOT NULL OR NEW."reviewReason" IS NOT NULL) THEN RAISE EXCEPTION 'pickup_draft_review_metadata'; END IF;
    IF OLD."status" = 'APPROVED' THEN RAISE EXCEPTION 'pickup_approved_immutable'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER store_pickup_guard BEFORE INSERT OR UPDATE ON "StorePickupPoint" FOR EACH ROW EXECUTE FUNCTION gs_store_pickup_guard();

CREATE OR REPLACE FUNCTION gs_store_operating_hour_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "Store"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'serviceability_write_privileged_only'; END IF;
  SELECT * INTO s FROM "Store" WHERE "id" = COALESCE(NEW."storeId", OLD."storeId");
  IF NOT FOUND OR s."status" <> 'ACTIVE' OR NOT gs_inventory_vendor_eligible(s."vendorId") THEN RAISE EXCEPTION 'hours_store_not_eligible'; END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN
    IF EXISTS (SELECT 1 FROM "StoreOperatingHour" h WHERE h."storeId" = NEW."storeId" AND h."dayOfWeek" = NEW."dayOfWeek" AND h."id" <> COALESCE(NEW."id", '00000000-0000-0000-0000-000000000000'::uuid) AND NEW."openMinute" < h."closeMinute" AND NEW."closeMinute" > h."openMinute") THEN
      RAISE EXCEPTION 'hours_overlap';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER store_operating_hour_guard BEFORE INSERT OR UPDATE OR DELETE ON "StoreOperatingHour" FOR EACH ROW EXECUTE FUNCTION gs_store_operating_hour_guard();

CREATE OR REPLACE FUNCTION gs_store_service_area_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "Store"%ROWTYPE; v "Vendor"%ROWTYPE; z "ServiceZone"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'serviceability_write_privileged_only'; END IF;
  SELECT * INTO s FROM "Store" WHERE "id" = NEW."storeId";
  IF NOT FOUND OR s."status" <> 'ACTIVE' OR NOT gs_inventory_vendor_eligible(s."vendorId") THEN RAISE EXCEPTION 'service_area_store_not_eligible'; END IF;
  SELECT * INTO z FROM "ServiceZone" WHERE "id" = NEW."serviceZoneId";
  IF NOT FOUND OR z."status" <> 'ACTIVE' OR z."cityId" <> s."cityId" THEN RAISE EXCEPTION 'service_area_zone_mismatch'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' OR NEW."version" <> 1 OR NEW."reviewedByUserId" IS NOT NULL OR NEW."reviewedAt" IS NOT NULL THEN RAISE EXCEPTION 'service_area_must_start_draft'; END IF;
    IF NEW."proposedByUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'service_area_actor_mismatch'; END IF;
  ELSE
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."storeId" IS DISTINCT FROM OLD."storeId" OR NEW."serviceZoneId" IS DISTINCT FROM OLD."serviceZoneId" OR NEW."proposedByUserId" IS DISTINCT FROM OLD."proposedByUserId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN RAISE EXCEPTION 'service_area_immutable_fields'; END IF;
    IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'service_area_version_conflict'; END IF;
    IF NOT ((OLD."status" = 'DRAFT' AND NEW."status" IN ('APPROVED','REJECTED')) OR (OLD."status" = 'APPROVED' AND NEW."status" = 'SUSPENDED') OR (OLD."status" = 'SUSPENDED' AND NEW."status" = 'APPROVED') OR (OLD."status" = 'REJECTED' AND NEW."status" = 'DRAFT')) THEN RAISE EXCEPTION 'service_area_invalid_transition'; END IF;
    IF NEW."status" IN ('APPROVED','REJECTED','SUSPENDED') THEN
      IF NEW."reviewedByUserId" IS NULL OR NEW."reviewedAt" IS NULL OR NEW."reviewReason" IS NULL THEN RAISE EXCEPTION 'service_area_review_metadata_required'; END IF;
      IF NEW."reviewedByUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'service_area_actor_mismatch'; END IF;
      SELECT * INTO v FROM "Vendor" WHERE "id" = s."vendorId";
      IF NEW."reviewedByUserId" = v."ownerUserId" THEN RAISE EXCEPTION 'service_area_self_review_denied'; END IF;
    END IF;
    IF NEW."status" = 'DRAFT' AND (NEW."reviewedByUserId" IS NOT NULL OR NEW."reviewedAt" IS NOT NULL OR NEW."reviewReason" IS NOT NULL) THEN RAISE EXCEPTION 'service_area_draft_review_metadata'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER store_service_area_guard BEFORE INSERT OR UPDATE ON "StoreServiceArea" FOR EACH ROW EXECUTE FUNCTION gs_store_service_area_guard();

CREATE OR REPLACE FUNCTION gs_rider_shift_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "RiderLocationConsent"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'rider_write_privileged_only'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'ACTIVE' OR NEW."endedAt" IS NOT NULL THEN RAISE EXCEPTION 'shift_must_start_active'; END IF;
    IF NOT gs_rider_kyc_eligible(NEW."riderId") THEN RAISE EXCEPTION 'rider_kyc_required'; END IF;
    SELECT * INTO c FROM "RiderLocationConsent" WHERE "riderId" = NEW."riderId";
    IF NOT FOUND OR c."consented" <> true OR c."consentVersion" <> NEW."consentVersion" THEN RAISE EXCEPTION 'rider_location_consent_required'; END IF;
  ELSE
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."riderId" IS DISTINCT FROM OLD."riderId" OR NEW."consentVersion" IS DISTINCT FROM OLD."consentVersion" OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN RAISE EXCEPTION 'shift_immutable_fields'; END IF;
    IF OLD."status" <> 'ACTIVE' OR NEW."status" <> 'ENDED' OR NEW."endedAt" IS NULL THEN RAISE EXCEPTION 'shift_invalid_transition'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rider_shift_guard BEFORE INSERT OR UPDATE ON "RiderShift" FOR EACH ROW EXECUTE FUNCTION gs_rider_shift_guard();

CREATE OR REPLACE FUNCTION gs_rider_location_sample_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "RiderShift"%ROWTYPE; c "RiderLocationConsent"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'rider_write_privileged_only'; END IF;
  SELECT * INTO s FROM "RiderShift" WHERE "id" = NEW."shiftId";
  IF NOT FOUND OR s."riderId" <> NEW."riderId" OR s."status" <> 'ACTIVE' THEN RAISE EXCEPTION 'location_shift_not_active'; END IF;
  SELECT * INTO c FROM "RiderLocationConsent" WHERE "riderId" = NEW."riderId";
  IF NOT FOUND OR c."consented" <> true OR c."consentVersion" <> s."consentVersion" THEN RAISE EXCEPTION 'rider_location_consent_required'; END IF;
  IF NOT gs_rider_kyc_eligible(NEW."riderId") THEN RAISE EXCEPTION 'rider_kyc_required'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rider_location_sample_guard BEFORE INSERT ON "RiderLocationSample" FOR EACH ROW EXECUTE FUNCTION gs_rider_location_sample_guard();
CREATE TRIGGER rider_location_sample_append_only BEFORE UPDATE OR DELETE ON "RiderLocationSample" FOR EACH ROW EXECUTE FUNCTION gs_append_only();

CREATE OR REPLACE FUNCTION gs_rider_zone_grant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "RiderProfile"%ROWTYPE; z "ServiceZone"%ROWTYPE; zcountry UUID;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'rider_write_privileged_only'; END IF;
  SELECT * INTO r FROM "RiderProfile" WHERE "id" = NEW."riderId";
  IF NOT FOUND THEN RAISE EXCEPTION 'rider_not_found'; END IF;
  SELECT * INTO z FROM "ServiceZone" WHERE "id" = NEW."serviceZoneId";
  IF NOT FOUND OR z."status" <> 'ACTIVE' THEN RAISE EXCEPTION 'zone_not_active'; END IF;
  SELECT r2."countryId" INTO zcountry FROM "City" c JOIN "District" d ON d."id"=c."districtId" JOIN "Region" r2 ON r2."id"=d."regionId" WHERE c."id" = z."cityId";
  IF zcountry <> r."countryId" THEN RAISE EXCEPTION 'rider_zone_country_mismatch'; END IF;
  IF NEW."grantedBy" = r."userId" THEN RAISE EXCEPTION 'rider_self_grant_denied'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."revokedAt" IS NOT NULL THEN RAISE EXCEPTION 'zone_grant_must_start_unrevoked'; END IF;
    IF NEW."expiresAt" IS NOT NULL AND NEW."expiresAt" <= CURRENT_TIMESTAMP THEN RAISE EXCEPTION 'zone_grant_expiry_must_be_future'; END IF;
    IF NEW."grantedBy" <> gs_current_user_id() THEN RAISE EXCEPTION 'zone_grant_actor_mismatch'; END IF;
  ELSE
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."riderId" IS DISTINCT FROM OLD."riderId" OR NEW."serviceZoneId" IS DISTINCT FROM OLD."serviceZoneId" OR NEW."grantedBy" IS DISTINCT FROM OLD."grantedBy" OR NEW."reason" IS DISTINCT FROM OLD."reason" OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN RAISE EXCEPTION 'zone_grant_immutable_fields'; END IF;
    IF OLD."revokedAt" IS NOT NULL OR NEW."revokedAt" IS NULL THEN RAISE EXCEPTION 'zone_grant_invalid_update'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rider_zone_grant_guard BEFORE INSERT OR UPDATE ON "RiderZoneGrant" FOR EACH ROW EXECUTE FUNCTION gs_rider_zone_grant_guard();

-- RLS
ALTER TABLE "StorePickupPoint" ENABLE ROW LEVEL SECURITY; ALTER TABLE "StorePickupPoint" FORCE ROW LEVEL SECURITY;
CREATE POLICY store_pickup_select_member_or_super ON "StorePickupPoint" FOR SELECT USING (
  gs_is_super() OR EXISTS (SELECT 1 FROM "Store" s JOIN "VendorMembership" m ON m."vendorId"=s."vendorId" WHERE s."id"="StorePickupPoint"."storeId" AND m."userId"=gs_current_user_id() AND m."revokedAt" IS NULL AND (m."expiresAt" IS NULL OR m."expiresAt">CURRENT_TIMESTAMP) AND (m."storeId" IS NULL OR m."storeId"=s."id"))
);
CREATE POLICY store_pickup_insert_super ON "StorePickupPoint" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY store_pickup_update_super ON "StorePickupPoint" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

ALTER TABLE "StoreOperatingHour" ENABLE ROW LEVEL SECURITY; ALTER TABLE "StoreOperatingHour" FORCE ROW LEVEL SECURITY;
CREATE POLICY store_hours_select_member_or_super ON "StoreOperatingHour" FOR SELECT USING (
  gs_is_super() OR EXISTS (SELECT 1 FROM "Store" s JOIN "VendorMembership" m ON m."vendorId"=s."vendorId" WHERE s."id"="StoreOperatingHour"."storeId" AND m."userId"=gs_current_user_id() AND m."revokedAt" IS NULL AND (m."expiresAt" IS NULL OR m."expiresAt">CURRENT_TIMESTAMP) AND (m."storeId" IS NULL OR m."storeId"=s."id"))
);
CREATE POLICY store_hours_insert_super ON "StoreOperatingHour" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY store_hours_update_super ON "StoreOperatingHour" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());
CREATE POLICY store_hours_delete_super ON "StoreOperatingHour" FOR DELETE USING (gs_is_super());

ALTER TABLE "StoreServiceArea" ENABLE ROW LEVEL SECURITY; ALTER TABLE "StoreServiceArea" FORCE ROW LEVEL SECURITY;
CREATE POLICY store_service_area_select_member_or_super ON "StoreServiceArea" FOR SELECT USING (
  gs_is_super() OR EXISTS (SELECT 1 FROM "Store" s JOIN "VendorMembership" m ON m."vendorId"=s."vendorId" WHERE s."id"="StoreServiceArea"."storeId" AND m."userId"=gs_current_user_id() AND m."revokedAt" IS NULL AND (m."expiresAt" IS NULL OR m."expiresAt">CURRENT_TIMESTAMP) AND (m."storeId" IS NULL OR m."storeId"=s."id"))
);
CREATE POLICY store_service_area_insert_super ON "StoreServiceArea" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY store_service_area_update_super ON "StoreServiceArea" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

ALTER TABLE "RiderShift" ENABLE ROW LEVEL SECURITY; ALTER TABLE "RiderShift" FORCE ROW LEVEL SECURITY;
CREATE POLICY rider_shift_select_self_or_super ON "RiderShift" FOR SELECT USING (gs_is_super() OR EXISTS (SELECT 1 FROM "RiderProfile" r WHERE r."id"="RiderShift"."riderId" AND r."userId"=gs_current_user_id()));
CREATE POLICY rider_shift_insert_super ON "RiderShift" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY rider_shift_update_super ON "RiderShift" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

ALTER TABLE "RiderLocationConsent" ENABLE ROW LEVEL SECURITY; ALTER TABLE "RiderLocationConsent" FORCE ROW LEVEL SECURITY;
CREATE POLICY rider_consent_select_self_or_super ON "RiderLocationConsent" FOR SELECT USING (gs_is_super() OR EXISTS (SELECT 1 FROM "RiderProfile" r WHERE r."id"="RiderLocationConsent"."riderId" AND r."userId"=gs_current_user_id()));
CREATE POLICY rider_consent_insert_super ON "RiderLocationConsent" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY rider_consent_update_super ON "RiderLocationConsent" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

ALTER TABLE "RiderLocationSample" ENABLE ROW LEVEL SECURITY; ALTER TABLE "RiderLocationSample" FORCE ROW LEVEL SECURITY;
CREATE POLICY rider_location_select_self_or_super ON "RiderLocationSample" FOR SELECT USING (gs_is_super() OR EXISTS (SELECT 1 FROM "RiderProfile" r WHERE r."id"="RiderLocationSample"."riderId" AND r."userId"=gs_current_user_id()));
CREATE POLICY rider_location_insert_super ON "RiderLocationSample" FOR INSERT WITH CHECK (gs_is_super());

ALTER TABLE "RiderZoneGrant" ENABLE ROW LEVEL SECURITY; ALTER TABLE "RiderZoneGrant" FORCE ROW LEVEL SECURITY;
CREATE POLICY rider_zone_grant_select_self_or_super ON "RiderZoneGrant" FOR SELECT USING (gs_is_super() OR EXISTS (SELECT 1 FROM "RiderProfile" r WHERE r."id"="RiderZoneGrant"."riderId" AND r."userId"=gs_current_user_id()));
CREATE POLICY rider_zone_grant_insert_super ON "RiderZoneGrant" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY rider_zone_grant_update_super ON "RiderZoneGrant" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

COMMENT ON TABLE "StorePickupPoint" IS 'Vendor-proposed store pickup geometry; independent privileged approval required before dispatch serviceability.';
COMMENT ON TABLE "StoreOperatingHour" IS 'Store-local weekly operating windows; no overnight windows in this foundation.';
COMMENT ON TABLE "StoreServiceArea" IS 'Store-to-service-zone coverage proposal; independent privileged approval required.';
COMMENT ON TABLE "RiderShift" IS 'Consented active rider shift; one active shift per rider.';
COMMENT ON TABLE "RiderLocationConsent" IS 'Explicit rider location consent version; withdrawal blocks new samples/shifts.';
COMMENT ON TABLE "RiderLocationSample" IS 'Append-only active-shift GPS samples; retention automation pending.';
COMMENT ON TABLE "RiderZoneGrant" IS 'Privileged rider zone permission; optional expiry and immutable revocation.';
