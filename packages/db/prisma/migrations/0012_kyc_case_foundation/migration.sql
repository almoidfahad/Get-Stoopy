-- KYC case foundation. Additive only; no existing rows are rewritten.
-- This is a user-level KYC intent/case slice, not vendor/rider/admin role provisioning.
CREATE TYPE "KycSubjectType" AS ENUM ('VENDOR','RIDER','ADMIN');
CREATE TYPE "KycCaseStatus" AS ENUM ('DRAFT','SUBMITTED','UNDER_REVIEW','MORE_INFORMATION','APPROVED','REJECTED','REVOKED');
CREATE TYPE "KycDecision" AS ENUM ('START_REVIEW','APPROVE','REJECT','REQUEST_MORE_INFORMATION','REVOKE');

CREATE TABLE "KycCase" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "subjectUserId" UUID NOT NULL,
  "subjectType" "KycSubjectType" NOT NULL,
  "countryId" UUID NOT NULL,
  "status" "KycCaseStatus" NOT NULL DEFAULT 'DRAFT',
  "policyVersion" VARCHAR(64) NOT NULL,
  "consentVersion" VARCHAR(64) NOT NULL,
  "consentedAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "submittedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KycCase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KycCase_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "KycCase_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "KycCase_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "KycCase_subjectUserId_subjectType_status_idx" ON "KycCase"("subjectUserId","subjectType","status");
CREATE INDEX "KycCase_countryId_status_createdAt_idx" ON "KycCase"("countryId","status","createdAt");
-- One open case per subject/type/country. Terminal/rejected/revoked cases preserve history.
CREATE UNIQUE INDEX "KycCase_one_open_case" ON "KycCase"("subjectUserId","subjectType","countryId")
  WHERE "status" IN ('DRAFT','SUBMITTED','UNDER_REVIEW','MORE_INFORMATION');

CREATE TABLE "KycDocument" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "caseId" UUID NOT NULL,
  "storageObjectId" UUID NOT NULL,
  "documentType" VARCHAR(64) NOT NULL,
  "contentHash" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "linkedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KycDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KycDocument_storageObjectId_key" UNIQUE ("storageObjectId"),
  CONSTRAINT "KycDocument_content_hash_format" CHECK ("contentHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "KycDocument_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "KycCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "KycDocument_storageObjectId_fkey" FOREIGN KEY ("storageObjectId") REFERENCES "StorageObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "KycDocument_linkedByUserId_fkey" FOREIGN KEY ("linkedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "KycDocument_caseId_idx" ON "KycDocument"("caseId");

CREATE TABLE "KycReview" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "caseId" UUID NOT NULL,
  "reviewerUserId" UUID NOT NULL,
  "commandKey" VARCHAR(128) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "decision" "KycDecision" NOT NULL,
  "fromStatus" "KycCaseStatus" NOT NULL,
  "toStatus" "KycCaseStatus" NOT NULL,
  "reason" VARCHAR(512) NOT NULL,
  "verificationMethod" VARCHAR(64) NOT NULL DEFAULT 'MANUAL_DOCUMENT_REVIEW',
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KycReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KycReview_caseId_commandKey_key" UNIQUE ("caseId","commandKey"),
  CONSTRAINT "KycReview_payload_hash_format" CHECK ("payloadHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "KycReview_reason_length" CHECK (char_length("reason") BETWEEN 8 AND 512),
  CONSTRAINT "KycReview_manual_method_only" CHECK ("verificationMethod" = 'MANUAL_DOCUMENT_REVIEW'),
  CONSTRAINT "KycReview_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "KycCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "KycReview_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "KycReview_caseId_occurredAt_idx" ON "KycReview"("caseId","occurredAt");

-- Case transitions are explicit and optimistic-concurrency protected.
CREATE OR REPLACE FUNCTION gs_kyc_case_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed BOOLEAN;
BEGIN
  IF NOT gs_is_super() THEN
    RAISE EXCEPTION 'kyc_case_write_privileged_only';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."subjectUserId" IS DISTINCT FROM OLD."subjectUserId"
     OR NEW."subjectType" IS DISTINCT FROM OLD."subjectType"
     OR NEW."countryId" IS DISTINCT FROM OLD."countryId"
     OR NEW."policyVersion" IS DISTINCT FROM OLD."policyVersion"
     OR NEW."consentVersion" IS DISTINCT FROM OLD."consentVersion"
     OR NEW."consentedAt" IS DISTINCT FROM OLD."consentedAt"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'kyc_case_immutable_fields';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'kyc_case_version_conflict';
  END IF;
  allowed := (OLD."status" = 'DRAFT' AND NEW."status" = 'SUBMITTED')
    OR (OLD."status" = 'SUBMITTED' AND NEW."status" = 'UNDER_REVIEW')
    OR (OLD."status" = 'UNDER_REVIEW' AND NEW."status" IN ('APPROVED','REJECTED','MORE_INFORMATION'))
    OR (OLD."status" = 'MORE_INFORMATION' AND NEW."status" = 'SUBMITTED')
    OR (OLD."status" = 'APPROVED' AND NEW."status" = 'REVOKED');
  IF NOT allowed THEN
    RAISE EXCEPTION 'kyc_case_invalid_transition';
  END IF;
  IF NEW."status" = 'SUBMITTED' THEN
    IF NEW."submittedAt" IS NULL THEN RAISE EXCEPTION 'kyc_case_submittedAt_required'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "KycDocument" WHERE "caseId" = NEW."id") THEN
      RAISE EXCEPTION 'kyc_case_documents_required';
    END IF;
  END IF;
  IF NEW."status" = 'APPROVED' THEN
    IF NEW."expiresAt" IS NULL OR NEW."expiresAt" <= CURRENT_TIMESTAMP THEN
      RAISE EXCEPTION 'kyc_case_future_expiry_required';
    END IF;
    IF NEW."reviewedAt" IS NULL THEN RAISE EXCEPTION 'kyc_case_reviewedAt_required'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "KycDocument" WHERE "caseId" = NEW."id") THEN
      RAISE EXCEPTION 'kyc_case_documents_required';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER kyc_case_guard BEFORE UPDATE ON "KycCase"
  FOR EACH ROW EXECUTE FUNCTION gs_kyc_case_guard();

-- Document links are append-only snapshots of already storage-reviewed KYC objects.
CREATE OR REPLACE FUNCTION gs_kyc_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "KycCase"%ROWTYPE; s "StorageObject"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'kyc_document_write_privileged_only'; END IF;
  SELECT * INTO c FROM "KycCase" WHERE "id" = NEW."caseId";
  IF NOT FOUND THEN RAISE EXCEPTION 'kyc_case_missing'; END IF;
  IF c."status" NOT IN ('DRAFT','MORE_INFORMATION') THEN RAISE EXCEPTION 'kyc_case_not_editable'; END IF;
  IF NEW."linkedByUserId" <> c."subjectUserId" THEN RAISE EXCEPTION 'kyc_document_link_owner_only'; END IF;
  SELECT * INTO s FROM "StorageObject" WHERE "id" = NEW."storageObjectId";
  IF NOT FOUND THEN RAISE EXCEPTION 'kyc_storage_object_missing'; END IF;
  IF s."ownerUserId" <> c."subjectUserId" OR s."purpose" <> 'kyc-document'
     OR s."state" <> 'UPLOADED' OR s."magicValid" IS DISTINCT FROM true
     OR s."sha256" IS NULL OR s."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'kyc_storage_object_not_ready';
  END IF;
  IF NEW."contentHash" <> s."sha256" THEN RAISE EXCEPTION 'kyc_document_hash_mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER kyc_document_guard BEFORE INSERT ON "KycDocument"
  FOR EACH ROW EXECUTE FUNCTION gs_kyc_document_guard();
CREATE TRIGGER kyc_document_no_update_delete BEFORE UPDATE OR DELETE ON "KycDocument"
  FOR EACH ROW EXECUTE FUNCTION gs_append_only();

-- Reviews are append-only; self-review is denied at the database layer.
CREATE OR REPLACE FUNCTION gs_kyc_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject UUID; current_status "KycCaseStatus";
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'kyc_review_write_privileged_only'; END IF;
  SELECT "subjectUserId", "status" INTO subject, current_status FROM "KycCase" WHERE "id" = NEW."caseId";
  IF NOT FOUND THEN RAISE EXCEPTION 'kyc_case_missing'; END IF;
  IF subject = NEW."reviewerUserId" THEN RAISE EXCEPTION 'kyc_self_review_denied'; END IF;
  IF current_status <> NEW."fromStatus" THEN RAISE EXCEPTION 'kyc_review_from_status_conflict'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER kyc_review_guard BEFORE INSERT ON "KycReview"
  FOR EACH ROW EXECUTE FUNCTION gs_kyc_review_guard();
CREATE TRIGGER kyc_review_no_update_delete BEFORE UPDATE OR DELETE ON "KycReview"
  FOR EACH ROW EXECUTE FUNCTION gs_append_only();

-- Linked KYC evidence cannot be silently deleted or downgraded by the runtime owner.
CREATE OR REPLACE FUNCTION gs_guard_kyc_linked_storage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "KycDocument" WHERE "storageObjectId" = OLD."id") THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'kyc_linked_storage_delete_denied'; END IF;
    IF NOT gs_is_super() THEN RAISE EXCEPTION 'kyc_linked_storage_privileged_only'; END IF;
    IF NEW."state" IS DISTINCT FROM OLD."state" AND NEW."state" <> 'UPLOADED' THEN
      RAISE EXCEPTION 'kyc_linked_storage_state_locked';
    END IF;
    IF NEW."ownerUserId" IS DISTINCT FROM OLD."ownerUserId"
       OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
       OR NEW."objectKey" IS DISTINCT FROM OLD."objectKey"
       OR NEW."sha256" IS DISTINCT FROM OLD."sha256" THEN
      RAISE EXCEPTION 'kyc_linked_storage_immutable';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_kyc_linked_storage BEFORE UPDATE OR DELETE ON "StorageObject"
  FOR EACH ROW EXECUTE FUNCTION gs_guard_kyc_linked_storage();

ALTER TABLE "KycCase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KycCase" FORCE ROW LEVEL SECURITY;
ALTER TABLE "KycDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KycDocument" FORCE ROW LEVEL SECURITY;
ALTER TABLE "KycReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KycReview" FORCE ROW LEVEL SECURITY;

CREATE POLICY kyc_case_select_own_or_super ON "KycCase" FOR SELECT
  USING ("subjectUserId" = gs_current_user_id() OR gs_is_super());
CREATE POLICY kyc_case_insert_super ON "KycCase" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY kyc_case_update_super ON "KycCase" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

CREATE POLICY kyc_document_select_own_or_super ON "KycDocument" FOR SELECT
  USING (gs_is_super() OR EXISTS (SELECT 1 FROM "KycCase" c WHERE c."id" = "caseId" AND c."subjectUserId" = gs_current_user_id()));
CREATE POLICY kyc_document_insert_super ON "KycDocument" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY kyc_document_update_super ON "KycDocument" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

CREATE POLICY kyc_review_select_own_or_super ON "KycReview" FOR SELECT
  USING (gs_is_super() OR EXISTS (SELECT 1 FROM "KycCase" c WHERE c."id" = "caseId" AND c."subjectUserId" = gs_current_user_id()));
CREATE POLICY kyc_review_insert_super ON "KycReview" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY kyc_review_update_super ON "KycReview" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

COMMENT ON TABLE "KycCase" IS 'User-level KYC intent/case foundation; approval is not a role grant or permanent bypass.';
COMMENT ON TABLE "KycDocument" IS 'Append-only link to a private storage-reviewed KYC object; content hash snapshot.';
COMMENT ON TABLE "KycReview" IS 'Append-only human review decision; commandKey provides per-case idempotency.';
