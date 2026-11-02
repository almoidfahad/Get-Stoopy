-- Harden KYC approval so the database, not only the API service, requires an append-only
-- human review row and ready/unexpired evidence before a case can become APPROVED.
-- Additive function replacement; no existing rows are rewritten.
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

  -- Reviewer transitions must be preceded by an append-only KycReview row in the same transaction.
  IF NEW."status" IN ('UNDER_REVIEW','APPROVED','REJECTED','MORE_INFORMATION','REVOKED') THEN
    IF NOT EXISTS (
      SELECT 1 FROM "KycReview" r
      WHERE r."caseId" = NEW."id" AND r."fromStatus" = OLD."status" AND r."toStatus" = NEW."status"
    ) THEN
      RAISE EXCEPTION 'kyc_review_required';
    END IF;
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
    IF EXISTS (
      SELECT 1 FROM "KycDocument" d
      JOIN "StorageObject" s ON s."id" = d."storageObjectId"
      WHERE d."caseId" = NEW."id"
        AND (
          (d."expiresAt" IS NOT NULL AND d."expiresAt" <= CURRENT_TIMESTAMP)
          OR s."state" <> 'UPLOADED'
          OR s."deletedAt" IS NOT NULL
          OR s."magicValid" IS DISTINCT FROM true
          OR s."sha256" IS NULL
          OR d."contentHash" <> s."sha256"
        )
    ) THEN
      RAISE EXCEPTION 'kyc_approval_evidence_not_ready';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Linked KYC evidence is locked against silent deletion/downgrade/identity changes.
-- A future retention/legal-hold workflow must use a reviewed privileged process, not ad-hoc updates.
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
       OR NEW."contentType" IS DISTINCT FROM OLD."contentType"
       OR NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes"
       OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
       OR NEW."encryptionKeyId" IS DISTINCT FROM OLD."encryptionKeyId"
       OR NEW."magicValid" IS DISTINCT FROM OLD."magicValid"
       OR NEW."deletedAt" IS DISTINCT FROM OLD."deletedAt" THEN
      RAISE EXCEPTION 'kyc_linked_storage_immutable';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
