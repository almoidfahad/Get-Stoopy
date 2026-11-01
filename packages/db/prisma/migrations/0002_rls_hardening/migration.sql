-- Hardening: super context is only honored for a dedicated privileged DB role.
CREATE OR REPLACE FUNCTION gs_is_super() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_user = 'gs_privileged' AND current_setting('app.is_super', true) = 'true'
$$;

-- Session lookup by opaque-token hash before the actor id is known.
CREATE POLICY session_token_lookup ON "Session" FOR SELECT
  USING ("tokenHash" = NULLIF(current_setting('app.session_token_hash', true), ''));

-- First-party identity provisioning runs with the new actor id already set.
CREATE POLICY user_insert_self_or_super ON "User" FOR INSERT
  WITH CHECK (gs_is_super() OR id = gs_current_user_id());

ALTER TABLE "UserIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserIdentity" FORCE ROW LEVEL SECURITY;
CREATE POLICY identity_self_or_super ON "UserIdentity" FOR SELECT
  USING (gs_is_super() OR "userId" = gs_current_user_id());
CREATE POLICY identity_insert_self_or_super ON "UserIdentity" FOR INSERT
  WITH CHECK (gs_is_super() OR "userId" = gs_current_user_id());
CREATE POLICY identity_update_self_or_super ON "UserIdentity" FOR UPDATE
  USING (gs_is_super() OR "userId" = gs_current_user_id())
  WITH CHECK (gs_is_super() OR "userId" = gs_current_user_id());

CREATE POLICY scope_insert_super_only ON "AdminScope" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY scope_update_super_only ON "AdminScope" FOR UPDATE
  USING (gs_is_super()) WITH CHECK (gs_is_super());

DROP POLICY audit_insert_authenticated ON "AuditLog";
CREATE POLICY audit_insert_actor_or_super ON "AuditLog" FOR INSERT
  WITH CHECK (gs_is_super() OR "actorId" = gs_current_user_id());

COMMENT ON FUNCTION gs_is_super() IS 'Requires dedicated gs_privileged DB role plus explicit app.is_super. Runtime role cannot self-elevate.';
