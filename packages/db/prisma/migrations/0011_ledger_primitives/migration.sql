-- Immutable double-entry ledger primitives. Additive; no existing financial data is rewritten.
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE');
CREATE TYPE "LedgerSide" AS ENUM ('DEBIT','CREDIT');

CREATE TABLE "LedgerAccount" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(128) NOT NULL,
  "type" "LedgerAccountType" NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LedgerAccount_code_key" UNIQUE ("code"),
  CONSTRAINT "LedgerAccount_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "LedgerAccount_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "LedgerJournal" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "businessEventKey" VARCHAR(128) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "description" VARCHAR(512) NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversalOfJournalId" UUID,
  CONSTRAINT "LedgerJournal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LedgerJournal_businessEventKey_key" UNIQUE ("businessEventKey"),
  CONSTRAINT "LedgerJournal_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "LedgerJournal_reversal_not_self" CHECK ("reversalOfJournalId" IS NULL OR "reversalOfJournalId" <> "id"),
  CONSTRAINT "LedgerJournal_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LedgerJournal_reversalOfJournalId_fkey" FOREIGN KEY ("reversalOfJournalId") REFERENCES "LedgerJournal"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "LedgerLine" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "journalId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "side" "LedgerSide" NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "lineNo" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LedgerLine_amount_positive" CHECK ("amountMinor" > 0),
  CONSTRAINT "LedgerLine_lineNo_positive" CHECK ("lineNo" >= 1),
  CONSTRAINT "LedgerLine_journalId_lineNo_key" UNIQUE ("journalId", "lineNo"),
  CONSTRAINT "LedgerLine_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "LedgerJournal"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LedgerLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "LedgerJournal_createdAt_idx" ON "LedgerJournal"("createdAt");
CREATE INDEX "LedgerLine_accountId_idx" ON "LedgerLine"("accountId");

-- Line currency must match both journal and account currency.
CREATE OR REPLACE FUNCTION gs_ledger_line_currency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j_currency VARCHAR(3); a_currency VARCHAR(3);
BEGIN
  SELECT currency INTO j_currency FROM "LedgerJournal" WHERE id = NEW."journalId";
  SELECT currency INTO a_currency FROM "LedgerAccount" WHERE id = NEW."accountId";
  IF j_currency IS NULL OR a_currency IS NULL THEN
    RAISE EXCEPTION 'ledger_reference_missing';
  END IF;
  IF j_currency <> a_currency THEN
    RAISE EXCEPTION 'ledger_currency_mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ledger_line_currency BEFORE INSERT ON "LedgerLine"
  FOR EACH ROW EXECUTE FUNCTION gs_ledger_line_currency();

-- Deferred balance check: a journal must have at least two lines and net zero at commit.
CREATE OR REPLACE FUNCTION gs_ledger_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line_count INTEGER; net BIGINT;
BEGIN
  SELECT count(*), COALESCE(SUM(CASE WHEN side = 'DEBIT' THEN "amountMinor" ELSE -"amountMinor" END), 0)
    INTO line_count, net
    FROM "LedgerLine" WHERE "journalId" = NEW."id";
  IF line_count < 2 THEN
    RAISE EXCEPTION 'ledger_journal_too_small';
  END IF;
  IF net <> 0 THEN
    RAISE EXCEPTION 'ledger_journal_unbalanced';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER ledger_journal_balanced AFTER INSERT ON "LedgerJournal"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_ledger_journal_balanced();

-- Journals and lines are append-only. Corrections must be new linked reversal journals.
CREATE TRIGGER ledger_journal_no_update_delete BEFORE UPDATE OR DELETE ON "LedgerJournal"
  FOR EACH ROW EXECUTE FUNCTION gs_append_only();
CREATE TRIGGER ledger_line_no_update_delete BEFORE UPDATE OR DELETE ON "LedgerLine"
  FOR EACH ROW EXECUTE FUNCTION gs_append_only();

ALTER TABLE "LedgerAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LedgerAccount" FORCE ROW LEVEL SECURITY;
ALTER TABLE "LedgerJournal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LedgerJournal" FORCE ROW LEVEL SECURITY;
ALTER TABLE "LedgerLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LedgerLine" FORCE ROW LEVEL SECURITY;

CREATE POLICY ledger_account_super_select ON "LedgerAccount" FOR SELECT USING (gs_is_super());
CREATE POLICY ledger_account_super_insert ON "LedgerAccount" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY ledger_journal_super_select ON "LedgerJournal" FOR SELECT USING (gs_is_super());
CREATE POLICY ledger_journal_super_insert ON "LedgerJournal" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY ledger_line_super_select ON "LedgerLine" FOR SELECT USING (gs_is_super());
CREATE POLICY ledger_line_super_insert ON "LedgerLine" FOR INSERT WITH CHECK (gs_is_super());

COMMENT ON TABLE "LedgerJournal" IS 'Immutable balanced journal header; unique businessEventKey prevents duplicate money effects.';
COMMENT ON TABLE "LedgerLine" IS 'Immutable positive debit/credit line; balance enforced per journal at commit.';
