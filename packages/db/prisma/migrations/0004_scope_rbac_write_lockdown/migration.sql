-- The original AdminScope FOR ALL policy unintentionally allowed self-insert.
DROP POLICY scope_self_or_super ON "AdminScope";
CREATE POLICY scope_select_self_or_super ON "AdminScope" FOR SELECT
  USING (gs_is_super() OR "userId" = gs_current_user_id());

-- Prevent non-privileged actors from changing account status or authorization version.
CREATE OR REPLACE FUNCTION gs_guard_user_security_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN
    IF NEW.status IS DISTINCT FROM OLD.status OR NEW."authorizationVersion" IS DISTINCT FROM OLD."authorizationVersion" THEN
      RAISE EXCEPTION 'user_security_fields_require_privileged_role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_security_fields_guard BEFORE UPDATE ON "User"
  FOR EACH ROW EXECUTE FUNCTION gs_guard_user_security_fields();

ALTER TABLE "UserRole" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserRole" FORCE ROW LEVEL SECURITY;
CREATE POLICY user_role_select_self_or_super ON "UserRole" FOR SELECT
  USING (gs_is_super() OR "userId" = gs_current_user_id());
CREATE POLICY user_role_write_super_only ON "UserRole" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY user_role_update_super_only ON "UserRole" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Role" FORCE ROW LEVEL SECURITY;
CREATE POLICY role_read_all ON "Role" FOR SELECT USING (true);
CREATE POLICY role_write_super_only ON "Role" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY role_update_super_only ON "Role" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

ALTER TABLE "Permission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Permission" FORCE ROW LEVEL SECURITY;
CREATE POLICY permission_read_all ON "Permission" FOR SELECT USING (true);
CREATE POLICY permission_write_super_only ON "Permission" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY permission_update_super_only ON "Permission" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

ALTER TABLE "RolePermission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RolePermission" FORCE ROW LEVEL SECURITY;
CREATE POLICY role_permission_read_all ON "RolePermission" FOR SELECT USING (true);
CREATE POLICY role_permission_write_super_only ON "RolePermission" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY role_permission_update_super_only ON "RolePermission" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());
