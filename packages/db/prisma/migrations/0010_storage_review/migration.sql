-- Additive storage review/quarantine metadata. Existing rows are not rewritten.
ALTER TABLE "StorageObject" ADD COLUMN "magicValid" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StorageObject" ADD COLUMN "reviewedByUserId" UUID;
ALTER TABLE "StorageObject" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "StorageObject" ADD COLUMN "reviewReason" VARCHAR(512);

ALTER TABLE "StorageObject" ADD CONSTRAINT "StorageObject_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "StorageObject_state_createdAt_idx" ON "StorageObject"("state", "createdAt");

COMMENT ON COLUMN "StorageObject"."magicValid" IS 'Server-side magic-byte validation passed; this is not a malware scan.';

-- Runtime owners may complete their own upload, but may not self-approve KYC or
-- rewrite review metadata. Review transitions require the privileged role plus
-- explicit super context (set only by the API after permission + step-up checks).
CREATE OR REPLACE FUNCTION gs_guard_storage_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF gs_is_super() THEN
    RETURN NEW;
  END IF;
  IF NEW."reviewedByUserId" IS DISTINCT FROM OLD."reviewedByUserId"
     OR NEW."reviewedAt" IS DISTINCT FROM OLD."reviewedAt"
     OR NEW."reviewReason" IS DISTINCT FROM OLD."reviewReason" THEN
    RAISE EXCEPTION 'storage_review_fields_privileged_only';
  END IF;
  IF OLD."purpose" = 'kyc-document' AND NEW."state" = 'UPLOADED' THEN
    RAISE EXCEPTION 'storage_kyc_approval_privileged_only';
  END IF;
  IF OLD."state" = 'QUARANTINED' AND NEW."state" IS DISTINCT FROM OLD."state" THEN
    RAISE EXCEPTION 'storage_quarantine_transition_privileged_only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER storage_guard_review BEFORE UPDATE ON "StorageObject"
  FOR EACH ROW EXECUTE FUNCTION gs_guard_storage_review();
