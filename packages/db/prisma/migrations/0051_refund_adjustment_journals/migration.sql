-- TEST_ONLY refund reservation/execution and maker-checker settlement adjustments. No live provider.
CREATE TABLE "FinanceAdjustment" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "settlementId" UUID NOT NULL REFERENCES "VendorSettlement"(id), "vendorId" UUID NOT NULL REFERENCES "Vendor"(id),
 "countryId" UUID NOT NULL REFERENCES "Country"(id), currency VARCHAR(3) NOT NULL, "amountMinor" BIGINT NOT NULL CHECK ("amountMinor"<>0),
 status "FinanceAdjustmentStatus" NOT NULL DEFAULT 'PENDING_REVIEW', version INTEGER NOT NULL DEFAULT 1,
 "commandKey" VARCHAR(128) NOT NULL, "payloadHash" VARCHAR(64) NOT NULL, reason VARCHAR(512) NOT NULL,
 "evidenceHash" VARCHAR(64) NOT NULL, "createdByUserId" UUID NOT NULL REFERENCES "User"(id), "reviewedByUserId" UUID REFERENCES "User"(id),
 "reviewCommandKey" VARCHAR(128), "reviewPayloadHash" VARCHAR(64), "reviewReason" VARCHAR(512), "journalId" UUID UNIQUE REFERENCES "LedgerJournal"(id),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reviewedAt" TIMESTAMP(3),
 UNIQUE ("settlementId","commandKey"), CHECK ((status='APPROVED' AND "journalId" IS NOT NULL) OR (status<>'APPROVED' AND "journalId" IS NULL)),
 CHECK (status='PENDING_REVIEW' OR ("reviewedByUserId" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "reviewReason" IS NOT NULL))
);
CREATE INDEX ON "FinanceAdjustment"("countryId",status,"createdAt");
CREATE TABLE "VendorPayout" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "settlementId" UUID NOT NULL UNIQUE REFERENCES "VendorSettlement"(id),
 "vendorId" UUID NOT NULL REFERENCES "Vendor"(id), "destinationId" UUID NOT NULL REFERENCES "PayoutDestination"(id),
 "countryId" UUID NOT NULL REFERENCES "Country"(id), currency VARCHAR(3) NOT NULL, "amountMinor" BIGINT NOT NULL CHECK ("amountMinor">0),
 provider VARCHAR(32) NOT NULL CHECK (provider='SANDBOX_MANUAL'), environment VARCHAR(16) NOT NULL CHECK (environment='SANDBOX'),
 "providerKey" VARCHAR(128) NOT NULL UNIQUE, "providerReference" VARCHAR(160) UNIQUE, status "SandboxTransferStatus" NOT NULL DEFAULT 'RESERVED', version INTEGER NOT NULL DEFAULT 1,
 "reservationJournalId" UUID NOT NULL UNIQUE REFERENCES "LedgerJournal"(id), "completionJournalId" UUID UNIQUE REFERENCES "LedgerJournal"(id),
 "commandKey" VARCHAR(128) NOT NULL, "payloadHash" VARCHAR(64) NOT NULL, "createdByUserId" UUID NOT NULL REFERENCES "User"(id),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "submittedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), UNIQUE ("vendorId","commandKey")
);
CREATE TABLE "RefundExecution" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "refundRequestId" UUID NOT NULL UNIQUE REFERENCES "RefundRequest"(id),
 provider VARCHAR(32) NOT NULL CHECK (provider='SANDBOX_MANUAL'), environment VARCHAR(16) NOT NULL CHECK (environment='SANDBOX'),
 "providerKey" VARCHAR(128) NOT NULL UNIQUE, "providerReference" VARCHAR(160) UNIQUE,
 status "SandboxTransferStatus" NOT NULL DEFAULT 'RESERVED', version INTEGER NOT NULL DEFAULT 1,
 "reservationJournalId" UUID NOT NULL UNIQUE REFERENCES "LedgerJournal"(id), "completionJournalId" UUID UNIQUE REFERENCES "LedgerJournal"(id),
 "createdByUserId" UUID NOT NULL REFERENCES "User"(id), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "submittedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
 CHECK ((status IN ('SUCCEEDED','FAILED') AND "completionJournalId" IS NOT NULL AND "completedAt" IS NOT NULL) OR (status IN ('RESERVED','SUBMITTED') AND "completionJournalId" IS NULL AND "completedAt" IS NULL)),
 CHECK ((status='RESERVED' AND "providerReference" IS NULL AND "submittedAt" IS NULL) OR (status<>'RESERVED' AND "providerReference" IS NOT NULL AND "submittedAt" IS NOT NULL))
);
CREATE TABLE "TransferAttempt" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "refundExecutionId" UUID REFERENCES "RefundExecution"(id),
 "providerKey" VARCHAR(128) NOT NULL, "attemptNo" INTEGER NOT NULL CHECK ("attemptNo">0), "actorUserId" UUID NOT NULL REFERENCES "User"(id),
 "commandKey" VARCHAR(128) NOT NULL, "payloadHash" VARCHAR(64) NOT NULL, outcome VARCHAR(16) NOT NULL CHECK (outcome IN ('SUBMITTED','UNKNOWN')), "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("refundExecutionId","attemptNo"), UNIQUE ("refundExecutionId","commandKey"), CHECK ("refundExecutionId" IS NOT NULL)
);
ALTER TABLE "TransferAttempt" ADD COLUMN "vendorPayoutId" UUID REFERENCES "VendorPayout"(id);
ALTER TABLE "TransferAttempt" DROP CONSTRAINT IF EXISTS "TransferAttempt_check";
ALTER TABLE "TransferAttempt" ADD CHECK (("refundExecutionId" IS NOT NULL) <> ("vendorPayoutId" IS NOT NULL));
ALTER TABLE "TransferAttempt" ADD UNIQUE ("vendorPayoutId","attemptNo"), ADD UNIQUE ("vendorPayoutId","commandKey");
ALTER TABLE "TransferAttempt" ENABLE ROW LEVEL SECURITY; ALTER TABLE "TransferAttempt" FORCE ROW LEVEL SECURITY;
ALTER TABLE "RefundExecution" ENABLE ROW LEVEL SECURITY; ALTER TABLE "RefundExecution" FORCE ROW LEVEL SECURITY;
CREATE POLICY refund_execution_select ON "RefundExecution" FOR SELECT USING (gs_is_super() OR EXISTS (SELECT 1 FROM "RefundRequest" r WHERE r.id="refundRequestId" AND r."buyerId"=gs_current_user_id()));
CREATE POLICY refund_execution_super_write ON "RefundExecution" FOR ALL USING (gs_is_super()) WITH CHECK (gs_is_super());
ALTER TABLE "TransferAttempt" ENABLE ROW LEVEL SECURITY; ALTER TABLE "TransferAttempt" FORCE ROW LEVEL SECURITY;
CREATE POLICY transfer_attempt_super_only ON "TransferAttempt" USING (gs_is_super()) WITH CHECK (gs_is_super());
ALTER TABLE "FinanceAdjustment" ENABLE ROW LEVEL SECURITY; ALTER TABLE "FinanceAdjustment" FORCE ROW LEVEL SECURITY;
CREATE POLICY adjustment_select ON "FinanceAdjustment" FOR SELECT USING (gs_is_super() OR EXISTS (SELECT 1 FROM "Vendor" v WHERE v.id="vendorId" AND v."ownerUserId"=gs_current_user_id()));
CREATE POLICY adjustment_super_write ON "FinanceAdjustment" FOR ALL USING (gs_is_super()) WITH CHECK (gs_is_super());
CREATE OR REPLACE FUNCTION gs_refund_execution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "RefundRequest"%ROWTYPE;
BEGIN
 IF NOT gs_is_super() THEN RAISE EXCEPTION 'finance_write_privileged_only'; END IF;
 SELECT * INTO r FROM "RefundRequest" WHERE id=NEW."refundRequestId";
 IF NOT FOUND OR r.status<>'APPROVED' OR NEW.provider<>'SANDBOX_MANUAL' OR NEW.environment<>'SANDBOX' THEN RAISE EXCEPTION 'refund_execution_not_approved_sandbox'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'RESERVED' OR NEW.version<>1 OR NEW."createdByUserId"<>gs_current_user_id() THEN RAISE EXCEPTION 'refund_execution_initial_state'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "LedgerLine" l JOIN "LedgerAccount" a ON a.id=l."accountId" WHERE l."journalId"=NEW."reservationJournalId" AND a.code='customer-refund-payable:'||r."countryId"||':'||r.currency AND l.side='CREDIT' AND l."amountMinor"=r."amountMinor") THEN RAISE EXCEPTION 'refund_reservation_journal_required'; END IF;
 ELSE
  IF NEW.id<>OLD.id OR NEW."refundRequestId"<>OLD."refundRequestId" OR NEW."providerKey"<>OLD."providerKey" OR NEW."reservationJournalId"<>OLD."reservationJournalId" OR NEW."createdByUserId"<>OLD."createdByUserId" OR NEW."createdAt"<>OLD."createdAt" OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'refund_execution_immutable'; END IF;
  IF OLD.status='RESERVED' AND NEW.status='SUBMITTED' THEN
   IF NEW."providerReference" IS NULL OR NEW."submittedAt" IS NULL OR NEW."completionJournalId" IS NOT NULL THEN RAISE EXCEPTION 'refund_execution_submit_invalid'; END IF;
  ELSIF OLD.status='SUBMITTED' AND NEW.status IN ('SUCCEEDED','FAILED') THEN
   IF NEW."completionJournalId" IS NULL OR NEW."completedAt" IS NULL THEN RAISE EXCEPTION 'refund_execution_completion_required'; END IF;
  ELSE RAISE EXCEPTION 'refund_execution_transition'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER refund_execution_guard BEFORE INSERT OR UPDATE ON "RefundExecution" FOR EACH ROW EXECUTE FUNCTION gs_refund_execution_guard();
CREATE TRIGGER refund_execution_no_delete BEFORE DELETE ON "RefundExecution" FOR EACH ROW EXECUTE FUNCTION gs_append_only();
CREATE OR REPLACE FUNCTION gs_transfer_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e "RefundExecution"%ROWTYPE; p "VendorPayout"%ROWTYPE; n INTEGER; k TEXT;
BEGIN
 IF NOT gs_is_super() THEN RAISE EXCEPTION 'finance_write_privileged_only'; END IF;
 IF NEW."refundExecutionId" IS NOT NULL THEN
  SELECT * INTO e FROM "RefundExecution" WHERE id=NEW."refundExecutionId"; k=e."providerKey";
  IF NOT FOUND OR e.status NOT IN ('RESERVED','SUBMITTED') THEN RAISE EXCEPTION 'transfer_attempt_invalid'; END IF;
  SELECT COALESCE(MAX("attemptNo"),0) INTO n FROM "TransferAttempt" WHERE "refundExecutionId"=NEW."refundExecutionId";
 ELSE
  SELECT * INTO p FROM "VendorPayout" WHERE id=NEW."vendorPayoutId"; k=p."providerKey";
  IF NOT FOUND OR p.status NOT IN ('RESERVED','SUBMITTED') THEN RAISE EXCEPTION 'transfer_attempt_invalid'; END IF;
  SELECT COALESCE(MAX("attemptNo"),0) INTO n FROM "TransferAttempt" WHERE "vendorPayoutId"=NEW."vendorPayoutId";
 END IF;
 IF k IS NULL OR k<>NEW."providerKey" OR NEW."attemptNo"<>n+1 OR NEW."actorUserId"<>gs_current_user_id() THEN RAISE EXCEPTION 'transfer_attempt_invalid'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER transfer_attempt_guard BEFORE INSERT ON "TransferAttempt" FOR EACH ROW EXECUTE FUNCTION gs_transfer_attempt_guard();
CREATE TRIGGER transfer_attempt_append_only BEFORE UPDATE OR DELETE ON "TransferAttempt" FOR EACH ROW EXECUTE FUNCTION gs_append_only();
CREATE OR REPLACE FUNCTION gs_adjustment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "VendorSettlement"%ROWTYPE; total BIGINT;
BEGIN
 IF NOT gs_is_super() THEN RAISE EXCEPTION 'finance_write_privileged_only'; END IF;
 SELECT * INTO s FROM "VendorSettlement" WHERE id=NEW."settlementId";
 IF NOT FOUND OR s.status<>'APPROVED' OR s."vendorId"<>NEW."vendorId" OR s."countryId"<>NEW."countryId" OR s.currency<>NEW.currency OR NEW."createdByUserId"<>gs_current_user_id() THEN RAISE EXCEPTION 'adjustment_scope_invalid'; END IF;
 IF EXISTS (SELECT 1 FROM "VendorPayout" p WHERE p."settlementId"=s.id) THEN RAISE EXCEPTION 'adjustment_payout_already_reserved'; END IF;
 SELECT s."netMinor"+COALESCE(SUM("amountMinor"),0) INTO total FROM "FinanceAdjustment" WHERE "settlementId"=s.id AND status='APPROVED';
 IF NEW.status='APPROVED' AND total+NEW."amountMinor" < 0 THEN RAISE EXCEPTION 'adjustment_negative_payable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'PENDING_REVIEW' OR NEW.version<>1 OR EXISTS (SELECT 1 FROM "Vendor" v WHERE v.id=NEW."vendorId" AND v."ownerUserId"=NEW."createdByUserId") THEN RAISE EXCEPTION 'adjustment_initial_or_self'; END IF;
 ELSE
  IF NEW.id<>OLD.id OR NEW."settlementId"<>OLD."settlementId" OR NEW."amountMinor"<>OLD."amountMinor" OR NEW."payloadHash"<>OLD."payloadHash" OR NEW."createdByUserId"<>OLD."createdByUserId" OR OLD.status<>'PENDING_REVIEW' OR NEW.status NOT IN ('APPROVED','REJECTED') OR NEW.version<>OLD.version+1 OR NEW."reviewedByUserId"=OLD."createdByUserId" OR NEW."reviewedByUserId"<>gs_current_user_id() THEN RAISE EXCEPTION 'adjustment_immutable_or_review'; END IF;
  IF NEW.status='APPROVED' AND NOT EXISTS (SELECT 1 FROM "LedgerLine" l JOIN "LedgerAccount" a ON a.id=l."accountId" WHERE l."journalId"=NEW."journalId" AND a.code='vendor-payable:'||s."vendorId"||':'||s.currency AND l."amountMinor"=abs(NEW."amountMinor") AND l.side=CASE WHEN NEW."amountMinor">0 THEN 'CREDIT'::"LedgerSide" ELSE 'DEBIT'::"LedgerSide" END) THEN RAISE EXCEPTION 'adjustment_journal_required'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER adjustment_guard BEFORE INSERT OR UPDATE ON "FinanceAdjustment" FOR EACH ROW EXECUTE FUNCTION gs_adjustment_guard();
CREATE TRIGGER adjustment_no_delete BEFORE DELETE ON "FinanceAdjustment" FOR EACH ROW EXECUTE FUNCTION gs_append_only();
CREATE OR REPLACE FUNCTION gs_adjustment_review_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status<>'PENDING_REVIEW' AND NOT EXISTS (SELECT 1 FROM "AuditLog" WHERE "resourceId"=NEW.id AND action='finance.adjustment.'||lower(NEW.status::text)) THEN RAISE EXCEPTION 'adjustment_review_audit_required'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER adjustment_review_required AFTER INSERT OR UPDATE ON "FinanceAdjustment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_adjustment_review_required();
GRANT SELECT,INSERT,UPDATE ON "RefundExecution","FinanceAdjustment" TO gs_privileged;
GRANT SELECT,INSERT ON "TransferAttempt" TO gs_privileged;
GRANT SELECT ON "RefundExecution","FinanceAdjustment" TO gs_runtime;
REVOKE DELETE ON "RefundExecution","TransferAttempt","FinanceAdjustment" FROM gs_runtime,gs_privileged;
REVOKE UPDATE ON "TransferAttempt" FROM gs_runtime,gs_privileged;

ALTER TABLE "VendorPayout" ENABLE ROW LEVEL SECURITY; ALTER TABLE "VendorPayout" FORCE ROW LEVEL SECURITY;
CREATE POLICY vendor_payout_select ON "VendorPayout" FOR SELECT USING (gs_is_super() OR EXISTS (SELECT 1 FROM "Vendor" v WHERE v.id="vendorId" AND v."ownerUserId"=gs_current_user_id()));
CREATE POLICY vendor_payout_super_write ON "VendorPayout" FOR ALL USING (gs_is_super()) WITH CHECK (gs_is_super());
CREATE OR REPLACE FUNCTION gs_vendor_payout_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "VendorSettlement"%ROWTYPE; d "PayoutDestination"%ROWTYPE; total BIGINT;
BEGIN
 IF NOT gs_is_super() THEN RAISE EXCEPTION 'finance_write_privileged_only'; END IF;
 SELECT * INTO s FROM "VendorSettlement" WHERE id=NEW."settlementId"; SELECT * INTO d FROM "PayoutDestination" WHERE id=NEW."destinationId";
 SELECT s."netMinor"+COALESCE((SELECT SUM("amountMinor") FROM "FinanceAdjustment" WHERE "settlementId"=s.id AND status='APPROVED'),0) INTO total;
 IF NOT FOUND OR d.status<>'VERIFIED' OR d."vendorId"<>s."vendorId" OR d."eligibleAt">NEW."createdAt" OR s.status<>'APPROVED' OR s."destinationId"<>d.id OR NEW."vendorId"<>s."vendorId" OR NEW."countryId"<>s."countryId" OR NEW.currency<>s.currency OR NEW."amountMinor"<>total OR total<=0 OR NOT gs_inventory_vendor_eligible(s."vendorId") THEN RAISE EXCEPTION 'payout_settlement_or_destination_invalid'; END IF;
 IF EXISTS (SELECT 1 FROM "VendorSettlementItem" i JOIN "VendorSuborder" sub ON sub.id=i."suborderId" WHERE i."settlementId"=s.id AND EXISTS (SELECT 1 FROM "RefundRequest" r WHERE r."orderId"=sub."orderId" AND r.status<>'REJECTED')) THEN RAISE EXCEPTION 'payout_refund_reconciliation_required'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'RESERVED' OR NEW.version<>1 OR NEW."createdByUserId"<>gs_current_user_id() OR EXISTS (SELECT 1 FROM "Vendor" v WHERE v.id=NEW."vendorId" AND v."ownerUserId"=NEW."createdByUserId") THEN RAISE EXCEPTION 'payout_initial_or_self'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "LedgerLine" l JOIN "LedgerAccount" a ON a.id=l."accountId" WHERE l."journalId"=NEW."reservationJournalId" AND a.code='vendor-payable:'||s."vendorId"||':'||s.currency AND l.side='DEBIT' AND l."amountMinor"=NEW."amountMinor") THEN RAISE EXCEPTION 'payout_reservation_journal_required'; END IF;
 ELSE
  IF NEW.id<>OLD.id OR NEW."settlementId"<>OLD."settlementId" OR NEW."amountMinor"<>OLD."amountMinor" OR NEW."providerKey"<>OLD."providerKey" OR NEW."reservationJournalId"<>OLD."reservationJournalId" OR NEW."createdByUserId"<>OLD."createdByUserId" OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'payout_immutable'; END IF;
  IF OLD.status='RESERVED' AND NEW.status='SUBMITTED' THEN
   IF NEW."providerReference" IS NULL OR NEW."submittedAt" IS NULL OR NEW."completionJournalId" IS NOT NULL THEN RAISE EXCEPTION 'payout_submit_invalid'; END IF;
  ELSIF OLD.status='SUBMITTED' AND NEW.status IN ('SUCCEEDED','FAILED') THEN
   IF NEW."completionJournalId" IS NULL OR NEW."completedAt" IS NULL THEN RAISE EXCEPTION 'payout_completion_required'; END IF;
  ELSE RAISE EXCEPTION 'payout_transition'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER vendor_payout_guard BEFORE INSERT OR UPDATE ON "VendorPayout" FOR EACH ROW EXECUTE FUNCTION gs_vendor_payout_guard();
CREATE TRIGGER vendor_payout_no_delete BEFORE DELETE ON "VendorPayout" FOR EACH ROW EXECUTE FUNCTION gs_append_only();
GRANT SELECT,INSERT,UPDATE ON "VendorPayout" TO gs_privileged; GRANT SELECT ON "VendorPayout" TO gs_runtime; REVOKE DELETE ON "VendorPayout" FROM gs_runtime,gs_privileged;
