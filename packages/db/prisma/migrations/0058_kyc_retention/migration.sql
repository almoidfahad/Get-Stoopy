CREATE TABLE "KycRetentionPolicy" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "countryId" UUID NOT NULL REFERENCES "Country"(id), "subjectType" "KycSubjectType" NOT NULL,
 "approvedRetentionDays" INTEGER NOT NULL CHECK("approvedRetentionDays" BETWEEN 1 AND 3650), "rejectedRetentionDays" INTEGER NOT NULL CHECK("rejectedRetentionDays" BETWEEN 1 AND 3650), "revokedRetentionDays" INTEGER NOT NULL CHECK("revokedRetentionDays" BETWEEN 1 AND 3650), "reminderDays" INTEGER NOT NULL CHECK("reminderDays" BETWEEN 1 AND 90),
 "legalBasis" VARCHAR(512) NOT NULL, "policyVersion" VARCHAR(64) NOT NULL, active BOOLEAN NOT NULL DEFAULT true,
 "createdByUserId" UUID NOT NULL REFERENCES "User"(id), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("countryId","subjectType","policyVersion")
);
CREATE UNIQUE INDEX kyc_retention_one_active ON "KycRetentionPolicy"("countryId","subjectType") WHERE active;
CREATE TABLE "KycLegalHold" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "caseId" UUID NOT NULL REFERENCES "KycCase"(id), "countryId" UUID NOT NULL REFERENCES "Country"(id),
 reason VARCHAR(512) NOT NULL, "evidenceHash" VARCHAR(64) NOT NULL, "placedByUserId" UUID NOT NULL REFERENCES "User"(id), "releasedByUserId" UUID REFERENCES "User"(id), "releaseReason" VARCHAR(512), "releasedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX kyc_one_active_hold ON "KycLegalHold"("caseId") WHERE "releasedAt" IS NULL;
CREATE TABLE "KycDeletionRequest" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "caseId" UUID NOT NULL UNIQUE REFERENCES "KycCase"(id), "countryId" UUID NOT NULL REFERENCES "Country"(id),
 status "KycDeletionStatus" NOT NULL DEFAULT 'PENDING_REVIEW', version INTEGER NOT NULL DEFAULT 1, "dueAt" TIMESTAMP(3) NOT NULL,
 reason VARCHAR(512) NOT NULL, "commandKey" VARCHAR(128) NOT NULL UNIQUE, "payloadHash" VARCHAR(64) NOT NULL,
 "requestedByUserId" UUID NOT NULL REFERENCES "User"(id), "reviewedByUserId" UUID REFERENCES "User"(id), "reviewCommandKey" VARCHAR(128), "reviewPayloadHash" VARCHAR(64), "reviewReason" VARCHAR(512), "reviewedAt" TIMESTAMP(3), "purgedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "KycRetentionEvent" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "caseId" UUID NOT NULL REFERENCES "KycCase"(id), "countryId" UUID NOT NULL REFERENCES "Country"(id), kind "KycRetentionEventType" NOT NULL,
 "caseVersion" INTEGER NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("caseId",kind,"caseVersion")
);
ALTER TABLE "KycCase" ADD COLUMN "retentionPolicyId" UUID REFERENCES "KycRetentionPolicy"(id), ADD COLUMN "restrictedAt" TIMESTAMP(3), ADD COLUMN "retentionDueAt" TIMESTAMP(3);
ALTER TABLE "KycRetentionPolicy" ENABLE ROW LEVEL SECURITY; ALTER TABLE "KycRetentionPolicy" FORCE ROW LEVEL SECURITY; CREATE POLICY retention_policy_super ON "KycRetentionPolicy" USING(gs_is_super()) WITH CHECK(gs_is_super());
ALTER TABLE "KycLegalHold" ENABLE ROW LEVEL SECURITY; ALTER TABLE "KycLegalHold" FORCE ROW LEVEL SECURITY; CREATE POLICY legal_hold_super ON "KycLegalHold" USING(gs_is_super()) WITH CHECK(gs_is_super());
ALTER TABLE "KycDeletionRequest" ENABLE ROW LEVEL SECURITY; ALTER TABLE "KycDeletionRequest" FORCE ROW LEVEL SECURITY; CREATE POLICY deletion_request_super ON "KycDeletionRequest" USING(gs_is_super()) WITH CHECK(gs_is_super());
ALTER TABLE "KycRetentionEvent" ENABLE ROW LEVEL SECURITY; ALTER TABLE "KycRetentionEvent" FORCE ROW LEVEL SECURITY; CREATE POLICY retention_event_super ON "KycRetentionEvent" USING(gs_is_super()) WITH CHECK(gs_is_super());
CREATE OR REPLACE FUNCTION gs_retention_policy_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT gs_is_super() OR TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW."countryId"<>OLD."countryId" OR NEW."subjectType"<>OLD."subjectType" OR NEW."policyVersion"<>OLD."policyVersion" OR NEW."approvedRetentionDays"<>OLD."approvedRetentionDays" OR NEW."rejectedRetentionDays"<>OLD."rejectedRetentionDays" OR NEW."revokedRetentionDays"<>OLD."revokedRetentionDays" OR NEW."reminderDays"<>OLD."reminderDays" OR NEW."legalBasis"<>OLD."legalBasis" OR NEW."createdByUserId"<>OLD."createdByUserId" OR NOT (OLD.active AND NOT NEW.active) THEN RAISE EXCEPTION 'retention_policy_immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER retention_policy_guard BEFORE UPDATE OR DELETE ON "KycRetentionPolicy" FOR EACH ROW EXECUTE FUNCTION gs_retention_policy_guard();
CREATE TRIGGER retention_event_append_only BEFORE UPDATE OR DELETE ON "KycRetentionEvent" FOR EACH ROW EXECUTE FUNCTION gs_append_only();
CREATE OR REPLACE FUNCTION gs_legal_hold_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "KycCase"%ROWTYPE;
BEGIN
 IF NOT gs_is_super() THEN RAISE EXCEPTION 'legal_hold_privileged_only'; END IF;
 SELECT * INTO c FROM "KycCase" WHERE id=NEW."caseId";
 IF NOT FOUND OR c."countryId"<>NEW."countryId" OR length(trim(NEW.reason))<8 OR NEW."evidenceHash"!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'legal_hold_scope_or_evidence'; END IF;
 IF TG_OP='INSERT' THEN IF NEW."placedByUserId"<>gs_current_user_id() OR NEW."releasedAt" IS NOT NULL THEN RAISE EXCEPTION 'legal_hold_initial'; END IF;
 ELSE IF NEW."caseId"<>OLD."caseId" OR NEW.reason<>OLD.reason OR NEW."evidenceHash"<>OLD."evidenceHash" OR NEW."placedByUserId"<>OLD."placedByUserId" OR OLD."releasedAt" IS NOT NULL OR NEW."releasedAt" IS NULL OR NEW."releasedByUserId"<>gs_current_user_id() OR length(trim(NEW."releaseReason"))<8 THEN RAISE EXCEPTION 'legal_hold_release_invalid'; END IF; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER legal_hold_guard BEFORE INSERT OR UPDATE ON "KycLegalHold" FOR EACH ROW EXECUTE FUNCTION gs_legal_hold_guard();
CREATE TRIGGER legal_hold_no_delete BEFORE DELETE ON "KycLegalHold" FOR EACH ROW EXECUTE FUNCTION gs_append_only();
CREATE OR REPLACE FUNCTION gs_kyc_deletion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "KycCase"%ROWTYPE; p "KycRetentionPolicy"%ROWTYPE;
BEGIN
 IF NOT gs_is_super() THEN RAISE EXCEPTION 'deletion_privileged_only'; END IF;
 SELECT * INTO c FROM "KycCase" WHERE id=NEW."caseId";
 IF NOT FOUND OR c."countryId"<>NEW."countryId" OR c.status NOT IN ('REJECTED','REVOKED','EXPIRED') OR c."retentionDueAt" IS NULL OR NEW."dueAt"<>c."retentionDueAt" OR NEW."requestedByUserId"=c."subjectUserId" THEN RAISE EXCEPTION 'deletion_case_not_eligible'; END IF;
 IF EXISTS (SELECT 1 FROM "KycLegalHold" WHERE "caseId"=c.id AND "releasedAt" IS NULL) THEN RAISE EXCEPTION 'deletion_legal_hold'; END IF;
 IF EXISTS (SELECT 1 FROM "Vendor" WHERE "kycCaseId"=c.id AND status='ACTIVE') OR EXISTS (SELECT 1 FROM "RiderProfile" WHERE "kycCaseId"=c.id AND status='ACTIVE') THEN RAISE EXCEPTION 'deletion_active_party'; END IF;
 IF TG_OP='INSERT' THEN IF NEW.status<>'PENDING_REVIEW' OR NEW.version<>1 OR NEW."requestedByUserId"<>gs_current_user_id() THEN RAISE EXCEPTION 'deletion_initial'; END IF;
 ELSE
  IF NEW."caseId"<>OLD."caseId" OR NEW."dueAt"<>OLD."dueAt" OR NEW."payloadHash"<>OLD."payloadHash" OR NEW."requestedByUserId"<>OLD."requestedByUserId" OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'deletion_immutable'; END IF;
  IF OLD.status='PENDING_REVIEW' AND NEW.status IN ('APPROVED','REJECTED') THEN IF NEW."reviewedByUserId"=OLD."requestedByUserId" OR NEW."reviewedByUserId"<>gs_current_user_id() OR NEW."reviewedAt" IS NULL THEN RAISE EXCEPTION 'deletion_independent_review'; END IF;
  ELSIF OLD.status='APPROVED' AND NEW.status='PURGED' THEN IF NEW."purgedAt" IS NULL THEN RAISE EXCEPTION 'deletion_purge_time'; END IF;
  ELSE RAISE EXCEPTION 'deletion_transition'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER kyc_deletion_guard BEFORE INSERT OR UPDATE ON "KycDeletionRequest" FOR EACH ROW EXECUTE FUNCTION gs_kyc_deletion_guard();
CREATE TRIGGER kyc_deletion_no_delete BEFORE DELETE ON "KycDeletionRequest" FOR EACH ROW EXECUTE FUNCTION gs_append_only();
GRANT SELECT,INSERT,UPDATE ON "KycRetentionPolicy","KycLegalHold","KycDeletionRequest","KycRetentionEvent" TO gs_privileged;
REVOKE UPDATE,DELETE ON "KycRetentionPolicy","KycRetentionEvent" FROM gs_runtime,gs_privileged;
REVOKE DELETE ON "KycLegalHold","KycDeletionRequest" FROM gs_runtime,gs_privileged;
