-- KYC expiry/restriction and retention-due automation. No statutory default is invented.
CREATE OR REPLACE FUNCTION gs_kyc_case_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed BOOLEAN;
BEGIN
 IF NOT gs_is_super() THEN RAISE EXCEPTION 'kyc_case_write_privileged_only'; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW."subjectUserId" IS DISTINCT FROM OLD."subjectUserId" OR NEW."subjectType" IS DISTINCT FROM OLD."subjectType" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."policyVersion" IS DISTINCT FROM OLD."policyVersion" OR NEW."consentVersion" IS DISTINCT FROM OLD."consentVersion" OR NEW."consentedAt" IS DISTINCT FROM OLD."consentedAt" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN RAISE EXCEPTION 'kyc_case_immutable_fields'; END IF;
 IF NEW."retentionPolicyId" IS DISTINCT FROM OLD."retentionPolicyId" AND OLD."retentionPolicyId" IS NOT NULL THEN RAISE EXCEPTION 'kyc_retention_policy_snapshot_immutable'; END IF;
 IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'kyc_case_version_conflict'; END IF;
 allowed := (OLD.status='DRAFT' AND NEW.status='SUBMITTED') OR (OLD.status='SUBMITTED' AND NEW.status='UNDER_REVIEW') OR (OLD.status='UNDER_REVIEW' AND NEW.status IN ('APPROVED','REJECTED','MORE_INFORMATION')) OR (OLD.status='MORE_INFORMATION' AND NEW.status='SUBMITTED') OR (OLD.status='APPROVED' AND NEW.status IN ('REVOKED','EXPIRED'));
 IF NOT allowed THEN RAISE EXCEPTION 'kyc_case_invalid_transition'; END IF;
 IF NEW.status IN ('UNDER_REVIEW','APPROVED','REJECTED','MORE_INFORMATION','REVOKED') AND NOT EXISTS (SELECT 1 FROM "KycReview" r WHERE r."caseId"=NEW.id AND r."fromStatus"=OLD.status AND r."toStatus"=NEW.status) THEN RAISE EXCEPTION 'kyc_review_required'; END IF;
 IF NEW.status='EXPIRED' THEN
  IF OLD."expiresAt" IS NULL OR OLD."expiresAt">CURRENT_TIMESTAMP OR NEW."restrictedAt" IS NULL OR NOT EXISTS (SELECT 1 FROM "KycRetentionEvent" e WHERE e."caseId"=NEW.id AND e.kind='EXPIRED' AND e."caseVersion"=NEW.version) THEN RAISE EXCEPTION 'kyc_expiry_evidence_required'; END IF;
 END IF;
 IF NEW.status='SUBMITTED' AND (NEW."submittedAt" IS NULL OR NOT EXISTS (SELECT 1 FROM "KycDocument" WHERE "caseId"=NEW.id)) THEN RAISE EXCEPTION 'kyc_submission_evidence_required'; END IF;
 IF NEW.status='APPROVED' THEN
  IF NEW."expiresAt" IS NULL OR NEW."expiresAt"<=CURRENT_TIMESTAMP OR NEW."reviewedAt" IS NULL THEN RAISE EXCEPTION 'kyc_case_future_expiry_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "KycDocument" WHERE "caseId"=NEW.id) OR EXISTS (SELECT 1 FROM "KycDocument" d JOIN "StorageObject" s ON s.id=d."storageObjectId" WHERE d."caseId"=NEW.id AND ((d."expiresAt" IS NOT NULL AND d."expiresAt"<=CURRENT_TIMESTAMP) OR s.state<>'UPLOADED' OR s."deletedAt" IS NOT NULL OR s."magicValid" IS DISTINCT FROM true OR s.sha256 IS NULL OR d."contentHash"<>s.sha256)) THEN RAISE EXCEPTION 'kyc_approval_evidence_not_ready'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION gs_kyc_retention_tick(batch_size INTEGER, country_uuid UUID DEFAULT NULL) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE c RECORD; p RECORD; n INTEGER := 0; v INTEGER; due TIMESTAMP;
BEGIN
 IF NOT gs_is_super() THEN RAISE EXCEPTION 'retention_privileged_only'; END IF;
 IF batch_size<1 OR batch_size>500 THEN RAISE EXCEPTION 'retention_batch_invalid'; END IF;
 FOR c IN SELECT * FROM "KycCase" WHERE status='APPROVED' AND "expiresAt"<=CURRENT_TIMESTAMP AND (country_uuid IS NULL OR "countryId"=country_uuid) ORDER BY "expiresAt",id LIMIT batch_size FOR UPDATE SKIP LOCKED LOOP
  SELECT * INTO p FROM "KycRetentionPolicy" WHERE id=c."retentionPolicyId";
  IF NOT FOUND THEN SELECT * INTO p FROM "KycRetentionPolicy" WHERE "countryId"=c."countryId" AND "subjectType"=c."subjectType" AND active ORDER BY "createdAt" DESC LIMIT 1; END IF;
  v:=c.version+1; due:=CASE WHEN p.id IS NOT NULL THEN CURRENT_TIMESTAMP + p."approvedRetentionDays" * interval '1 day' ELSE NULL END;
  INSERT INTO "KycRetentionEvent"(id,"caseId","countryId",kind,"caseVersion") VALUES(gen_random_uuid(),c.id,c."countryId",'EXPIRED',v);
  UPDATE "KycCase" SET status='EXPIRED',version=v,"restrictedAt"=CURRENT_TIMESTAMP,"retentionDueAt"=due,"retentionPolicyId"=COALESCE(c."retentionPolicyId",p.id) WHERE id=c.id;
  UPDATE "Vendor" SET status='RESTRICTED',"suspendedAt"=CURRENT_TIMESTAMP,version=version+1 WHERE "kycCaseId"=c.id AND status='ACTIVE';
  UPDATE "RiderProfile" SET status='RESTRICTED',"suspendedAt"=CURRENT_TIMESTAMP,version=version+1 WHERE "kycCaseId"=c.id AND status='ACTIVE';
  INSERT INTO "AuditLog"(id,"actorType",action,"resourceType","resourceId","scopeSnapshot","requestId") VALUES(gen_random_uuid(),'SYSTEM','kyc.retention.expired','KycCase',c.id,jsonb_build_object('countryId',c."countryId"),gen_random_uuid());
  INSERT INTO "OutboxEvent"(id,"aggregateType","aggregateId","eventKey","eventType","occurredAt",payload,"availableAt") VALUES(gen_random_uuid(),'KycCase',c.id,'kyc-expired-'||c.id||'-'||v,'kyc.retention.expired',CURRENT_TIMESTAMP,jsonb_build_object('schemaVersion',1,'eventKey','kyc-expired-'||c.id||'-'||v,'eventType','kyc.retention.expired','occurredAt',CURRENT_TIMESTAMP,'aggregateType','KycCase','aggregateId',c.id,'countryId',c."countryId",'data',jsonb_build_object('version',v,'restricted',true)),CURRENT_TIMESTAMP);
  n:=n+1;
 END LOOP;
 FOR c IN SELECT k.* FROM "KycCase" k JOIN "KycRetentionPolicy" p ON p.id=k."retentionPolicyId" WHERE k.status='APPROVED' AND (country_uuid IS NULL OR k."countryId"=country_uuid) AND k."expiresAt">CURRENT_TIMESTAMP AND k."expiresAt"<=CURRENT_TIMESTAMP+p."reminderDays"*interval '1 day' AND NOT EXISTS (SELECT 1 FROM "OutboxEvent" WHERE "eventKey"='kyc-reminder-'||k.id||'-'||k.version) LIMIT batch_size LOOP
  INSERT INTO "OutboxEvent"(id,"aggregateType","aggregateId","eventKey","eventType","occurredAt",payload,"availableAt") VALUES(gen_random_uuid(),'KycCase',c.id,'kyc-reminder-'||c.id||'-'||c.version,'kyc.retention.reminder',CURRENT_TIMESTAMP,jsonb_build_object('schemaVersion',1,'eventKey','kyc-reminder-'||c.id||'-'||c.version,'eventType','kyc.retention.reminder','occurredAt',CURRENT_TIMESTAMP,'aggregateType','KycCase','aggregateId',c.id,'countryId',c."countryId",'data',jsonb_build_object('expiresAt',c."expiresAt",'version',c.version)),CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
 END LOOP;
 RETURN n;
END; $$;
REVOKE ALL ON FUNCTION gs_kyc_retention_tick(INTEGER,UUID) FROM PUBLIC; GRANT EXECUTE ON FUNCTION gs_kyc_retention_tick(INTEGER,UUID) TO gs_privileged;
-- Reviewed purge may tombstone linked evidence; all other linked-storage mutations remain locked.
CREATE OR REPLACE FUNCTION gs_guard_kyc_linked_storage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d "KycDocument"%ROWTYPE; approved BOOLEAN;
BEGIN
 IF EXISTS (SELECT 1 FROM "KycDocument" WHERE "storageObjectId"=OLD.id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'kyc_linked_storage_delete_denied'; END IF;
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'kyc_linked_storage_privileged_only'; END IF;
  SELECT * INTO d FROM "KycDocument" WHERE "storageObjectId"=OLD.id;
  SELECT EXISTS (SELECT 1 FROM "KycDeletionRequest" r JOIN "KycCase" c ON c.id=r."caseId" WHERE r."caseId"=d."caseId" AND r.status='APPROVED' AND r."dueAt"<=CURRENT_TIMESTAMP AND c.status IN ('REJECTED','REVOKED','EXPIRED') AND NOT EXISTS (SELECT 1 FROM "KycLegalHold" h WHERE h."caseId"=c.id AND h."releasedAt" IS NULL)) INTO approved;
  IF approved AND NEW.state='DELETED' AND NEW."deletedAt" IS NOT NULL AND OLD."deletedAt" IS NULL THEN
   IF NEW."ownerUserId"<>OLD."ownerUserId" OR NEW."objectKey"<>OLD."objectKey" OR NEW.sha256<>OLD.sha256 OR NEW."encryptionKeyId"<>OLD."encryptionKeyId" THEN RAISE EXCEPTION 'kyc_purge_identity_immutable'; END IF;
   RETURN NEW;
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NEW.state<>'UPLOADED' THEN RAISE EXCEPTION 'kyc_linked_storage_state_locked'; END IF;
  IF NEW."ownerUserId" IS DISTINCT FROM OLD."ownerUserId" OR NEW.purpose IS DISTINCT FROM OLD.purpose OR NEW."objectKey" IS DISTINCT FROM OLD."objectKey" OR NEW."contentType" IS DISTINCT FROM OLD."contentType" OR NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes" OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW."encryptionKeyId" IS DISTINCT FROM OLD."encryptionKeyId" OR NEW."magicValid" IS DISTINCT FROM OLD."magicValid" OR NEW."deletedAt" IS DISTINCT FROM OLD."deletedAt" THEN RAISE EXCEPTION 'kyc_linked_storage_immutable'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION gs_vendor_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k "KycCase"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'party_write_privileged_only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."ownerUserId" IS DISTINCT FROM OLD."ownerUserId" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'party_immutable_fields';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'party_version_conflict'; END IF;
  IF NOT ((OLD."status" = 'DRAFT' AND NEW."status" = 'ACTIVE') OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'SUSPENDED') OR (OLD."status" = 'SUSPENDED' AND NEW."status" = 'ACTIVE') OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'RESTRICTED') OR (OLD."status" = 'RESTRICTED' AND NEW."status" = 'ACTIVE')) THEN
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
  IF NEW."status" IN ('SUSPENDED','RESTRICTED') AND NEW."suspendedAt" IS NULL THEN RAISE EXCEPTION 'party_suspendedAt_required'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION gs_rider_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k "KycCase"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'party_write_privileged_only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'party_immutable_fields';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'party_version_conflict'; END IF;
  IF NOT ((OLD."status" = 'DRAFT' AND NEW."status" = 'ACTIVE') OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'SUSPENDED') OR (OLD."status" = 'SUSPENDED' AND NEW."status" = 'ACTIVE') OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'RESTRICTED') OR (OLD."status" = 'RESTRICTED' AND NEW."status" = 'ACTIVE')) THEN
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
  IF NEW."status" IN ('SUSPENDED','RESTRICTED') AND NEW."suspendedAt" IS NULL THEN RAISE EXCEPTION 'party_suspendedAt_required'; END IF;
  RETURN NEW;
END;
$$;
