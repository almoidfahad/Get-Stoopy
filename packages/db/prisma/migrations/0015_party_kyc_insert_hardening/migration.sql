-- Defense-in-depth insert hardening for party activation evidence.
-- Additive guards only; no existing rows are rewritten.
-- KYC cases must start as DRAFT; APPROVED rows cannot be inserted directly to bypass review.
CREATE OR REPLACE FUNCTION gs_kyc_case_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'kyc_write_privileged_only'; END IF;
  IF NEW."status" <> 'DRAFT' OR NEW."version" <> 1 OR NEW."submittedAt" IS NOT NULL OR NEW."reviewedAt" IS NOT NULL OR NEW."expiresAt" IS NOT NULL THEN
    RAISE EXCEPTION 'kyc_case_must_start_draft';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER kyc_case_insert_guard BEFORE INSERT ON "KycCase"
  FOR EACH ROW EXECUTE FUNCTION gs_kyc_case_insert_guard();

-- Vendor membership inserts must be unrevoked, and the OWNER membership must belong to the vendor owner.
CREATE OR REPLACE FUNCTION gs_vendor_membership_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id UUID;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'party_write_privileged_only'; END IF;
  IF NEW."revokedAt" IS NOT NULL THEN RAISE EXCEPTION 'membership_must_start_unrevoked'; END IF;
  IF NEW."expiresAt" IS NOT NULL AND NEW."expiresAt" <= CURRENT_TIMESTAMP THEN RAISE EXCEPTION 'membership_expiry_must_be_future'; END IF;
  SELECT "ownerUserId" INTO owner_id FROM "Vendor" WHERE "id" = NEW."vendorId";
  IF NOT FOUND THEN RAISE EXCEPTION 'membership_vendor_not_found'; END IF;
  IF NEW."role" = 'OWNER' AND NEW."userId" <> owner_id THEN RAISE EXCEPTION 'membership_owner_mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vendor_membership_insert_guard BEFORE INSERT ON "VendorMembership"
  FOR EACH ROW EXECUTE FUNCTION gs_vendor_membership_insert_guard();
CREATE UNIQUE INDEX "VendorMembership_one_owner" ON "VendorMembership"("vendorId") WHERE "role" = 'OWNER';

COMMENT ON FUNCTION gs_kyc_case_insert_guard() IS 'KYC cases must be inserted as DRAFT; approval requires the reviewed update path.';
COMMENT ON FUNCTION gs_vendor_membership_insert_guard() IS 'Memberships start unrevoked; OWNER membership must match the vendor owner.';
