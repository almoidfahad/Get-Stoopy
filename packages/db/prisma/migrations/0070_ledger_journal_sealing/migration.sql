-- Close the ledger append-only gap: a committed journal must not accept new lines later.
-- Additive only; existing financial rows are not rewritten. Existing journals are sealed by
-- receiving the migration transaction id, so future line inserts into them fail closed.
ALTER TABLE "LedgerJournal"
  ADD COLUMN "postingTxid" VARCHAR(64) NOT NULL DEFAULT (pg_current_xact_id()::text);

COMMENT ON COLUMN "LedgerJournal"."postingTxid" IS
  'Server-assigned posting transaction id. Lines may only be inserted in the same transaction; committed journals are sealed.';

-- Ignore any client-supplied postingTxid and bind the journal to the current transaction.
CREATE OR REPLACE FUNCTION gs_ledger_journal_posting_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'ledger_write_privileged_only'; END IF;
  NEW."postingTxid" := pg_current_xact_id()::text;
  RETURN NEW;
END; $$;
CREATE TRIGGER ledger_journal_posting_guard BEFORE INSERT ON "LedgerJournal"
  FOR EACH ROW EXECUTE FUNCTION gs_ledger_journal_posting_guard();

-- A line can only be added while its journal is being posted in this same transaction.
CREATE OR REPLACE FUNCTION gs_ledger_line_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE posting_txid VARCHAR(64);
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'ledger_write_privileged_only'; END IF;
  SELECT "postingTxid" INTO posting_txid FROM "LedgerJournal" WHERE id = NEW."journalId";
  IF posting_txid IS NULL THEN RAISE EXCEPTION 'ledger_reference_missing'; END IF;
  IF posting_txid <> pg_current_xact_id()::text THEN RAISE EXCEPTION 'ledger_journal_sealed'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER ledger_line_insert_guard BEFORE INSERT ON "LedgerLine"
  FOR EACH ROW EXECUTE FUNCTION gs_ledger_line_insert_guard();

-- Re-check balance when lines are inserted, not only when the journal header is inserted.
CREATE OR REPLACE FUNCTION gs_ledger_line_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line_count INTEGER; net BIGINT;
BEGIN
  SELECT count(*), COALESCE(SUM(CASE WHEN side = 'DEBIT' THEN "amountMinor" ELSE -"amountMinor" END), 0)
    INTO line_count, net
    FROM "LedgerLine" WHERE "journalId" = NEW."journalId";
  IF line_count < 2 THEN RAISE EXCEPTION 'ledger_journal_too_small'; END IF;
  IF net <> 0 THEN RAISE EXCEPTION 'ledger_journal_unbalanced'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER ledger_line_journal_balanced AFTER INSERT ON "LedgerLine"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_ledger_line_journal_balanced();

REVOKE ALL ON FUNCTION gs_ledger_journal_posting_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION gs_ledger_line_insert_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION gs_ledger_line_journal_balanced() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gs_ledger_journal_posting_guard() TO gs_privileged;
GRANT EXECUTE ON FUNCTION gs_ledger_line_insert_guard() TO gs_privileged;
GRANT EXECUTE ON FUNCTION gs_ledger_line_journal_balanced() TO gs_privileged;
