CREATE TABLE "ProviderStatementEntry" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), provider VARCHAR(32) NOT NULL CHECK (provider='SANDBOX_MANUAL'), environment VARCHAR(16) NOT NULL CHECK(environment='SANDBOX'),
 kind "ProviderStatementKind" NOT NULL, "providerReference" VARCHAR(160) NOT NULL, "amountMinor" BIGINT NOT NULL CHECK("amountMinor">0), currency VARCHAR(3) NOT NULL,
 status "ProviderStatementStatus" NOT NULL, "countryId" UUID NOT NULL REFERENCES "Country"(id), "statementReference" VARCHAR(128) NOT NULL, "evidenceHash" VARCHAR(64) NOT NULL,
 "refundExecutionId" UUID UNIQUE REFERENCES "RefundExecution"(id), "vendorPayoutId" UUID UNIQUE REFERENCES "VendorPayout"(id), "journalId" UUID NOT NULL UNIQUE REFERENCES "LedgerJournal"(id),
 "importedByUserId" UUID NOT NULL REFERENCES "User"(id), "commandKey" VARCHAR(128) NOT NULL, "payloadHash" VARCHAR(64) NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(provider,"providerReference"), UNIQUE("countryId","commandKey"), CHECK(("refundExecutionId" IS NOT NULL) <> ("vendorPayoutId" IS NOT NULL))
);
ALTER TABLE "ProviderStatementEntry" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ProviderStatementEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_statement_super_only ON "ProviderStatementEntry" USING(gs_is_super()) WITH CHECK(gs_is_super());
CREATE OR REPLACE FUNCTION gs_provider_statement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "RefundExecution"%ROWTYPE; p "VendorPayout"%ROWTYPE; amt BIGINT; cur TEXT; ref TEXT; c UUID;
BEGIN
 IF NOT gs_is_super() OR NEW."importedByUserId"<>gs_current_user_id() THEN RAISE EXCEPTION 'statement_privileged_actor'; END IF;
 IF NEW.kind='REFUND' THEN
  SELECT * INTO r FROM "RefundExecution" WHERE id=NEW."refundExecutionId"; SELECT rr."amountMinor",rr.currency,rr."countryId" INTO amt,cur,c FROM "RefundRequest" rr WHERE rr.id=r."refundRequestId"; ref=r."providerReference";
  IF NOT FOUND OR r.status<>'SUBMITTED' OR NEW."vendorPayoutId" IS NOT NULL THEN RAISE EXCEPTION 'statement_refund_not_submitted'; END IF;
 ELSE
  SELECT * INTO p FROM "VendorPayout" WHERE id=NEW."vendorPayoutId"; amt=p."amountMinor";cur=p.currency;ref=p."providerReference";c=p."countryId";
  IF NOT FOUND OR p.status<>'SUBMITTED' OR NEW."refundExecutionId" IS NOT NULL THEN RAISE EXCEPTION 'statement_payout_not_submitted'; END IF;
 END IF;
 IF ref IS NULL OR ref<>NEW."providerReference" OR amt<>NEW."amountMinor" OR cur<>NEW.currency OR c<>NEW."countryId" THEN RAISE EXCEPTION 'statement_exact_match_required'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER provider_statement_guard BEFORE INSERT ON "ProviderStatementEntry" FOR EACH ROW EXECUTE FUNCTION gs_provider_statement_guard();
CREATE TRIGGER provider_statement_append_only BEFORE UPDATE OR DELETE ON "ProviderStatementEntry" FOR EACH ROW EXECUTE FUNCTION gs_append_only();
CREATE OR REPLACE FUNCTION gs_transfer_completion_statement_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IN ('SUCCEEDED','FAILED') AND NOT EXISTS (SELECT 1 FROM "ProviderStatementEntry" e WHERE (e."refundExecutionId"=NEW.id OR e."vendorPayoutId"=NEW.id) AND e."journalId"=NEW."completionJournalId" AND e.status::text=NEW.status::text) THEN RAISE EXCEPTION 'transfer_completion_statement_required'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER refund_completion_statement_required AFTER INSERT OR UPDATE ON "RefundExecution" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_transfer_completion_statement_required();
CREATE CONSTRAINT TRIGGER payout_completion_statement_required AFTER INSERT OR UPDATE ON "VendorPayout" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_transfer_completion_statement_required();
GRANT SELECT,INSERT ON "ProviderStatementEntry" TO gs_privileged; REVOKE UPDATE,DELETE ON "ProviderStatementEntry" FROM gs_runtime,gs_privileged;
