-- Vendor settlement calculation and maker-checker review. Approval reserves payable; it is not a transfer.
CREATE TABLE "VendorCommissionPolicy" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "vendorId" UUID NOT NULL REFERENCES "Vendor"(id),
  "countryId" UUID NOT NULL REFERENCES "Country"(id), currency VARCHAR(3) NOT NULL,
  "commissionBps" INTEGER NOT NULL CHECK ("commissionBps" BETWEEN 0 AND 9999),
  "holdDays" INTEGER NOT NULL CHECK ("holdDays" BETWEEN 0 AND 90),
  "effectiveFrom" TIMESTAMP(3) NOT NULL, "commandKey" VARCHAR(128) NOT NULL, "payloadHash" VARCHAR(64) NOT NULL,
  "createdByUserId" UUID NOT NULL REFERENCES "User"(id), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("vendorId","commandKey"), UNIQUE ("vendorId",currency,"effectiveFrom")
);
CREATE TABLE "VendorSettlement" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "vendorId" UUID NOT NULL REFERENCES "Vendor"(id),
  "countryId" UUID NOT NULL REFERENCES "Country"(id), currency VARCHAR(3) NOT NULL,
  "destinationId" UUID NOT NULL REFERENCES "PayoutDestination"(id),
  "grossMinor" BIGINT NOT NULL CHECK ("grossMinor">0), "commissionMinor" BIGINT NOT NULL CHECK ("commissionMinor">=0),
  "netMinor" BIGINT NOT NULL CHECK ("netMinor">0), CHECK ("grossMinor"="commissionMinor"+"netMinor"),
  status "VendorSettlementStatus" NOT NULL DEFAULT 'PENDING_REVIEW', version INTEGER NOT NULL DEFAULT 1,
  "commandKey" VARCHAR(128) NOT NULL, "payloadHash" VARCHAR(64) NOT NULL,
  "createdByUserId" UUID NOT NULL REFERENCES "User"(id), "reviewedByUserId" UUID REFERENCES "User"(id),
  "reviewCommandKey" VARCHAR(128), "reviewPayloadHash" VARCHAR(64), "reviewReason" VARCHAR(512),
  "journalId" UUID UNIQUE REFERENCES "LedgerJournal"(id), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reviewedAt" TIMESTAMP(3),
  UNIQUE ("vendorId","commandKey"),
  CHECK ((status='APPROVED' AND "journalId" IS NOT NULL) OR (status<>'APPROVED' AND "journalId" IS NULL)),
  CHECK (status='PENDING_REVIEW' OR ("reviewedByUserId" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "reviewReason" IS NOT NULL AND "reviewCommandKey" IS NOT NULL))
);
CREATE INDEX "VendorSettlement_countryId_status_createdAt_idx" ON "VendorSettlement"("countryId",status,"createdAt");
CREATE TABLE "VendorSettlementItem" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "settlementId" UUID NOT NULL REFERENCES "VendorSettlement"(id),
  "suborderId" UUID NOT NULL REFERENCES "VendorSuborder"(id), "policyId" UUID NOT NULL REFERENCES "VendorCommissionPolicy"(id),
  "grossMinor" BIGINT NOT NULL CHECK ("grossMinor">0), "commissionBps" INTEGER NOT NULL,
  "commissionMinor" BIGINT NOT NULL CHECK ("commissionMinor">=0), "netMinor" BIGINT NOT NULL CHECK ("netMinor">0),
  "completedAt" TIMESTAMP(3) NOT NULL, "holdUntil" TIMESTAMP(3) NOT NULL,
  UNIQUE ("settlementId","suborderId")
);
CREATE TABLE "VendorSettlementReview" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "settlementId" UUID NOT NULL REFERENCES "VendorSettlement"(id),
  decision "VendorSettlementDecision" NOT NULL, "settlementVersion" INTEGER NOT NULL,
  "actorUserId" UUID NOT NULL REFERENCES "User"(id), "commandKey" VARCHAR(128) NOT NULL, "payloadHash" VARCHAR(64) NOT NULL,
  reason VARCHAR(512) NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("settlementId","commandKey"), UNIQUE ("settlementId","settlementVersion")
);
CREATE OR REPLACE FUNCTION gs_vendor_commission_policy_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v "Vendor"%ROWTYPE; c "Country"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'settlement_write_privileged_only'; END IF;
  SELECT * INTO v FROM "Vendor" WHERE id=NEW."vendorId"; SELECT * INTO c FROM "Country" WHERE id=NEW."countryId";
  IF NOT FOUND OR c."currencyCode"<>NEW.currency OR v."countryId"<>NEW."countryId" OR NOT gs_inventory_vendor_eligible(NEW."vendorId") OR v."ownerUserId"=NEW."createdByUserId" OR NEW."createdByUserId"<>gs_current_user_id() THEN RAISE EXCEPTION 'commission_policy_scope_or_actor'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER vendor_commission_policy_guard BEFORE INSERT ON "VendorCommissionPolicy" FOR EACH ROW EXECUTE FUNCTION gs_vendor_commission_policy_guard();
CREATE TRIGGER vendor_commission_policy_append_only BEFORE UPDATE OR DELETE ON "VendorCommissionPolicy" FOR EACH ROW EXECUTE FUNCTION gs_append_only();
CREATE OR REPLACE FUNCTION gs_vendor_settlement_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v "Vendor"%ROWTYPE; d "PayoutDestination"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'settlement_write_privileged_only'; END IF;
  SELECT * INTO v FROM "Vendor" WHERE id=NEW."vendorId"; SELECT * INTO d FROM "PayoutDestination" WHERE id=NEW."destinationId";
  IF NOT FOUND OR d."vendorId"<>NEW."vendorId" OR d."countryId"<>NEW."countryId" OR d.currency<>NEW.currency OR d.status<>'VERIFIED' OR d."eligibleAt">NEW."createdAt" OR NOT gs_inventory_vendor_eligible(NEW."vendorId") THEN RAISE EXCEPTION 'settlement_destination_or_vendor_ineligible'; END IF;
  IF v."countryId"<>NEW."countryId" OR v."ownerUserId"=NEW."createdByUserId" OR NEW."createdByUserId"<>gs_current_user_id() OR NEW.status<>'PENDING_REVIEW' OR NEW.version<>1 THEN RAISE EXCEPTION 'settlement_initial_state_or_actor'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER vendor_settlement_insert_guard BEFORE INSERT ON "VendorSettlement" FOR EACH ROW EXECUTE FUNCTION gs_vendor_settlement_insert_guard();
CREATE OR REPLACE FUNCTION gs_vendor_settlement_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d "PayoutDestination"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'settlement_write_privileged_only'; END IF;
  IF NEW.id<>OLD.id OR NEW."vendorId"<>OLD."vendorId" OR NEW."countryId"<>OLD."countryId" OR NEW.currency<>OLD.currency OR NEW."destinationId"<>OLD."destinationId"
    OR NEW."grossMinor"<>OLD."grossMinor" OR NEW."commissionMinor"<>OLD."commissionMinor" OR NEW."netMinor"<>OLD."netMinor"
    OR NEW."commandKey"<>OLD."commandKey" OR NEW."payloadHash"<>OLD."payloadHash" OR NEW."createdByUserId"<>OLD."createdByUserId" OR NEW."createdAt"<>OLD."createdAt"
    OR OLD.status<>'PENDING_REVIEW' OR NEW.status NOT IN ('APPROVED','REJECTED') OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'settlement_immutable_or_transition'; END IF;
  IF NEW."reviewedByUserId" IS NULL OR NEW."reviewedByUserId"=OLD."createdByUserId" OR NEW."reviewedByUserId"<>gs_current_user_id() OR NEW."reviewedAt" IS NULL THEN RAISE EXCEPTION 'settlement_independent_review_required'; END IF;
  IF NEW.status='APPROVED' THEN
    SELECT * INTO d FROM "PayoutDestination" WHERE id=NEW."destinationId";
    IF d.status<>'VERIFIED' OR d."eligibleAt">NEW."reviewedAt" OR NOT gs_inventory_vendor_eligible(NEW."vendorId") THEN RAISE EXCEPTION 'settlement_destination_or_vendor_ineligible'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER vendor_settlement_update_guard BEFORE UPDATE ON "VendorSettlement" FOR EACH ROW EXECUTE FUNCTION gs_vendor_settlement_update_guard();
CREATE OR REPLACE FUNCTION gs_vendor_settlement_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "VendorSettlement"%ROWTYPE; sub "VendorSuborder"%ROWTYPE; p "VendorCommissionPolicy"%ROWTYPE; del "Delivery"%ROWTYPE; ord "Order"%ROWTYPE; due BIGINT;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'settlement_write_privileged_only'; END IF;
  SELECT * INTO s FROM "VendorSettlement" WHERE id=NEW."settlementId";
  SELECT * INTO sub FROM "VendorSuborder" WHERE id=NEW."suborderId";
  SELECT * INTO p FROM "VendorCommissionPolicy" WHERE id=NEW."policyId";
  SELECT * INTO del FROM "Delivery" WHERE "suborderId"=sub.id;
  SELECT * INTO ord FROM "Order" WHERE id=sub."orderId";
  IF NOT FOUND OR s.status<>'PENDING_REVIEW' OR sub."vendorId"<>s."vendorId" OR sub.currency<>s.currency OR sub.status<>'COMPLETED' OR ord."lifecycleStatus"<>'ACTIVE'
    OR p."vendorId"<>s."vendorId" OR p."countryId"<>s."countryId" OR p.currency<>s.currency OR p."effectiveFrom">del."completedAt" OR p."createdAt">del."completedAt"
    OR del.status<>'COMPLETED' OR NEW."completedAt"<>del."completedAt" OR NEW."grossMinor"<>sub."subtotalMinor" OR NEW."commissionBps"<>p."commissionBps"
    OR NEW."commissionMinor"<>(NEW."grossMinor"*NEW."commissionBps"/10000) OR NEW."netMinor"<>NEW."grossMinor"-NEW."commissionMinor"
    OR NEW."holdUntil"<>NEW."completedAt"+make_interval(days=>p."holdDays") OR NEW."holdUntil">s."createdAt" THEN RAISE EXCEPTION 'settlement_item_ineligible_or_mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM "RefundRequest" r WHERE r."orderId"=ord.id) THEN RAISE EXCEPTION 'settlement_refund_reconciliation_required'; END IF;
  IF EXISTS (SELECT 1 FROM "VendorSettlementItem" i JOIN "VendorSettlement" os ON os.id=i."settlementId" WHERE i."suborderId"=NEW."suborderId" AND os.id<>s.id AND os.status<>'REJECTED') THEN RAISE EXCEPTION 'settlement_suborder_already_allocated'; END IF;
  IF ord."paymentMethod"='COD' THEN
    SELECT cc."amountMinor"-COALESCE((SELECT SUM(a."amountMinor") FROM "CodAllocation" a JOIN "CodDeposit" cd ON cd.id=a."depositId" WHERE a."collectionId"=cc.id AND cd.status='VERIFIED'),0) INTO due FROM "CodCollection" cc WHERE cc."deliveryId"=del.id;
    IF due IS NULL OR due<>0 THEN RAISE EXCEPTION 'settlement_cod_deposit_required'; END IF;
  ELSIF ord."paymentStatus"<>'PAYMENT_VERIFIED' THEN RAISE EXCEPTION 'settlement_payment_not_verified'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER vendor_settlement_item_guard BEFORE INSERT ON "VendorSettlementItem" FOR EACH ROW EXECUTE FUNCTION gs_vendor_settlement_item_guard();
CREATE TRIGGER vendor_settlement_item_append_only BEFORE UPDATE OR DELETE ON "VendorSettlementItem" FOR EACH ROW EXECUTE FUNCTION gs_append_only();
CREATE OR REPLACE FUNCTION gs_vendor_settlement_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "VendorSettlement"%ROWTYPE; n INTEGER; g BIGINT; c BIGINT; net BIGINT;
BEGIN
  SELECT * INTO s FROM "VendorSettlement" WHERE id=NEW.id;
  SELECT COUNT(*),COALESCE(SUM("grossMinor"),0),COALESCE(SUM("commissionMinor"),0),COALESCE(SUM("netMinor"),0) INTO n,g,c,net FROM "VendorSettlementItem" WHERE "settlementId"=s.id;
  IF n<1 OR n>100 OR g<>s."grossMinor" OR c<>s."commissionMinor" OR net<>s."netMinor" THEN RAISE EXCEPTION 'settlement_totals_mismatch'; END IF;
  IF s.status<>'PENDING_REVIEW' AND NOT EXISTS (SELECT 1 FROM "VendorSettlementReview" r WHERE r."settlementId"=s.id AND r."settlementVersion"=s.version) THEN RAISE EXCEPTION 'settlement_review_required'; END IF;
  IF s.status='APPROVED' THEN
    IF EXISTS (SELECT 1 FROM "VendorSettlementItem" i JOIN "VendorSuborder" sub ON sub.id=i."suborderId" JOIN "Order" o ON o.id=sub."orderId" LEFT JOIN "Delivery" d ON d."suborderId"=sub.id LEFT JOIN "CodCollection" cc ON cc."deliveryId"=d.id
      WHERE i."settlementId"=s.id AND (o."paymentMethod"<>'COD' OR cc.id IS NULL OR cc."amountMinor"<>COALESCE((SELECT SUM(a."amountMinor") FROM "CodAllocation" a JOIN "CodDeposit" cd ON cd.id=a."depositId" WHERE a."collectionId"=cc.id AND cd.status='VERIFIED'),0))) THEN RAISE EXCEPTION 'settlement_cod_deposit_required'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "LedgerLine" l JOIN "LedgerAccount" a ON a.id=l."accountId" WHERE l."journalId"=s."journalId" AND a.code='vendor-payable:'||s."vendorId"||':'||s.currency AND l.side='CREDIT' AND l."amountMinor"=s."netMinor") THEN RAISE EXCEPTION 'settlement_payable_journal_required'; END IF;
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER vendor_settlement_consistent AFTER INSERT OR UPDATE ON "VendorSettlement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_vendor_settlement_consistent();
CREATE OR REPLACE FUNCTION gs_vendor_settlement_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "VendorSettlement"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'settlement_write_privileged_only'; END IF;
  SELECT * INTO s FROM "VendorSettlement" WHERE id=NEW."settlementId";
  IF NOT FOUND OR s.version<>NEW."settlementVersion" OR s."reviewedByUserId"<>NEW."actorUserId" OR NEW."actorUserId"<>gs_current_user_id() OR NEW."actorUserId"=s."createdByUserId"
    OR NOT ((NEW.decision='APPROVE' AND s.status='APPROVED') OR (NEW.decision='REJECT' AND s.status='REJECTED')) THEN RAISE EXCEPTION 'settlement_review_mismatch'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER vendor_settlement_review_guard BEFORE INSERT ON "VendorSettlementReview" FOR EACH ROW EXECUTE FUNCTION gs_vendor_settlement_review_guard();
CREATE TRIGGER vendor_settlement_review_append_only BEFORE UPDATE OR DELETE ON "VendorSettlementReview" FOR EACH ROW EXECUTE FUNCTION gs_append_only();
CREATE TRIGGER vendor_settlement_no_delete BEFORE DELETE ON "VendorSettlement" FOR EACH ROW EXECUTE FUNCTION gs_append_only();
ALTER TABLE "VendorCommissionPolicy" ENABLE ROW LEVEL SECURITY; ALTER TABLE "VendorCommissionPolicy" FORCE ROW LEVEL SECURITY;
CREATE POLICY vendor_commission_policy_super_only ON "VendorCommissionPolicy" USING (gs_is_super()) WITH CHECK (gs_is_super());
ALTER TABLE "VendorSettlement" ENABLE ROW LEVEL SECURITY; ALTER TABLE "VendorSettlement" FORCE ROW LEVEL SECURITY;
CREATE POLICY vendor_settlement_select ON "VendorSettlement" FOR SELECT USING (gs_is_super() OR EXISTS (SELECT 1 FROM "Vendor" v WHERE v.id="vendorId" AND v."ownerUserId"=gs_current_user_id()));
CREATE POLICY vendor_settlement_super_insert ON "VendorSettlement" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY vendor_settlement_super_update ON "VendorSettlement" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());
ALTER TABLE "VendorSettlementItem" ENABLE ROW LEVEL SECURITY; ALTER TABLE "VendorSettlementItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY vendor_settlement_item_select ON "VendorSettlementItem" FOR SELECT USING (gs_is_super() OR EXISTS (SELECT 1 FROM "VendorSettlement" s JOIN "Vendor" v ON v.id=s."vendorId" WHERE s.id="settlementId" AND v."ownerUserId"=gs_current_user_id()));
CREATE POLICY vendor_settlement_item_super_insert ON "VendorSettlementItem" FOR INSERT WITH CHECK (gs_is_super());
ALTER TABLE "VendorSettlementReview" ENABLE ROW LEVEL SECURITY; ALTER TABLE "VendorSettlementReview" FORCE ROW LEVEL SECURITY;
CREATE POLICY vendor_settlement_review_super_only ON "VendorSettlementReview" USING (gs_is_super()) WITH CHECK (gs_is_super());
