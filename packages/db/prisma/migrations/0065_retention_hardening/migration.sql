-- Harden retention guards: due-date enforcement, case locking, active-party purge block, policy insert evidence.
CREATE OR REPLACE FUNCTION gs_kyc_deletion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "KycCase"%ROWTYPE;
BEGIN
 IF NOT gs_is_super() THEN RAISE EXCEPTION 'deletion_privileged_only'; END IF;
 SELECT * INTO c FROM "KycCase" WHERE id=NEW."caseId" FOR UPDATE;
 IF NOT FOUND OR c."countryId"<>NEW."countryId" OR c.status NOT IN ('REJECTED','REVOKED','EXPIRED') OR c."retentionDueAt" IS NULL OR NEW."dueAt"<>c."retentionDueAt" OR NEW."dueAt">CURRENT_TIMESTAMP OR NEW."requestedByUserId"=c."subjectUserId" THEN RAISE EXCEPTION 'deletion_case_not_eligible'; END IF;
 IF EXISTS (SELECT 1 FROM "KycLegalHold" WHERE "caseId"=c.id AND "releasedAt" IS NULL) THEN RAISE EXCEPTION 'deletion_legal_hold'; END IF;
 IF EXISTS (SELECT 1 FROM "Vendor" WHERE "kycCaseId"=c.id AND status='ACTIVE') OR EXISTS (SELECT 1 FROM "RiderProfile" WHERE "kycCaseId"=c.id AND status='ACTIVE') THEN RAISE EXCEPTION 'deletion_active_party'; END IF;
 IF TG_OP='INSERT' THEN IF NEW.status<>'PENDING_REVIEW' OR NEW.version<>1 OR NEW."requestedByUserId"<>gs_current_user_id() OR length(trim(NEW.reason))<8 THEN RAISE EXCEPTION 'deletion_initial'; END IF;
 ELSE
  IF NEW."caseId"<>OLD."caseId" OR NEW."dueAt"<>OLD."dueAt" OR NEW."payloadHash"<>OLD."payloadHash" OR NEW."requestedByUserId"<>OLD."requestedByUserId" OR NEW."commandKey"<>OLD."commandKey" OR NEW.reason<>OLD.reason OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'deletion_immutable'; END IF;
  IF OLD.status='PENDING_REVIEW' AND NEW.status IN ('APPROVED','REJECTED') THEN IF NEW."reviewedByUserId"=OLD."requestedByUserId" OR NEW."reviewedByUserId"<>gs_current_user_id() OR NEW."reviewedAt" IS NULL OR length(trim(NEW."reviewReason"))<8 THEN RAISE EXCEPTION 'deletion_independent_review'; END IF;
  ELSIF OLD.status='APPROVED' AND NEW.status='PURGED' THEN IF NEW."purgedAt" IS NULL OR NEW."reviewedByUserId"<>OLD."reviewedByUserId" OR NEW."reviewedAt"<>OLD."reviewedAt" THEN RAISE EXCEPTION 'deletion_purge_invalid'; END IF;
  ELSE RAISE EXCEPTION 'deletion_transition'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION gs_legal_hold_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "KycCase"%ROWTYPE;
BEGIN
 IF NOT gs_is_super() THEN RAISE EXCEPTION 'legal_hold_privileged_only'; END IF;
 SELECT * INTO c FROM "KycCase" WHERE id=NEW."caseId" FOR UPDATE;
 IF NOT FOUND OR c."countryId"<>NEW."countryId" OR length(trim(NEW.reason))<8 OR NEW."evidenceHash"!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'legal_hold_scope_or_evidence'; END IF;
 IF TG_OP='INSERT' THEN IF NEW."placedByUserId"<>gs_current_user_id() OR NEW."releasedAt" IS NOT NULL OR NEW."releasedByUserId" IS NOT NULL OR NEW."releaseReason" IS NOT NULL THEN RAISE EXCEPTION 'legal_hold_initial'; END IF;
 ELSE IF NEW."caseId"<>OLD."caseId" OR NEW."countryId"<>OLD."countryId" OR NEW.reason<>OLD.reason OR NEW."evidenceHash"<>OLD."evidenceHash" OR NEW."placedByUserId"<>OLD."placedByUserId" OR NEW."createdAt"<>OLD."createdAt" OR OLD."releasedAt" IS NOT NULL OR NEW."releasedAt" IS NULL OR NEW."releasedByUserId"<>gs_current_user_id() OR length(trim(NEW."releaseReason"))<8 THEN RAISE EXCEPTION 'legal_hold_release_invalid'; END IF; END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION gs_guard_kyc_linked_storage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d "KycDocument"%ROWTYPE; approved BOOLEAN;
BEGIN
 IF EXISTS (SELECT 1 FROM "KycDocument" WHERE "storageObjectId"=OLD.id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'kyc_linked_storage_delete_denied'; END IF;
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'kyc_linked_storage_privileged_only'; END IF;
  SELECT * INTO d FROM "KycDocument" WHERE "storageObjectId"=OLD.id;
  SELECT EXISTS (SELECT 1 FROM "KycDeletionRequest" r JOIN "KycCase" c ON c.id=r."caseId" WHERE r."caseId"=d."caseId" AND r.status='APPROVED' AND r."dueAt"<=CURRENT_TIMESTAMP AND c.status IN ('REJECTED','REVOKED','EXPIRED') AND NOT EXISTS (SELECT 1 FROM "KycLegalHold" h WHERE h."caseId"=c.id AND h."releasedAt" IS NULL) AND NOT EXISTS (SELECT 1 FROM "Vendor" v WHERE v."kycCaseId"=c.id AND v.status='ACTIVE') AND NOT EXISTS (SELECT 1 FROM "RiderProfile" rp WHERE rp."kycCaseId"=c.id AND rp.status='ACTIVE')) INTO approved;
  IF approved AND NEW.state='DELETED' AND NEW."deletedAt" IS NOT NULL AND OLD."deletedAt" IS NULL THEN
   IF NEW."ownerUserId"<>OLD."ownerUserId" OR NEW.purpose<>OLD.purpose OR NEW.purpose<>'kyc-document' OR NEW."objectKey"<>OLD."objectKey" OR NEW."contentType"<>OLD."contentType" OR NEW."sizeBytes"<>OLD."sizeBytes" OR NEW.sha256<>OLD.sha256 OR NEW."encryptionKeyId"<>OLD."encryptionKeyId" OR NEW."magicValid"<>OLD."magicValid" THEN RAISE EXCEPTION 'kyc_purge_identity_immutable'; END IF;
   RETURN NEW;
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NEW.state<>'UPLOADED' THEN RAISE EXCEPTION 'kyc_linked_storage_state_locked'; END IF;
  IF NEW."ownerUserId" IS DISTINCT FROM OLD."ownerUserId" OR NEW.purpose IS DISTINCT FROM OLD.purpose OR NEW."objectKey" IS DISTINCT FROM OLD."objectKey" OR NEW."contentType" IS DISTINCT FROM OLD."contentType" OR NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes" OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW."encryptionKeyId" IS DISTINCT FROM OLD."encryptionKeyId" OR NEW."magicValid" IS DISTINCT FROM OLD."magicValid" OR NEW."deletedAt" IS DISTINCT FROM OLD."deletedAt" THEN RAISE EXCEPTION 'kyc_linked_storage_immutable'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION gs_retention_policy_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT gs_is_super() OR NEW."createdByUserId"<>gs_current_user_id() OR NOT NEW.active OR length(trim(NEW."legalBasis"))<8 OR length(trim(NEW."policyVersion"))<1 OR NEW."policyVersion"<>trim(NEW."policyVersion") THEN RAISE EXCEPTION 'retention_policy_initial_invalid'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER retention_policy_insert_guard BEFORE INSERT ON "KycRetentionPolicy" FOR EACH ROW EXECUTE FUNCTION gs_retention_policy_insert_guard();
-- Include admin activation closure in the bounded retention tick.
CREATE OR REPLACE FUNCTION gs_kyc_retention_tick(batch_size INTEGER, country_uuid UUID DEFAULT NULL) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE c RECORD; polrec RECORD; n INTEGER := 0; v INTEGER; due TIMESTAMP;
BEGIN
 IF NOT gs_is_super() THEN RAISE EXCEPTION 'retention_privileged_only'; END IF;
 IF batch_size<1 OR batch_size>500 THEN RAISE EXCEPTION 'retention_batch_invalid'; END IF;
 FOR c IN SELECT * FROM "KycCase" WHERE status='APPROVED' AND "expiresAt"<=CURRENT_TIMESTAMP AND (country_uuid IS NULL OR "countryId"=country_uuid) ORDER BY "expiresAt",id LIMIT batch_size FOR UPDATE SKIP LOCKED LOOP
  SELECT * INTO polrec FROM "KycRetentionPolicy" WHERE id=c."retentionPolicyId";
  IF NOT FOUND THEN SELECT * INTO polrec FROM "KycRetentionPolicy" WHERE "countryId"=c."countryId" AND "subjectType"=c."subjectType" AND active ORDER BY "createdAt" DESC LIMIT 1; END IF;
  v:=c.version+1; due:=CASE WHEN polrec.id IS NOT NULL THEN CURRENT_TIMESTAMP + polrec."approvedRetentionDays" * interval '1 day' ELSE NULL END;
  INSERT INTO "KycRetentionEvent"(id,"caseId","countryId",kind,"caseVersion") VALUES(gen_random_uuid(),c.id,c."countryId",'EXPIRED',v);
  UPDATE "KycCase" SET status='EXPIRED',version=v,"restrictedAt"=CURRENT_TIMESTAMP,"retentionDueAt"=due,"retentionPolicyId"=COALESCE(c."retentionPolicyId",polrec.id) WHERE id=c.id;
  UPDATE "Vendor" SET status='RESTRICTED',"suspendedAt"=CURRENT_TIMESTAMP,version=version+1 WHERE "kycCaseId"=c.id AND status='ACTIVE';
  UPDATE "RiderProfile" SET status='RESTRICTED',"suspendedAt"=CURRENT_TIMESTAMP,version=version+1 WHERE "kycCaseId"=c.id AND status='ACTIVE';
  PERFORM gs_close_admin_activation(x.id,'Linked ADMIN KYC expired') FROM "AdminActivation" x WHERE x."kycCaseId"=c.id AND x.status='ACTIVE';
  INSERT INTO "AuditLog"(id,"actorType",action,"resourceType","resourceId","scopeSnapshot","requestId") VALUES(gen_random_uuid(),'SYSTEM','kyc.retention.expired','KycCase',c.id,jsonb_build_object('countryId',c."countryId"),gen_random_uuid());
  INSERT INTO "OutboxEvent"(id,"aggregateType","aggregateId","eventKey","eventType","occurredAt",payload,"availableAt") VALUES(gen_random_uuid(),'KycCase',c.id,'kyc-expired-'||c.id||'-'||v,'kyc.retention.expired',CURRENT_TIMESTAMP,jsonb_build_object('schemaVersion',1,'eventKey','kyc-expired-'||c.id||'-'||v,'eventType','kyc.retention.expired','occurredAt',CURRENT_TIMESTAMP,'aggregateType','KycCase','aggregateId',c.id,'countryId',c."countryId",'data',jsonb_build_object('version',v,'restricted',true)),CURRENT_TIMESTAMP);
  n:=n+1;
 END LOOP;
 FOR c IN SELECT k.* FROM "KycCase" k JOIN "KycRetentionPolicy" pol ON pol.id=k."retentionPolicyId" WHERE k.status='APPROVED' AND (country_uuid IS NULL OR k."countryId"=country_uuid) AND k."expiresAt">CURRENT_TIMESTAMP AND k."expiresAt"<=CURRENT_TIMESTAMP+pol."reminderDays"*interval '1 day' AND NOT EXISTS (SELECT 1 FROM "OutboxEvent" WHERE "eventKey"='kyc-reminder-'||k.id||'-'||k.version) LIMIT batch_size LOOP
  INSERT INTO "OutboxEvent"(id,"aggregateType","aggregateId","eventKey","eventType","occurredAt",payload,"availableAt") VALUES(gen_random_uuid(),'KycCase',c.id,'kyc-reminder-'||c.id||'-'||c.version,'kyc.retention.reminder',CURRENT_TIMESTAMP,jsonb_build_object('schemaVersion',1,'eventKey','kyc-reminder-'||c.id||'-'||c.version,'eventType','kyc.retention.reminder','occurredAt',CURRENT_TIMESTAMP,'aggregateType','KycCase','aggregateId',c.id,'countryId',c."countryId",'data',jsonb_build_object('expiresAt',c."expiresAt",'version',c.version)),CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
 END LOOP;
 PERFORM gs_admin_activation_expiry_tick(batch_size,country_uuid);
 RETURN n;
END; $$;
REVOKE ALL ON FUNCTION gs_kyc_retention_tick(INTEGER,UUID) FROM PUBLIC; GRANT EXECUTE ON FUNCTION gs_kyc_retention_tick(INTEGER,UUID) TO gs_privileged;
