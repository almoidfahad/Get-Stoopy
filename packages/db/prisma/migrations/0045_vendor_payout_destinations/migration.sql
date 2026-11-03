-- Encrypted vendor payout destinations. Verification never enables a money transfer.
CREATE TABLE "PayoutDestination" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "vendorId" UUID NOT NULL REFERENCES "Vendor"(id),
  "countryId" UUID NOT NULL REFERENCES "Country"(id), currency VARCHAR(3) NOT NULL,
  rail "PayoutRail" NOT NULL, "detailsEnvelope" BYTEA NOT NULL, "encryptionKeyId" VARCHAR(120) NOT NULL,
  fingerprint VARCHAR(64) NOT NULL, "displayMask" VARCHAR(20) NOT NULL,
  "proofStorageObjectId" UUID NOT NULL UNIQUE REFERENCES "StorageObject"(id),
  status "PayoutDestinationStatus" NOT NULL DEFAULT 'PENDING_REVIEW', version INTEGER NOT NULL DEFAULT 1,
  "commandKey" VARCHAR(128) NOT NULL, "payloadHash" VARCHAR(64) NOT NULL,
  "submittedByUserId" UUID NOT NULL REFERENCES "User"(id), "reviewedByUserId" UUID REFERENCES "User"(id),
  "verificationReference" VARCHAR(128), "reviewReason" VARCHAR(512),
  "verifiedAt" TIMESTAMP(3), "eligibleAt" TIMESTAMP(3), "reviewedAt" TIMESTAMP(3), "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("vendorId","commandKey"), CHECK (version >= 1), CHECK (currency ~ '^[A-Z]{3}$'),
  CHECK (fingerprint ~ '^[0-9a-f]{64}$' AND "payloadHash" ~ '^[0-9a-f]{64}$'),
  CHECK (octet_length("detailsEnvelope") BETWEEN 64 AND 4096),
  CHECK ((status='VERIFIED' AND "verifiedAt" IS NOT NULL AND "eligibleAt" > "verifiedAt" AND "reviewedByUserId" IS NOT NULL)
      OR (status='RETIRED' AND "verifiedAt" IS NOT NULL AND "eligibleAt" IS NULL)
      OR (status IN ('PENDING_REVIEW','REJECTED') AND "verifiedAt" IS NULL AND "eligibleAt" IS NULL)),
  CHECK (status NOT IN ('VERIFIED','REJECTED') OR ("reviewedAt" IS NOT NULL AND "reviewedByUserId" IS NOT NULL AND "verificationReference" IS NOT NULL AND "reviewReason" IS NOT NULL)),
  CHECK (status <> 'RETIRED' OR ("retiredAt" IS NOT NULL AND "reviewedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX payout_destination_one_verified ON "PayoutDestination"("vendorId",currency) WHERE status='VERIFIED';
CREATE UNIQUE INDEX payout_destination_no_duplicate_active ON "PayoutDestination"("vendorId",currency,rail,fingerprint) WHERE status IN ('PENDING_REVIEW','VERIFIED');
CREATE INDEX "PayoutDestination_countryId_status_createdAt_idx" ON "PayoutDestination"("countryId",status,"createdAt");
CREATE TABLE "PayoutDestinationReview" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "destinationId" UUID NOT NULL REFERENCES "PayoutDestination"(id),
  "fromStatus" "PayoutDestinationStatus" NOT NULL, "toStatus" "PayoutDestinationStatus" NOT NULL,
  "destinationVersion" INTEGER NOT NULL, decision "PayoutDestinationDecision" NOT NULL,
  "actorUserId" UUID NOT NULL REFERENCES "User"(id), "commandKey" VARCHAR(128) NOT NULL, "payloadHash" VARCHAR(64) NOT NULL,
  reason VARCHAR(512) NOT NULL, "verificationReference" VARCHAR(128), "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("destinationId","commandKey"), UNIQUE ("destinationId","destinationVersion")
);
CREATE OR REPLACE FUNCTION gs_payout_destination_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v "Vendor"%ROWTYPE; c "Country"%ROWTYPE; proof "StorageObject"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'payout_destination_write_privileged_only'; END IF;
  SELECT * INTO v FROM "Vendor" WHERE id=NEW."vendorId";
  SELECT * INTO c FROM "Country" WHERE id=NEW."countryId";
  IF NOT FOUND OR v."countryId" <> NEW."countryId" OR c.currency <> NEW.currency OR NOT gs_inventory_vendor_eligible(NEW."vendorId") THEN RAISE EXCEPTION 'payout_destination_vendor_ineligible'; END IF;
  IF v."ownerUserId" <> NEW."submittedByUserId" OR NEW."submittedByUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'payout_destination_owner_required'; END IF;
  SELECT * INTO proof FROM "StorageObject" WHERE id=NEW."proofStorageObjectId";
  IF NOT FOUND OR proof."ownerUserId" <> v."ownerUserId" OR proof.purpose <> 'payout-destination-proof' OR proof.state <> 'UPLOADED' OR NOT proof."magicValid" OR proof."deletedAt" IS NOT NULL THEN RAISE EXCEPTION 'payout_destination_proof_required'; END IF;
  IF NEW.status <> 'PENDING_REVIEW' OR NEW.version <> 1 OR NEW."reviewedByUserId" IS NOT NULL OR NEW."reviewedAt" IS NOT NULL THEN RAISE EXCEPTION 'payout_destination_initial_state'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER payout_destination_insert_guard BEFORE INSERT ON "PayoutDestination" FOR EACH ROW EXECUTE FUNCTION gs_payout_destination_insert_guard();
CREATE OR REPLACE FUNCTION gs_payout_destination_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'payout_destination_write_privileged_only'; END IF;
  IF NEW.id <> OLD.id OR NEW."vendorId" <> OLD."vendorId" OR NEW."countryId" <> OLD."countryId" OR NEW.currency <> OLD.currency OR NEW.rail <> OLD.rail
    OR NEW."detailsEnvelope" <> OLD."detailsEnvelope" OR NEW."encryptionKeyId" <> OLD."encryptionKeyId" OR NEW.fingerprint <> OLD.fingerprint OR NEW."displayMask" <> OLD."displayMask"
    OR NEW."proofStorageObjectId" <> OLD."proofStorageObjectId" OR NEW."commandKey" <> OLD."commandKey" OR NEW."payloadHash" <> OLD."payloadHash"
    OR NEW."submittedByUserId" <> OLD."submittedByUserId" OR NEW."createdAt" <> OLD."createdAt" OR NEW.version <> OLD.version+1 THEN
    RAISE EXCEPTION 'payout_destination_immutable_or_version';
  END IF;
  IF NOT ((OLD.status='PENDING_REVIEW' AND NEW.status IN ('VERIFIED','REJECTED')) OR (OLD.status='VERIFIED' AND NEW.status='RETIRED')) THEN RAISE EXCEPTION 'payout_destination_invalid_transition'; END IF;
  IF OLD.status='PENDING_REVIEW' THEN
    IF NEW."reviewedByUserId" IS NULL OR NEW."reviewedByUserId"=OLD."submittedByUserId" OR NEW."reviewedByUserId"<>gs_current_user_id() OR NEW."verificationReference" IS NULL OR NEW."reviewReason" IS NULL OR NEW."reviewedAt" IS NULL THEN RAISE EXCEPTION 'payout_destination_independent_review_required'; END IF;
    IF NEW.status='VERIFIED' AND (NEW."verifiedAt" IS NULL OR NEW."eligibleAt" IS NULL OR NEW."eligibleAt"<=NEW."verifiedAt") THEN RAISE EXCEPTION 'payout_destination_cooldown_required'; END IF;
  ELSE
    IF NEW."verifiedAt" IS DISTINCT FROM OLD."verifiedAt" OR NEW."eligibleAt" IS NOT NULL OR NEW."reviewedAt" IS NULL OR NEW."retiredAt" IS NULL OR NEW."reviewedByUserId"<>gs_current_user_id() THEN RAISE EXCEPTION 'payout_destination_retirement_invalid'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER payout_destination_update_guard BEFORE UPDATE ON "PayoutDestination" FOR EACH ROW EXECUTE FUNCTION gs_payout_destination_update_guard();
CREATE OR REPLACE FUNCTION gs_payout_destination_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d "PayoutDestination"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'payout_destination_write_privileged_only'; END IF;
  SELECT * INTO d FROM "PayoutDestination" WHERE id=NEW."destinationId";
  IF NOT FOUND OR d.version<>NEW."destinationVersion" OR d.status<>NEW."toStatus" OR NEW."actorUserId"<>gs_current_user_id() OR NEW."actorUserId"<>d."reviewedByUserId" THEN RAISE EXCEPTION 'payout_destination_review_mismatch'; END IF;
  IF NOT ((NEW.decision='VERIFY' AND NEW."fromStatus"='PENDING_REVIEW' AND NEW."toStatus"='VERIFIED' AND NEW."verificationReference" IS NOT NULL)
       OR (NEW.decision='REJECT' AND NEW."fromStatus"='PENDING_REVIEW' AND NEW."toStatus"='REJECTED' AND NEW."verificationReference" IS NOT NULL)
       OR (NEW.decision='RETIRE' AND NEW."fromStatus"='VERIFIED' AND NEW."toStatus"='RETIRED')) THEN RAISE EXCEPTION 'payout_destination_review_transition'; END IF;
  IF NEW.decision<>'RETIRE' AND NEW."actorUserId"=d."submittedByUserId" THEN RAISE EXCEPTION 'payout_destination_self_review'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER payout_destination_review_guard BEFORE INSERT ON "PayoutDestinationReview" FOR EACH ROW EXECUTE FUNCTION gs_payout_destination_review_guard();
CREATE TRIGGER payout_destination_review_append_only BEFORE UPDATE OR DELETE ON "PayoutDestinationReview" FOR EACH ROW EXECUTE FUNCTION gs_append_only();
CREATE TRIGGER payout_destination_no_delete BEFORE DELETE ON "PayoutDestination" FOR EACH ROW EXECUTE FUNCTION gs_append_only();
CREATE OR REPLACE FUNCTION gs_payout_destination_review_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "PayoutDestinationReview" r WHERE r."destinationId"=NEW.id AND r."destinationVersion"=NEW.version AND r."toStatus"=NEW.status) THEN RAISE EXCEPTION 'payout_destination_review_required'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER payout_destination_review_required AFTER UPDATE ON "PayoutDestination" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_payout_destination_review_required();
ALTER TABLE "PayoutDestination" ENABLE ROW LEVEL SECURITY; ALTER TABLE "PayoutDestination" FORCE ROW LEVEL SECURITY;
CREATE POLICY payout_destination_owner_or_super ON "PayoutDestination" FOR SELECT USING (gs_is_super() OR EXISTS (SELECT 1 FROM "Vendor" v WHERE v.id="vendorId" AND v."ownerUserId"=gs_current_user_id()));
CREATE POLICY payout_destination_super_insert ON "PayoutDestination" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY payout_destination_super_update ON "PayoutDestination" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());
ALTER TABLE "PayoutDestinationReview" ENABLE ROW LEVEL SECURITY; ALTER TABLE "PayoutDestinationReview" FORCE ROW LEVEL SECURITY;
CREATE POLICY payout_destination_review_owner_or_super ON "PayoutDestinationReview" FOR SELECT USING (gs_is_super() OR EXISTS (SELECT 1 FROM "PayoutDestination" d JOIN "Vendor" v ON v.id=d."vendorId" WHERE d.id="destinationId" AND v."ownerUserId"=gs_current_user_id()));
CREATE POLICY payout_destination_review_super_insert ON "PayoutDestinationReview" FOR INSERT WITH CHECK (gs_is_super());
-- Protect the new sensitive proof purpose from runtime self-approval just like KYC documents.
CREATE OR REPLACE FUNCTION gs_guard_storage_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF gs_is_super() THEN RETURN NEW; END IF;
  IF NEW."reviewedByUserId" IS DISTINCT FROM OLD."reviewedByUserId" OR NEW."reviewedAt" IS DISTINCT FROM OLD."reviewedAt" OR NEW."reviewReason" IS DISTINCT FROM OLD."reviewReason" THEN RAISE EXCEPTION 'storage_review_fields_privileged_only'; END IF;
  IF OLD.purpose IN ('kyc-document','payout-destination-proof') AND NEW.state='UPLOADED' THEN RAISE EXCEPTION 'storage_sensitive_approval_privileged_only'; END IF;
  IF OLD.state='QUARANTINED' AND NEW.state IS DISTINCT FROM OLD.state THEN RAISE EXCEPTION 'storage_quarantine_transition_privileged_only'; END IF;
  RETURN NEW;
END; $$;
