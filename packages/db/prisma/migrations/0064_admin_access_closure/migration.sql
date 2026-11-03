-- Link admin activation to the exact grants it created, and close access when KYC/invitation expires or is revoked.
ALTER TABLE "AdminActivation" ADD COLUMN "userRoleId" UUID REFERENCES "UserRole"(id), ADD COLUMN "adminScopeId" UUID REFERENCES "AdminScope"(id), ADD COLUMN "closedAt" TIMESTAMP(3), ADD COLUMN "closeReason" VARCHAR(512);
ALTER TABLE "AdminActivation" ADD CONSTRAINT "AdminActivation_adminScopeId_key" UNIQUE ("adminScopeId");
CREATE INDEX ON "AdminActivation"("userRoleId");
ALTER TABLE "AdminActivation" DISABLE TRIGGER admin_activation_guard;
UPDATE "AdminActivation" a SET
 "userRoleId"=(SELECT id FROM "UserRole" WHERE "userId"=a."userId" AND "roleId"=a."roleId" AND "grantedBy"=a."activatedByUserId" AND "expiresAt"=a."expiresAt" AND "revokedAt" IS NULL LIMIT 1),
 "adminScopeId"=(SELECT id FROM "AdminScope" WHERE "userId"=a."userId" AND "countryId"=a."countryId" AND "geographyType"='COUNTRY' AND "grantedBy"=a."activatedByUserId" AND "expiresAt"=a."expiresAt" AND "revokedAt" IS NULL LIMIT 1)
WHERE a.status='ACTIVE' AND a."userRoleId" IS NULL;
ALTER TABLE "AdminActivation" ENABLE TRIGGER admin_activation_guard;
CREATE OR REPLACE FUNCTION gs_admin_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u "User"%ROWTYPE; r "Role"%ROWTYPE; k "KycCase"%ROWTYPE; m "UserMfa"%ROWTYPE;
BEGIN
 IF NOT gs_is_super() THEN RAISE EXCEPTION 'admin_activation_privileged_only'; END IF;
 SELECT * INTO u FROM "User" WHERE id=NEW."userId"; SELECT * INTO r FROM "Role" WHERE id=NEW."roleId";
 IF NOT FOUND OR r.key IN ('super_admin','bootstrap_admin') OR u.status<>'ACTIVE' OR NEW."userId"=NEW."invitedByUserId" OR (TG_OP='INSERT' AND NEW."invitedByUserId"<>gs_current_user_id()) THEN RAISE EXCEPTION 'admin_activation_target_or_role_invalid'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'PENDING' OR NEW.version<>1 OR NEW."kycCaseId" IS NOT NULL OR NEW."userRoleId" IS NOT NULL OR NEW."adminScopeId" IS NOT NULL OR NEW."closedAt" IS NOT NULL THEN RAISE EXCEPTION 'admin_activation_initial_state'; END IF;
 ELSE
  IF NEW."userId"<>OLD."userId" OR NEW."countryId"<>OLD."countryId" OR NEW."roleId"<>OLD."roleId" OR NEW."payloadHash"<>OLD."payloadHash" OR NEW."invitedByUserId"<>OLD."invitedByUserId" OR NEW."createdAt"<>OLD."createdAt" OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'admin_activation_immutable'; END IF;
  IF OLD.status IN ('PENDING','ACTIVE') AND NEW.status='EXPIRED' THEN
   IF NEW."kycCaseId" IS DISTINCT FROM OLD."kycCaseId" OR NEW."activatedByUserId" IS DISTINCT FROM OLD."activatedByUserId" OR NEW."reviewCommandKey" IS DISTINCT FROM OLD."reviewCommandKey" OR NEW."reviewPayloadHash" IS DISTINCT FROM OLD."reviewPayloadHash" OR NEW."reviewReason" IS DISTINCT FROM OLD."reviewReason" OR NEW."reviewedAt" IS DISTINCT FROM OLD."reviewedAt" OR NEW."expiresAt"<>OLD."expiresAt" OR NEW."closedAt" IS NULL OR length(trim(NEW."closeReason"))<8 THEN RAISE EXCEPTION 'admin_activation_closure_invalid'; END IF;
   SELECT * INTO k FROM "KycCase" WHERE id=OLD."kycCaseId";
   IF OLD."expiresAt">CURRENT_TIMESTAMP AND (OLD."kycCaseId" IS NULL OR (FOUND AND k.status='APPROVED' AND k."expiresAt">CURRENT_TIMESTAMP)) THEN RAISE EXCEPTION 'admin_activation_closure_not_due'; END IF;
   RETURN NEW;
  END IF;
  IF OLD.status<>'PENDING' OR NEW."activatedByUserId"=OLD."userId" OR NEW."activatedByUserId"=OLD."invitedByUserId" OR NEW."activatedByUserId"<>gs_current_user_id() OR NEW."closedAt" IS NOT NULL OR NEW."closeReason" IS NOT NULL THEN RAISE EXCEPTION 'admin_activation_review_invalid'; END IF;
  IF NEW.status='ACTIVE' THEN
   SELECT * INTO k FROM "KycCase" WHERE id=NEW."kycCaseId"; SELECT * INTO m FROM "UserMfa" WHERE "userId"=NEW."userId";
   IF NOT FOUND OR m.state<>'ACTIVE' OR m."confirmedAt" IS NULL OR k."subjectUserId"<>NEW."userId" OR k."subjectType"<>'ADMIN' OR k."countryId"<>NEW."countryId" OR k.status<>'APPROVED' OR k."expiresAt" IS NULL OR k."expiresAt"<=CURRENT_TIMESTAMP OR NEW."expiresAt">k."expiresAt" OR NEW."expiresAt"<=CURRENT_TIMESTAMP THEN RAISE EXCEPTION 'admin_activation_kyc_mfa_required'; END IF;
   IF NOT EXISTS (SELECT 1 FROM "UserIdentity" WHERE "userId"=NEW."userId") THEN RAISE EXCEPTION 'admin_activation_identity_required'; END IF;
   IF NOT EXISTS (SELECT 1 FROM "UserRole" WHERE id=NEW."userRoleId" AND "userId"=NEW."userId" AND "roleId"=NEW."roleId" AND "grantedBy"=NEW."activatedByUserId" AND "expiresAt"=NEW."expiresAt" AND "revokedAt" IS NULL) OR NOT EXISTS (SELECT 1 FROM "AdminScope" WHERE id=NEW."adminScopeId" AND "userId"=NEW."userId" AND "countryId"=NEW."countryId" AND "geographyType"='COUNTRY' AND "grantedBy"=NEW."activatedByUserId" AND "expiresAt"=NEW."expiresAt" AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'admin_activation_grant_link_required'; END IF;
  ELSIF NEW.status NOT IN ('REJECTED','EXPIRED') OR NEW."kycCaseId" IS NOT NULL OR NEW."userRoleId" IS NOT NULL OR NEW."adminScopeId" IS NOT NULL THEN RAISE EXCEPTION 'admin_activation_transition'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION gs_admin_activation_grant_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='ACTIVE' THEN
  IF NOT EXISTS (SELECT 1 FROM "UserRole" WHERE id=NEW."userRoleId" AND "userId"=NEW."userId" AND "roleId"=NEW."roleId" AND "revokedAt" IS NULL AND "expiresAt"=NEW."expiresAt") OR NOT EXISTS (SELECT 1 FROM "AdminScope" WHERE id=NEW."adminScopeId" AND "userId"=NEW."userId" AND "countryId"=NEW."countryId" AND "geographyType"='COUNTRY' AND "revokedAt" IS NULL AND "expiresAt"=NEW."expiresAt") THEN RAISE EXCEPTION 'admin_activation_grant_required'; END IF;
 ELSIF NEW.status='EXPIRED' AND NEW."userRoleId" IS NOT NULL THEN
  IF NOT EXISTS (SELECT 1 FROM "UserRole" WHERE id=NEW."userRoleId" AND "revokedAt" IS NOT NULL) OR NOT EXISTS (SELECT 1 FROM "AdminScope" WHERE id=NEW."adminScopeId" AND "revokedAt" IS NOT NULL) THEN RAISE EXCEPTION 'admin_activation_grant_revocation_required'; END IF;
 END IF;
 RETURN NULL;
END; $$;
CREATE OR REPLACE FUNCTION gs_close_admin_activation(activation_uuid UUID, reason_text VARCHAR) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE a "AdminActivation"%ROWTYPE; k "KycCase"%ROWTYPE; v INTEGER;
BEGIN
 IF NOT gs_is_super() THEN RAISE EXCEPTION 'admin_activation_privileged_only'; END IF;
 SELECT * INTO a FROM "AdminActivation" WHERE id=activation_uuid FOR UPDATE;
 IF NOT FOUND OR a.status NOT IN ('PENDING','ACTIVE') THEN RETURN FALSE; END IF;
 SELECT * INTO k FROM "KycCase" WHERE id=a."kycCaseId";
 IF a."expiresAt">CURRENT_TIMESTAMP AND (a."kycCaseId" IS NULL OR (FOUND AND k.status='APPROVED' AND k."expiresAt">CURRENT_TIMESTAMP)) THEN RETURN FALSE; END IF;
 IF a.status='ACTIVE' THEN
  IF a."userRoleId" IS NULL OR a."adminScopeId" IS NULL THEN RAISE EXCEPTION 'admin_activation_grant_link_missing'; END IF;
  UPDATE "UserRole" SET "revokedAt"=CURRENT_TIMESTAMP WHERE id=a."userRoleId" AND "revokedAt" IS NULL;
  UPDATE "AdminScope" SET "revokedAt"=CURRENT_TIMESTAMP WHERE id=a."adminScopeId" AND "revokedAt" IS NULL;
  UPDATE "User" SET "authorizationVersion"="authorizationVersion"+1 WHERE id=a."userId";
 END IF;
 v:=a.version+1;
 UPDATE "AdminActivation" SET status='EXPIRED',version=v,"closedAt"=CURRENT_TIMESTAMP,"closeReason"=reason_text WHERE id=a.id;
 INSERT INTO "AuditLog"(id,"actorType",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES(gen_random_uuid(),'SYSTEM','admin.activation.expired','AdminActivation',a.id,jsonb_build_object('countryId',a."countryId"),reason_text,gen_random_uuid());
 INSERT INTO "OutboxEvent"(id,"aggregateType","aggregateId","eventKey","eventType","occurredAt",payload,"availableAt") VALUES(gen_random_uuid(),'AdminActivation',a.id,'admin-activation-expired-'||a.id||'-'||v,'admin.activation.expired',CURRENT_TIMESTAMP,jsonb_build_object('schemaVersion',1,'eventKey','admin-activation-expired-'||a.id||'-'||v,'eventType','admin.activation.expired','occurredAt',CURRENT_TIMESTAMP,'aggregateType','AdminActivation','aggregateId',a.id,'countryId',a."countryId",'data',jsonb_build_object('version',v,'userId',a."userId")),CURRENT_TIMESTAMP);
 RETURN TRUE;
END; $$;
CREATE OR REPLACE FUNCTION gs_admin_activation_expiry_tick(batch_size INTEGER, country_uuid UUID DEFAULT NULL) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE a RECORD; n INTEGER:=0;
BEGIN
 IF NOT gs_is_super() THEN RAISE EXCEPTION 'admin_activation_privileged_only'; END IF;
 IF batch_size<1 OR batch_size>500 THEN RAISE EXCEPTION 'retention_batch_invalid'; END IF;
 FOR a IN SELECT x.id FROM "AdminActivation" x LEFT JOIN "KycCase" k ON k.id=x."kycCaseId" WHERE x.status IN ('PENDING','ACTIVE') AND (x."expiresAt"<=CURRENT_TIMESTAMP OR (x."kycCaseId" IS NOT NULL AND (k.status<>'APPROVED' OR k."expiresAt"<=CURRENT_TIMESTAMP))) AND (country_uuid IS NULL OR x."countryId"=country_uuid) ORDER BY x."expiresAt",x.id LIMIT batch_size FOR UPDATE OF x SKIP LOCKED LOOP
  IF gs_close_admin_activation(a.id,'KYC or activation expiry reached') THEN n:=n+1; END IF;
 END LOOP;
 RETURN n;
END; $$;
REVOKE ALL ON FUNCTION gs_close_admin_activation(UUID,VARCHAR) FROM PUBLIC; GRANT EXECUTE ON FUNCTION gs_close_admin_activation(UUID,VARCHAR) TO gs_privileged;
REVOKE ALL ON FUNCTION gs_admin_activation_expiry_tick(INTEGER,UUID) FROM PUBLIC; GRANT EXECUTE ON FUNCTION gs_admin_activation_expiry_tick(INTEGER,UUID) TO gs_privileged;
