-- Inviter is fixed at INSERT; independent activator reviews later.
CREATE OR REPLACE FUNCTION gs_admin_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u "User"%ROWTYPE; r "Role"%ROWTYPE; k "KycCase"%ROWTYPE; m "UserMfa"%ROWTYPE;
BEGIN
 IF NOT gs_is_super() THEN RAISE EXCEPTION 'admin_activation_privileged_only'; END IF;
 SELECT * INTO u FROM "User" WHERE id=NEW."userId"; SELECT * INTO r FROM "Role" WHERE id=NEW."roleId";
 IF NOT FOUND OR r.key IN ('super_admin','bootstrap_admin') OR u.status<>'ACTIVE' OR NEW."userId"=NEW."invitedByUserId" OR (TG_OP='INSERT' AND NEW."invitedByUserId"<>gs_current_user_id()) THEN RAISE EXCEPTION 'admin_activation_target_or_role_invalid'; END IF;
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
