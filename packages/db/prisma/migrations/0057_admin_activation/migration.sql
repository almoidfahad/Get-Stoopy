CREATE TABLE "AdminActivation" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "userId" UUID NOT NULL REFERENCES "User"(id), "countryId" UUID NOT NULL REFERENCES "Country"(id), "roleId" UUID NOT NULL REFERENCES "Role"(id),
 "kycCaseId" UUID UNIQUE REFERENCES "KycCase"(id), status "AdminActivationStatus" NOT NULL DEFAULT 'PENDING', version INTEGER NOT NULL DEFAULT 1,
 "invitedByUserId" UUID NOT NULL REFERENCES "User"(id), "activatedByUserId" UUID REFERENCES "User"(id), "commandKey" VARCHAR(128) NOT NULL, "payloadHash" VARCHAR(64) NOT NULL,
 reason VARCHAR(512) NOT NULL, "reviewCommandKey" VARCHAR(128), "reviewPayloadHash" VARCHAR(64), "reviewReason" VARCHAR(512),
 "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reviewedAt" TIMESTAMP(3),
 UNIQUE ("userId","countryId","roleId","commandKey"), CHECK ("expiresAt">"createdAt")
);
CREATE INDEX ON "AdminActivation"("countryId",status,"createdAt");
ALTER TABLE "AdminActivation" ENABLE ROW LEVEL SECURITY; ALTER TABLE "AdminActivation" FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_activation_select ON "AdminActivation" FOR SELECT USING(gs_is_super() OR "userId"=gs_current_user_id());
CREATE POLICY admin_activation_super_write ON "AdminActivation" FOR ALL USING(gs_is_super()) WITH CHECK(gs_is_super());
CREATE OR REPLACE FUNCTION gs_admin_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u "User"%ROWTYPE; r "Role"%ROWTYPE; k "KycCase"%ROWTYPE; m "UserMfa"%ROWTYPE;
BEGIN
 IF NOT gs_is_super() THEN RAISE EXCEPTION 'admin_activation_privileged_only'; END IF;
 SELECT * INTO u FROM "User" WHERE id=NEW."userId"; SELECT * INTO r FROM "Role" WHERE id=NEW."roleId";
 IF NOT FOUND OR r.key IN ('super_admin','bootstrap_admin') OR u.status<>'ACTIVE' OR NEW."userId"=NEW."invitedByUserId" OR NEW."invitedByUserId"<>gs_current_user_id() THEN RAISE EXCEPTION 'admin_activation_target_or_role_invalid'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'PENDING' OR NEW.version<>1 OR NEW."kycCaseId" IS NOT NULL THEN RAISE EXCEPTION 'admin_activation_initial_state'; END IF;
 ELSE
  IF NEW."userId"<>OLD."userId" OR NEW."countryId"<>OLD."countryId" OR NEW."roleId"<>OLD."roleId" OR NEW."payloadHash"<>OLD."payloadHash" OR NEW."invitedByUserId"<>OLD."invitedByUserId" OR NEW."createdAt"<>OLD."createdAt" OR OLD.status<>'PENDING' OR NEW.version<>OLD.version+1 OR NEW."activatedByUserId"=OLD."userId" OR NEW."activatedByUserId"=OLD."invitedByUserId" OR NEW."activatedByUserId"<>gs_current_user_id() THEN RAISE EXCEPTION 'admin_activation_immutable_or_self'; END IF;
  IF NEW.status='ACTIVE' THEN
   SELECT * INTO k FROM "KycCase" WHERE id=NEW."kycCaseId"; SELECT * INTO m FROM "UserMfa" WHERE "userId"=NEW."userId";
   IF NOT FOUND OR m.state<>'ACTIVE' OR m."confirmedAt" IS NULL OR k."subjectUserId"<>NEW."userId" OR k."subjectType"<>'ADMIN' OR k."countryId"<>NEW."countryId" OR k.status<>'APPROVED' OR k."expiresAt" IS NULL OR k."expiresAt"<=CURRENT_TIMESTAMP OR NEW."expiresAt">k."expiresAt" THEN RAISE EXCEPTION 'admin_activation_kyc_mfa_required'; END IF;
   IF NOT EXISTS (SELECT 1 FROM "UserIdentity" WHERE "userId"=NEW."userId") THEN RAISE EXCEPTION 'admin_activation_identity_required'; END IF;
  ELSIF NEW.status NOT IN ('REJECTED','EXPIRED') OR NEW."kycCaseId" IS NOT NULL THEN RAISE EXCEPTION 'admin_activation_transition'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER admin_activation_guard BEFORE INSERT OR UPDATE ON "AdminActivation" FOR EACH ROW EXECUTE FUNCTION gs_admin_activation_guard();
CREATE TRIGGER admin_activation_no_delete BEFORE DELETE ON "AdminActivation" FOR EACH ROW EXECUTE FUNCTION gs_append_only();
CREATE OR REPLACE FUNCTION gs_admin_activation_grant_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='ACTIVE' THEN
  IF NOT EXISTS (SELECT 1 FROM "UserRole" WHERE "userId"=NEW."userId" AND "roleId"=NEW."roleId" AND "revokedAt" IS NULL AND "expiresAt"=NEW."expiresAt") OR NOT EXISTS (SELECT 1 FROM "AdminScope" WHERE "userId"=NEW."userId" AND "countryId"=NEW."countryId" AND "geographyType"='COUNTRY' AND "revokedAt" IS NULL AND "expiresAt"=NEW."expiresAt") THEN RAISE EXCEPTION 'admin_activation_grant_required'; END IF;
 END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER admin_activation_grant_required AFTER INSERT OR UPDATE ON "AdminActivation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_admin_activation_grant_required();
GRANT SELECT,INSERT,UPDATE ON "AdminActivation" TO gs_privileged; GRANT SELECT ON "AdminActivation" TO gs_runtime; REVOKE DELETE ON "AdminActivation" FROM gs_runtime,gs_privileged;
