-- Qualify policy aliases to avoid PL/pgSQL record ambiguity.
CREATE OR REPLACE FUNCTION gs_kyc_retention_tick(batch_size INTEGER, country_uuid UUID DEFAULT NULL) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE c RECORD; p RECORD; n INTEGER := 0; v INTEGER; due TIMESTAMP;
BEGIN
 IF NOT gs_is_super() THEN RAISE EXCEPTION 'retention_privileged_only'; END IF;
 IF batch_size<1 OR batch_size>500 THEN RAISE EXCEPTION 'retention_batch_invalid'; END IF;
 FOR c IN SELECT * FROM "KycCase" WHERE status='APPROVED' AND "expiresAt"<=CURRENT_TIMESTAMP AND (country_uuid IS NULL OR "countryId"=country_uuid) ORDER BY "expiresAt",id LIMIT batch_size FOR UPDATE SKIP LOCKED LOOP
  SELECT * INTO p FROM "KycRetentionPolicy" pol WHERE pol.id=c."retentionPolicyId";
  IF NOT FOUND THEN SELECT * INTO p FROM "KycRetentionPolicy" pol WHERE pol."countryId"=c."countryId" AND "subjectType"=c."subjectType" AND active ORDER BY "createdAt" DESC LIMIT 1; END IF;
  v:=c.version+1; due:=CASE WHEN pol.id IS NOT NULL THEN CURRENT_TIMESTAMP + pol."approvedRetentionDays" * interval '1 day' ELSE NULL END;
  INSERT INTO "KycRetentionEvent"(id,"caseId","countryId",kind,"caseVersion") VALUES(gen_random_uuid(),c.id,c."countryId",'EXPIRED',v);
  UPDATE "KycCase" SET status='EXPIRED',version=v,"restrictedAt"=CURRENT_TIMESTAMP,"retentionDueAt"=due,"retentionPolicyId"=COALESCE(c."retentionPolicyId",pol.id) WHERE id=c.id;
  UPDATE "Vendor" SET status='RESTRICTED',"suspendedAt"=CURRENT_TIMESTAMP,version=version+1 WHERE "kycCaseId"=c.id AND status='ACTIVE';
  UPDATE "RiderProfile" SET status='RESTRICTED',"suspendedAt"=CURRENT_TIMESTAMP,version=version+1 WHERE "kycCaseId"=c.id AND status='ACTIVE';
  INSERT INTO "AuditLog"(id,"actorType",action,"resourceType","resourceId","scopeSnapshot","requestId") VALUES(gen_random_uuid(),'SYSTEM','kyc.retention.expired','KycCase',c.id,jsonb_build_object('countryId',c."countryId"),gen_random_uuid());
  INSERT INTO "OutboxEvent"(id,"aggregateType","aggregateId","eventKey","eventType","occurredAt",payload,"availableAt") VALUES(gen_random_uuid(),'KycCase',c.id,'kyc-expired-'||c.id||'-'||v,'kyc.retention.expired',CURRENT_TIMESTAMP,jsonb_build_object('schemaVersion',1,'eventKey','kyc-expired-'||c.id||'-'||v,'eventType','kyc.retention.expired','occurredAt',CURRENT_TIMESTAMP,'aggregateType','KycCase','aggregateId',c.id,'countryId',c."countryId",'data',jsonb_build_object('version',v,'restricted',true)),CURRENT_TIMESTAMP);
  n:=n+1;
 END LOOP;
 FOR c IN SELECT k.* FROM "KycCase" k JOIN "KycRetentionPolicy" p ON pol.id=k."retentionPolicyId" WHERE k.status='APPROVED' AND (country_uuid IS NULL OR k."countryId"=country_uuid) AND k."expiresAt">CURRENT_TIMESTAMP AND k."expiresAt"<=CURRENT_TIMESTAMP+pol."reminderDays"*interval '1 day' AND NOT EXISTS (SELECT 1 FROM "OutboxEvent" WHERE "eventKey"='kyc-reminder-'||k.id||'-'||k.version) LIMIT batch_size LOOP
  INSERT INTO "OutboxEvent"(id,"aggregateType","aggregateId","eventKey","eventType","occurredAt",payload,"availableAt") VALUES(gen_random_uuid(),'KycCase',c.id,'kyc-reminder-'||c.id||'-'||c.version,'kyc.retention.reminder',CURRENT_TIMESTAMP,jsonb_build_object('schemaVersion',1,'eventKey','kyc-reminder-'||c.id||'-'||c.version,'eventType','kyc.retention.reminder','occurredAt',CURRENT_TIMESTAMP,'aggregateType','KycCase','aggregateId',c.id,'countryId',c."countryId",'data',jsonb_build_object('expiresAt',c."expiresAt",'version',c.version)),CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
 END LOOP;
 RETURN n;
END; $$;

REVOKE ALL ON FUNCTION gs_kyc_retention_tick(INTEGER,UUID) FROM PUBLIC; GRANT EXECUTE ON FUNCTION gs_kyc_retention_tick(INTEGER,UUID) TO gs_privileged;
