-- Vendor/rider party profiles, vendor membership and KYC-gated activation foundation.
-- Additive only; no existing rows are rewritten. This is not catalog, checkout, dispatch or payout.
CREATE TYPE "PartyStatus" AS ENUM ('DRAFT','ACTIVE','SUSPENDED');
CREATE TYPE "VendorMembershipRole" AS ENUM ('OWNER','MANAGER','STAFF');
CREATE TYPE "RiderVehicleType" AS ENUM ('BICYCLE','MOTORBIKE','CAR','OTHER');

CREATE TABLE "Vendor" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ownerUserId" UUID NOT NULL,
  "countryId" UUID NOT NULL,
  "displayName" VARCHAR(120) NOT NULL,
  "legalName" VARCHAR(200),
  "status" "PartyStatus" NOT NULL DEFAULT 'DRAFT',
  "kycCaseId" UUID,
  "activatedAt" TIMESTAMP(3),
  "activatedByUserId" UUID,
  "suspendedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Vendor_ownerUserId_countryId_key" UNIQUE ("ownerUserId","countryId"),
  CONSTRAINT "Vendor_kycCaseId_key" UNIQUE ("kycCaseId"),
  CONSTRAINT "Vendor_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "Vendor_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Vendor_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Vendor_kycCaseId_fkey" FOREIGN KEY ("kycCaseId") REFERENCES "KycCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Vendor_activatedByUserId_fkey" FOREIGN KEY ("activatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Vendor_countryId_status_idx" ON "Vendor"("countryId","status");

CREATE TABLE "VendorMembership" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "vendorId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "role" "VendorMembershipRole" NOT NULL,
  "grantedBy" UUID NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VendorMembership_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VendorMembership_vendorId_userId_key" UNIQUE ("vendorId","userId"),
  CONSTRAINT "VendorMembership_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "VendorMembership_userId_revokedAt_idx" ON "VendorMembership"("userId","revokedAt");

CREATE TABLE "RiderProfile" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "countryId" UUID NOT NULL,
  "vehicleType" "RiderVehicleType" NOT NULL,
  "status" "PartyStatus" NOT NULL DEFAULT 'DRAFT',
  "kycCaseId" UUID,
  "activatedAt" TIMESTAMP(3),
  "activatedByUserId" UUID,
  "suspendedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RiderProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RiderProfile_userId_key" UNIQUE ("userId"),
  CONSTRAINT "RiderProfile_kycCaseId_key" UNIQUE ("kycCaseId"),
  CONSTRAINT "RiderProfile_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "RiderProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RiderProfile_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RiderProfile_kycCaseId_fkey" FOREIGN KEY ("kycCaseId") REFERENCES "KycCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RiderProfile_activatedByUserId_fkey" FOREIGN KEY ("activatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "RiderProfile_countryId_status_idx" ON "RiderProfile"("countryId","status");

-- Draft profiles cannot carry activation metadata.
CREATE OR REPLACE FUNCTION gs_party_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'party_write_privileged_only'; END IF;
  IF NEW."status" <> 'DRAFT' OR NEW."kycCaseId" IS NOT NULL OR NEW."activatedAt" IS NOT NULL OR NEW."activatedByUserId" IS NOT NULL OR NEW."suspendedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'party_must_start_draft';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vendor_insert_guard BEFORE INSERT ON "Vendor" FOR EACH ROW EXECUTE FUNCTION gs_party_insert_guard();
CREATE TRIGGER rider_insert_guard BEFORE INSERT ON "RiderProfile" FOR EACH ROW EXECUTE FUNCTION gs_party_insert_guard();

-- Activation is privileged, non-self, versioned and requires an unexpired approved KYC case
-- for the same subject user, subject type and country. Suspension does not delete history.
CREATE OR REPLACE FUNCTION gs_vendor_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k "KycCase"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'party_write_privileged_only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."ownerUserId" IS DISTINCT FROM OLD."ownerUserId" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'party_immutable_fields';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'party_version_conflict'; END IF;
  IF NOT ((OLD."status" = 'DRAFT' AND NEW."status" = 'ACTIVE') OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'SUSPENDED') OR (OLD."status" = 'SUSPENDED' AND NEW."status" = 'ACTIVE')) THEN
    RAISE EXCEPTION 'party_invalid_transition';
  END IF;
  IF NEW."status" = 'ACTIVE' THEN
    IF NEW."kycCaseId" IS NULL OR NEW."activatedAt" IS NULL OR NEW."activatedByUserId" IS NULL THEN RAISE EXCEPTION 'party_activation_metadata_required'; END IF;
    IF NEW."activatedByUserId" = NEW."ownerUserId" THEN RAISE EXCEPTION 'party_self_activation_denied'; END IF;
    SELECT * INTO k FROM "KycCase" WHERE "id" = NEW."kycCaseId";
    IF NOT FOUND OR k."subjectUserId" <> NEW."ownerUserId" OR k."subjectType" <> 'VENDOR' OR k."countryId" <> NEW."countryId" OR k."status" <> 'APPROVED' OR k."expiresAt" IS NULL OR k."expiresAt" <= CURRENT_TIMESTAMP THEN
      RAISE EXCEPTION 'party_kyc_approval_required';
    END IF;
  END IF;
  IF NEW."status" = 'SUSPENDED' AND NEW."suspendedAt" IS NULL THEN RAISE EXCEPTION 'party_suspendedAt_required'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vendor_activation_guard BEFORE UPDATE ON "Vendor" FOR EACH ROW EXECUTE FUNCTION gs_vendor_activation_guard();

CREATE OR REPLACE FUNCTION gs_rider_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k "KycCase"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'party_write_privileged_only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'party_immutable_fields';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'party_version_conflict'; END IF;
  IF NOT ((OLD."status" = 'DRAFT' AND NEW."status" = 'ACTIVE') OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'SUSPENDED') OR (OLD."status" = 'SUSPENDED' AND NEW."status" = 'ACTIVE')) THEN
    RAISE EXCEPTION 'party_invalid_transition';
  END IF;
  IF NEW."status" = 'ACTIVE' THEN
    IF NEW."kycCaseId" IS NULL OR NEW."activatedAt" IS NULL OR NEW."activatedByUserId" IS NULL THEN RAISE EXCEPTION 'party_activation_metadata_required'; END IF;
    IF NEW."activatedByUserId" = NEW."userId" THEN RAISE EXCEPTION 'party_self_activation_denied'; END IF;
    SELECT * INTO k FROM "KycCase" WHERE "id" = NEW."kycCaseId";
    IF NOT FOUND OR k."subjectUserId" <> NEW."userId" OR k."subjectType" <> 'RIDER' OR k."countryId" <> NEW."countryId" OR k."status" <> 'APPROVED' OR k."expiresAt" IS NULL OR k."expiresAt" <= CURRENT_TIMESTAMP THEN
      RAISE EXCEPTION 'party_kyc_approval_required';
    END IF;
  END IF;
  IF NEW."status" = 'SUSPENDED' AND NEW."suspendedAt" IS NULL THEN RAISE EXCEPTION 'party_suspendedAt_required'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rider_activation_guard BEFORE UPDATE ON "RiderProfile" FOR EACH ROW EXECUTE FUNCTION gs_rider_activation_guard();

-- Membership rows are privileged-write. Owner membership is created with the vendor draft.
-- Role/subject/vendor identity is immutable; revocation/expiry is allowed.
CREATE OR REPLACE FUNCTION gs_vendor_membership_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'party_write_privileged_only'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."vendorId" IS DISTINCT FROM OLD."vendorId" OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."role" IS DISTINCT FROM OLD."role" OR NEW."grantedBy" IS DISTINCT FROM OLD."grantedBy" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
      RAISE EXCEPTION 'membership_immutable_fields';
    END IF;
    IF OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" THEN
      RAISE EXCEPTION 'membership_revocation_immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vendor_membership_guard BEFORE INSERT OR UPDATE ON "VendorMembership" FOR EACH ROW EXECUTE FUNCTION gs_vendor_membership_guard();

ALTER TABLE "Vendor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Vendor" FORCE ROW LEVEL SECURITY;
ALTER TABLE "VendorMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VendorMembership" FORCE ROW LEVEL SECURITY;
ALTER TABLE "RiderProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RiderProfile" FORCE ROW LEVEL SECURITY;

CREATE POLICY vendor_select_owner_member_or_super ON "Vendor" FOR SELECT
  USING ("ownerUserId" = gs_current_user_id() OR gs_is_super() OR EXISTS (
    SELECT 1 FROM "VendorMembership" m WHERE m."vendorId" = "id" AND m."userId" = gs_current_user_id() AND m."revokedAt" IS NULL AND (m."expiresAt" IS NULL OR m."expiresAt" > CURRENT_TIMESTAMP)
  ));
CREATE POLICY vendor_insert_super ON "Vendor" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY vendor_update_super ON "Vendor" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

CREATE POLICY membership_select_self_or_super ON "VendorMembership" FOR SELECT
  USING ("userId" = gs_current_user_id() OR gs_is_super());
CREATE POLICY membership_insert_super ON "VendorMembership" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY membership_update_super ON "VendorMembership" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

CREATE POLICY rider_select_self_or_super ON "RiderProfile" FOR SELECT
  USING ("userId" = gs_current_user_id() OR gs_is_super());
CREATE POLICY rider_insert_super ON "RiderProfile" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY rider_update_super ON "RiderProfile" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

COMMENT ON TABLE "Vendor" IS 'Vendor legal-party profile foundation; ACTIVE requires privileged non-self activation and unexpired approved vendor KYC.';
COMMENT ON TABLE "VendorMembership" IS 'Vendor-scoped membership; session resolution includes only ACTIVE KYC-eligible vendors and unexpired/unrevoked memberships.';
COMMENT ON TABLE "RiderProfile" IS 'Rider party profile foundation; ACTIVE requires privileged non-self activation and unexpired approved rider KYC. Shift/zone/consent gates remain pending.';
