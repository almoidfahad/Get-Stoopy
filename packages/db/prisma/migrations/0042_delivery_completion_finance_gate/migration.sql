-- COD completion is allowed only when the same transaction records immutable custody
-- and earning journals. The deferred trigger below proves those rows exist at COMMIT.
CREATE OR REPLACE FUNCTION gs_delivery_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "RiderAssignment"%ROWTYPE; s "VendorSuborder"%ROWTYPE; o "Order"%ROWTYPE; r "DeliveryRecipient"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'delivery_write_privileged_only'; END IF;
  SELECT * INTO a FROM "RiderAssignment" WHERE "id"=NEW."assignmentId";
  IF NOT FOUND OR a."riderId" <> NEW."riderId" OR a."suborderId" <> NEW."suborderId" OR a."countryId" <> NEW."countryId" THEN RAISE EXCEPTION 'delivery_assignment_mismatch'; END IF;
  SELECT * INTO s FROM "VendorSuborder" WHERE "id"=NEW."suborderId";
  SELECT * INTO o FROM "Order" WHERE "id"=s."orderId";
  SELECT * INTO r FROM "DeliveryRecipient" WHERE "id"=NEW."recipientId";
  IF NOT FOUND OR r."orderId" <> o."id" OR r."countryId" <> NEW."countryId" THEN RAISE EXCEPTION 'delivery_recipient_mismatch'; END IF;
  IF o."paymentStatus" NOT IN ('PAYMENT_VERIFIED','AWAITING_COD') THEN RAISE EXCEPTION 'delivery_payment_not_ready'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF a."status" <> 'ACTIVE' OR s."status" <> 'READY_FOR_PICKUP' THEN RAISE EXCEPTION 'delivery_not_ready_for_pickup'; END IF;
    IF NEW."status" <> 'PICKED_UP' OR NEW."version" <> 1 OR NEW."deliveredAt" IS NOT NULL OR NEW."completedAt" IS NOT NULL THEN RAISE EXCEPTION 'delivery_must_start_picked_up'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "RiderProfile" rp WHERE rp."id"=NEW."riderId" AND rp."userId"=gs_current_user_id()) THEN RAISE EXCEPTION 'delivery_actor_mismatch'; END IF;
  ELSE
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."assignmentId" IS DISTINCT FROM OLD."assignmentId" OR NEW."suborderId" IS DISTINCT FROM OLD."suborderId" OR NEW."riderId" IS DISTINCT FROM OLD."riderId" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."recipientId" IS DISTINCT FROM OLD."recipientId" OR NEW."pickupConfirmedAt" IS DISTINCT FROM OLD."pickupConfirmedAt" OR NEW."pickupCommandKey" IS DISTINCT FROM OLD."pickupCommandKey" OR NEW."pickupPayloadHash" IS DISTINCT FROM OLD."pickupPayloadHash" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN RAISE EXCEPTION 'delivery_immutable_fields'; END IF;
    IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'delivery_version_conflict'; END IF;
    IF NOT ((OLD."status"='PICKED_UP' AND NEW."status"='DELIVERED') OR (OLD."status"='DELIVERED' AND NEW."status"='COMPLETED')) THEN RAISE EXCEPTION 'delivery_invalid_transition'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "RiderProfile" rp WHERE rp."id"=NEW."riderId" AND rp."userId"=gs_current_user_id()) THEN RAISE EXCEPTION 'delivery_actor_mismatch'; END IF;
    IF NEW."status"='DELIVERED' THEN
      IF NEW."deliveredAt" IS NULL OR NEW."completedAt" IS NOT NULL THEN RAISE EXCEPTION 'delivery_delivered_metadata_required'; END IF;
      IF NOT EXISTS (SELECT 1 FROM "DeliveryProof" p WHERE p."deliveryId"=NEW."id") THEN RAISE EXCEPTION 'delivery_proof_required'; END IF;
    END IF;
    IF NEW."status"='COMPLETED' THEN
      IF NEW."completedAt" IS NULL OR NEW."deliveredAt" IS NULL OR NEW."completionCommandKey" IS NULL OR NEW."completionPayloadHash" IS NULL THEN RAISE EXCEPTION 'delivery_completion_metadata_required'; END IF;
      IF NOT EXISTS (SELECT 1 FROM "DeliveryProof" p WHERE p."deliveryId"=NEW."id") THEN RAISE EXCEPTION 'delivery_proof_required'; END IF;
      IF o."paymentMethod"='COD' THEN
        IF NOT EXISTS (SELECT 1 FROM "RiderRateSnapshot" rs WHERE rs."assignmentId"=NEW."assignmentId") THEN RAISE EXCEPTION 'rider_rate_snapshot_required'; END IF;
      ELSIF o."paymentStatus" <> 'PAYMENT_VERIFIED' THEN RAISE EXCEPTION 'payment_not_verified'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION gs_delivery_finance_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o "Order"%ROWTYPE;
BEGIN
  IF NEW."status" <> 'COMPLETED' THEN RETURN NULL; END IF;
  SELECT o.* INTO o FROM "Order" o JOIN "VendorSuborder" s ON s."orderId"=o."id" WHERE s."id"=NEW."suborderId";
  IF NOT EXISTS (SELECT 1 FROM "RiderEarning" e WHERE e."deliveryId"=NEW."id") THEN RAISE EXCEPTION 'delivery_earning_required'; END IF;
  IF o."paymentMethod"='COD' AND NOT EXISTS (SELECT 1 FROM "CodCollection" c WHERE c."deliveryId"=NEW."id") THEN RAISE EXCEPTION 'cod_accounting_required'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER delivery_finance_consistent AFTER UPDATE ON "Delivery" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_delivery_finance_consistent();
