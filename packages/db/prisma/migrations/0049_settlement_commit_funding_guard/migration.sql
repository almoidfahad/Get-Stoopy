-- Additive COMMIT-time recheck: homogeneous funding source and current eligibility. No historical migration is edited.
CREATE OR REPLACE FUNCTION gs_vendor_settlement_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "VendorSettlement"%ROWTYPE; n INTEGER; g BIGINT; c BIGINT; net BIGINT;
BEGIN
  SELECT * INTO s FROM "VendorSettlement" WHERE id=NEW.id;
  SELECT COUNT(*),COALESCE(SUM("grossMinor"),0),COALESCE(SUM("commissionMinor"),0),COALESCE(SUM("netMinor"),0) INTO n,g,c,net FROM "VendorSettlementItem" WHERE "settlementId"=s.id;
  IF n<1 OR n>100 OR g<>s."grossMinor" OR c<>s."commissionMinor" OR net<>s."netMinor" THEN RAISE EXCEPTION 'settlement_totals_mismatch'; END IF;
  IF s.status<>'PENDING_REVIEW' AND NOT EXISTS (SELECT 1 FROM "VendorSettlementReview" r WHERE r."settlementId"=s.id AND r."settlementVersion"=s.version) THEN RAISE EXCEPTION 'settlement_review_required'; END IF;
  IF s.status='APPROVED' THEN
    IF (SELECT COUNT(DISTINCT o."paymentMethod") FROM "VendorSettlementItem" i JOIN "VendorSuborder" sub ON sub.id=i."suborderId" JOIN "Order" o ON o.id=sub."orderId" WHERE i."settlementId"=s.id)<>1 THEN RAISE EXCEPTION 'settlement_funding_source_mixed'; END IF;
    IF EXISTS (SELECT 1 FROM "VendorSettlementItem" i JOIN "VendorSuborder" sub ON sub.id=i."suborderId" JOIN "Order" o ON o.id=sub."orderId" LEFT JOIN "Delivery" d ON d."suborderId"=sub.id
      WHERE i."settlementId"=s.id AND (sub.status<>'COMPLETED' OR o."lifecycleStatus"<>'ACTIVE' OR d.status<>'COMPLETED' OR i."holdUntil">s."reviewedAt"
        OR EXISTS (SELECT 1 FROM "RefundRequest" r WHERE r."orderId"=o.id) OR (o."paymentMethod"<>'COD' AND o."paymentStatus"<>'PAYMENT_VERIFIED'))) THEN RAISE EXCEPTION 'settlement_commit_eligibility_changed'; END IF;
    IF EXISTS (SELECT 1 FROM "VendorSettlementItem" i JOIN "VendorSuborder" sub ON sub.id=i."suborderId" JOIN "Order" o ON o.id=sub."orderId" LEFT JOIN "Delivery" d ON d."suborderId"=sub.id LEFT JOIN "CodCollection" cc ON cc."deliveryId"=d.id
      WHERE i."settlementId"=s.id AND (o."paymentMethod"<>'COD' OR cc.id IS NULL OR cc."amountMinor"<>COALESCE((SELECT SUM(a."amountMinor") FROM "CodAllocation" a JOIN "CodDeposit" cd ON cd.id=a."depositId" WHERE a."collectionId"=cc.id AND cd.status='VERIFIED'),0))) THEN RAISE EXCEPTION 'settlement_cod_deposit_required'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "LedgerLine" l JOIN "LedgerAccount" a ON a.id=l."accountId" WHERE l."journalId"=s."journalId" AND a.code='vendor-payable:'||s."vendorId"||':'||s.currency AND l.side='CREDIT' AND l."amountMinor"=s."netMinor") THEN RAISE EXCEPTION 'settlement_payable_journal_required'; END IF;
  END IF;
  RETURN NULL;
END; $$;
