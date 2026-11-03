-- Exclude the reviewed row from prior-adjustment sum; approval must count it exactly once.
CREATE OR REPLACE FUNCTION gs_adjustment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "VendorSettlement"%ROWTYPE; total BIGINT;
BEGIN
 IF NOT gs_is_super() THEN RAISE EXCEPTION 'finance_write_privileged_only'; END IF;
 SELECT * INTO s FROM "VendorSettlement" WHERE id=NEW."settlementId";
 IF NOT FOUND OR s.status<>'APPROVED' OR s."vendorId"<>NEW."vendorId" OR s."countryId"<>NEW."countryId" OR s.currency<>NEW.currency OR NEW."createdByUserId"<>gs_current_user_id() THEN RAISE EXCEPTION 'adjustment_scope_invalid'; END IF;
 IF EXISTS (SELECT 1 FROM "VendorPayout" p WHERE p."settlementId"=s.id) THEN RAISE EXCEPTION 'adjustment_payout_already_reserved'; END IF;
 SELECT s."netMinor"+COALESCE(SUM("amountMinor"),0) INTO total FROM "FinanceAdjustment" WHERE "settlementId"=s.id AND id<>NEW.id AND status='APPROVED';
 IF NEW.status='APPROVED' AND total+NEW."amountMinor" < 0 THEN RAISE EXCEPTION 'adjustment_negative_payable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'PENDING_REVIEW' OR NEW.version<>1 OR EXISTS (SELECT 1 FROM "Vendor" v WHERE v.id=NEW."vendorId" AND v."ownerUserId"=NEW."createdByUserId") THEN RAISE EXCEPTION 'adjustment_initial_or_self'; END IF;
 ELSE
  IF NEW.id<>OLD.id OR NEW."settlementId"<>OLD."settlementId" OR NEW."amountMinor"<>OLD."amountMinor" OR NEW."payloadHash"<>OLD."payloadHash" OR NEW."createdByUserId"<>OLD."createdByUserId" OR OLD.status<>'PENDING_REVIEW' OR NEW.status NOT IN ('APPROVED','REJECTED') OR NEW.version<>OLD.version+1 OR NEW."reviewedByUserId"=OLD."createdByUserId" OR NEW."reviewedByUserId"<>gs_current_user_id() THEN RAISE EXCEPTION 'adjustment_immutable_or_review'; END IF;
  IF NEW.status='APPROVED' AND NOT EXISTS (SELECT 1 FROM "LedgerLine" l JOIN "LedgerAccount" a ON a.id=l."accountId" WHERE l."journalId"=NEW."journalId" AND a.code='vendor-payable:'||s."vendorId"||':'||s.currency AND l."amountMinor"=abs(NEW."amountMinor") AND l.side=CASE WHEN NEW."amountMinor">0 THEN 'CREDIT'::"LedgerSide" ELSE 'DEBIT'::"LedgerSide" END) THEN RAISE EXCEPTION 'adjustment_journal_required'; END IF;
 END IF;
 RETURN NEW;
END; $$;
