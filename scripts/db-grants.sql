-- Run as the migration/owner role after migrations. No BYPASSRLS is granted.
GRANT USAGE ON SCHEMA public TO gs_runtime, gs_privileged;
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tableowner=current_user LOOP
    EXECUTE format('GRANT SELECT ON TABLE %I TO gs_runtime, gs_privileged', t);
    EXECUTE format('GRANT INSERT, UPDATE ON TABLE %I TO gs_privileged', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON TABLE %I FROM gs_runtime', t);
    EXECUTE format('REVOKE DELETE ON TABLE %I FROM gs_privileged', t);
  END LOOP;
END $$;
-- Runtime may create/revoke its own sessions and write operational records, subject to RLS.
GRANT INSERT, UPDATE ON TABLE "User" TO gs_runtime;
GRANT INSERT, UPDATE ON TABLE "UserIdentity" TO gs_runtime;
GRANT INSERT, UPDATE, DELETE ON TABLE "Session" TO gs_runtime;
GRANT INSERT, UPDATE, DELETE ON TABLE "IdempotencyRecord" TO gs_runtime;
GRANT INSERT ON TABLE "AuditLog" TO gs_runtime;
GRANT INSERT, UPDATE ON TABLE "OutboxEvent" TO gs_runtime;
GRANT INSERT ON TABLE "InboxReceipt" TO gs_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE "InboxDeadLetter" TO gs_runtime;
GRANT INSERT, UPDATE ON TABLE "UserMfa" TO gs_runtime;
GRANT INSERT, UPDATE ON TABLE "RecoveryCode" TO gs_runtime;
GRANT INSERT, UPDATE ON TABLE "StorageObject" TO gs_runtime;
-- Ledger primitives are privileged-only and append-only. Runtime has no direct ledger grants.
REVOKE ALL ON TABLE "LedgerAccount" FROM gs_runtime;
REVOKE ALL ON TABLE "LedgerJournal" FROM gs_runtime;
REVOKE ALL ON TABLE "LedgerLine" FROM gs_runtime;
REVOKE UPDATE, DELETE ON TABLE "LedgerAccount" FROM gs_privileged;
REVOKE UPDATE, DELETE ON TABLE "LedgerJournal" FROM gs_privileged;
REVOKE UPDATE, DELETE ON TABLE "LedgerLine" FROM gs_privileged;
GRANT SELECT, INSERT ON TABLE "LedgerAccount" TO gs_privileged;
GRANT SELECT, INSERT ON TABLE "LedgerJournal" TO gs_privileged;
GRANT SELECT, INSERT ON TABLE "LedgerLine" TO gs_privileged;
GRANT EXECUTE ON FUNCTION gs_current_user_id() TO gs_runtime, gs_privileged;
GRANT EXECUTE ON FUNCTION gs_authorization_version() TO gs_runtime, gs_privileged;
GRANT EXECUTE ON FUNCTION gs_is_super() TO gs_runtime, gs_privileged;
GRANT EXECUTE ON FUNCTION gs_append_only() TO gs_runtime, gs_privileged;
GRANT EXECUTE ON FUNCTION gs_guard_user_security_fields() TO gs_runtime, gs_privileged;
GRANT EXECUTE ON FUNCTION gs_guard_storage_review() TO gs_runtime, gs_privileged;
GRANT EXECUTE ON FUNCTION gs_ledger_line_currency() TO gs_privileged;
GRANT EXECUTE ON FUNCTION gs_ledger_journal_balanced() TO gs_privileged;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO gs_runtime, gs_privileged;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT INSERT, UPDATE ON TABLES TO gs_privileged;
