-- Allow the privileged role to reach the append-only trigger instead of silently filtering rows.
CREATE POLICY audit_update_super_only ON "AuditLog" FOR UPDATE
  USING (gs_is_super()) WITH CHECK (gs_is_super());
