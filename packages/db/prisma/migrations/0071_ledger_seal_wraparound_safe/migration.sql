-- Make the ledger posting seal wraparound-safe.
--
-- 0070 bound a journal to pg_current_xact_id(), which is a 32-bit transaction id. PostgreSQL
-- reuses 32-bit xids after ~2^32 transactions, so a far-future transaction could eventually be
-- assigned the same xid as a long-committed journal and would satisfy the seal comparison,
-- re-opening that historical journal to late line inserts.
--
-- txid_current() returns the epoch-qualified 64-bit id (epoch << 32 | xid), which is never
-- reused. Existing stored values are NOT rewritten: within epoch 0 the two functions return the
-- same number, and once the epoch advances the 64-bit value can never collide with an older
-- 32-bit value, so already-sealed journals stay sealed.
ALTER TABLE "LedgerJournal"
  ALTER COLUMN "postingTxid" SET DEFAULT (txid_current()::text);

COMMENT ON COLUMN "LedgerJournal"."postingTxid" IS
  'Server-assigned epoch-qualified posting transaction id (txid_current). Lines may only be inserted in the same transaction; committed journals are sealed.';

CREATE OR REPLACE FUNCTION gs_ledger_journal_posting_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'ledger_write_privileged_only'; END IF;
  NEW."postingTxid" := txid_current()::text;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION gs_ledger_line_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE posting_txid VARCHAR(64);
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'ledger_write_privileged_only'; END IF;
  SELECT "postingTxid" INTO posting_txid FROM "LedgerJournal" WHERE id = NEW."journalId";
  IF posting_txid IS NULL THEN RAISE EXCEPTION 'ledger_reference_missing'; END IF;
  IF posting_txid <> txid_current()::text THEN RAISE EXCEPTION 'ledger_journal_sealed'; END IF;
  RETURN NEW;
END; $$;
