-- Full-order pre-dispatch cancellation, linked restock and refund REVIEW only.
-- No provider refund, payout, ledger posting or money movement is enabled here.
ALTER TABLE "Order" ADD COLUMN "lifecycleStatus" "OrderLifecycleStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "InventoryMovement" ADD COLUMN "cancellationId" UUID;

CREATE TABLE "OrderCancellation" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "orderId" UUID NOT NULL UNIQUE REFERENCES "Order"(id),
  "buyerId" UUID NOT NULL REFERENCES "User"(id), "countryId" UUID NOT NULL REFERENCES "Country"(id),
  "commandKey" VARCHAR(128) NOT NULL, "payloadHash" VARCHAR(64) NOT NULL, reason VARCHAR(512) NOT NULL,
  "orderVersion" INTEGER NOT NULL, "paymentStatusAtCancellation" "OrderPaymentStatus" NOT NULL,
  "amountMinor" BIGINT NOT NULL CHECK ("amountMinor" > 0), currency VARCHAR(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE ("orderId","commandKey")
);
CREATE INDEX "OrderCancellation_buyerId_createdAt_idx" ON "OrderCancellation"("buyerId","createdAt");
CREATE INDEX "OrderCancellation_countryId_createdAt_idx" ON "OrderCancellation"("countryId","createdAt");
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_cancellationId_fkey" FOREIGN KEY ("cancellationId") REFERENCES "OrderCancellation"(id);
CREATE INDEX "InventoryMovement_cancellationId_idx" ON "InventoryMovement"("cancellationId");
CREATE UNIQUE INDEX "InventoryMovement_one_restock_per_reservation" ON "InventoryMovement"("reservationId") WHERE kind='RESTOCK';

CREATE TABLE "RefundRequest" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "cancellationId" UUID NOT NULL UNIQUE REFERENCES "OrderCancellation"(id),
  "orderId" UUID NOT NULL UNIQUE REFERENCES "Order"(id), "paymentIntentId" UUID NOT NULL UNIQUE REFERENCES "PaymentIntent"(id),
  "buyerId" UUID NOT NULL REFERENCES "User"(id), "countryId" UUID NOT NULL REFERENCES "Country"(id),
  "amountMinor" BIGINT NOT NULL CHECK ("amountMinor" > 0), currency VARCHAR(3) NOT NULL,
  status "RefundRequestStatus" NOT NULL DEFAULT 'PENDING_REVIEW', version INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "RefundRequest_countryId_status_createdAt_idx" ON "RefundRequest"("countryId",status,"createdAt");
CREATE INDEX "RefundRequest_buyerId_createdAt_idx" ON "RefundRequest"("buyerId","createdAt");
CREATE TABLE "RefundReview" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "refundRequestId" UUID NOT NULL UNIQUE REFERENCES "RefundRequest"(id),
  "reviewerUserId" UUID NOT NULL REFERENCES "User"(id), decision "RefundReviewDecision" NOT NULL,
  "refundVersion" INTEGER NOT NULL, "commandKey" VARCHAR(128) NOT NULL, "payloadHash" VARCHAR(64) NOT NULL,
  reason VARCHAR(512) NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("refundRequestId","commandKey")
);
CREATE INDEX "RefundReview_reviewerUserId_occurredAt_idx" ON "RefundReview"("reviewerUserId","occurredAt");

CREATE OR REPLACE FUNCTION gs_order_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'order_write_privileged_only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."publicReference" IS DISTINCT FROM OLD."publicReference" OR NEW."buyerId" IS DISTINCT FROM OLD."buyerId" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."destinationCityId" IS DISTINCT FROM OLD."destinationCityId" OR NEW."quoteId" IS DISTINCT FROM OLD."quoteId" OR NEW."commandKey" IS DISTINCT FROM OLD."commandKey" OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash" OR NEW."currency" IS DISTINCT FROM OLD."currency" OR NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor" OR NEW."pricingScope" IS DISTINCT FROM OLD."pricingScope" OR NEW."paymentMethod" IS DISTINCT FROM OLD."paymentMethod" OR NEW."codEligibility" IS DISTINCT FROM OLD."codEligibility" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'order_immutable_fields';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'order_version_conflict'; END IF;
  IF NEW."lifecycleStatus" IS DISTINCT FROM OLD."lifecycleStatus" THEN
    IF OLD."lifecycleStatus" <> 'ACTIVE' OR NEW."lifecycleStatus" <> 'CANCELLED' OR NEW."paymentStatus" IS DISTINCT FROM OLD."paymentStatus" THEN RAISE EXCEPTION 'order_invalid_lifecycle_transition'; END IF;
    IF NEW."paymentStatus" = 'AWAITING_PAYMENT' THEN RAISE EXCEPTION 'order_payment_resolution_required'; END IF;
  ELSE
    IF OLD."lifecycleStatus" <> 'ACTIVE' THEN RAISE EXCEPTION 'order_lifecycle_terminal'; END IF;
  IF OLD."paymentStatus" <> 'AWAITING_PAYMENT' OR NEW."paymentStatus" NOT IN ('PAYMENT_VERIFIED','PAYMENT_FAILED') THEN RAISE EXCEPTION 'order_payment_invalid_transition'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS order_update_guard ON "Order";
CREATE TRIGGER order_update_guard BEFORE UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION gs_order_update_guard();
CREATE OR REPLACE FUNCTION gs_suborder_readiness_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o "Order"%ROWTYPE; st "Store"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'suborder_write_privileged_only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."publicReference" IS DISTINCT FROM OLD."publicReference" OR NEW."orderId" IS DISTINCT FROM OLD."orderId" OR NEW."vendorId" IS DISTINCT FROM OLD."vendorId" OR NEW."storeId" IS DISTINCT FROM OLD."storeId" OR NEW."currency" IS DISTINCT FROM OLD."currency" OR NEW."subtotalMinor" IS DISTINCT FROM OLD."subtotalMinor" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'suborder_immutable_fields';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'suborder_version_conflict'; END IF;
  IF NOT ((OLD."status" = 'PENDING_VENDOR' AND NEW."status" IN ('ACCEPTED','REJECTED'))
       OR (OLD."status" = 'ACCEPTED' AND NEW."status" = 'PREPARING')
       OR (OLD."status" = 'PREPARING' AND NEW."status" = 'READY_FOR_PICKUP')
       OR (OLD."status" IN ('PENDING_VENDOR','REJECTED') AND NEW."status" = 'CANCELLED')) THEN
    RAISE EXCEPTION 'suborder_invalid_transition';
  END IF;
  SELECT * INTO o FROM "Order" WHERE "id" = NEW."orderId";
  IF NOT FOUND THEN RAISE EXCEPTION 'suborder_order_missing'; END IF;
  IF NEW."status" = 'CANCELLED' THEN
    IF o."lifecycleStatus" <> 'CANCELLED' THEN RAISE EXCEPTION 'suborder_cancel_requires_order_cancel'; END IF;
  ELSE
  IF o."lifecycleStatus" <> 'ACTIVE' THEN RAISE EXCEPTION 'suborder_order_not_active'; END IF;
  IF o."paymentStatus" NOT IN ('PAYMENT_VERIFIED','AWAITING_COD') THEN RAISE EXCEPTION 'suborder_payment_not_ready'; END IF;
  SELECT * INTO st FROM "Store" WHERE "id" = NEW."storeId";
  IF NOT FOUND OR st."status" <> 'ACTIVE' OR NOT gs_inventory_vendor_eligible(NEW."vendorId") THEN RAISE EXCEPTION 'suborder_store_vendor_not_eligible'; END IF;
  END IF;

  IF NEW."acceptedAt" IS DISTINCT FROM OLD."acceptedAt" AND NOT (OLD."status" = 'PENDING_VENDOR' AND NEW."status" = 'ACCEPTED') THEN RAISE EXCEPTION 'suborder_accepted_at_immutable'; END IF;
  IF NEW."acceptedByUserId" IS DISTINCT FROM OLD."acceptedByUserId" AND NOT (OLD."status" = 'PENDING_VENDOR' AND NEW."status" = 'ACCEPTED') THEN RAISE EXCEPTION 'suborder_accepted_by_immutable'; END IF;
  IF NEW."preparationMinutes" IS DISTINCT FROM OLD."preparationMinutes" AND NOT (OLD."status" = 'PENDING_VENDOR' AND NEW."status" = 'ACCEPTED') THEN RAISE EXCEPTION 'suborder_preparation_minutes_immutable'; END IF;
  IF NEW."preparationStartedAt" IS DISTINCT FROM OLD."preparationStartedAt" AND NOT (OLD."status" = 'ACCEPTED' AND NEW."status" = 'PREPARING') THEN RAISE EXCEPTION 'suborder_preparation_started_immutable'; END IF;
  IF NEW."readyConfirmedAt" IS DISTINCT FROM OLD."readyConfirmedAt" AND NOT (OLD."status" = 'PREPARING' AND NEW."status" = 'READY_FOR_PICKUP') THEN RAISE EXCEPTION 'suborder_ready_at_immutable'; END IF;
  IF NEW."readyConfirmedByUserId" IS DISTINCT FROM OLD."readyConfirmedByUserId" AND NOT (OLD."status" = 'PREPARING' AND NEW."status" = 'READY_FOR_PICKUP') THEN RAISE EXCEPTION 'suborder_ready_by_immutable'; END IF;
  IF NEW."rejectedAt" IS DISTINCT FROM OLD."rejectedAt" AND NOT (OLD."status" = 'PENDING_VENDOR' AND NEW."status" = 'REJECTED') THEN RAISE EXCEPTION 'suborder_rejected_at_immutable'; END IF;
  IF NEW."rejectedByUserId" IS DISTINCT FROM OLD."rejectedByUserId" AND NOT (OLD."status" = 'PENDING_VENDOR' AND NEW."status" = 'REJECTED') THEN RAISE EXCEPTION 'suborder_rejected_by_immutable'; END IF;
  IF NEW."rejectionReason" IS DISTINCT FROM OLD."rejectionReason" AND NOT (OLD."status" = 'PENDING_VENDOR' AND NEW."status" = 'REJECTED') THEN RAISE EXCEPTION 'suborder_rejection_reason_immutable'; END IF;

  IF NEW."status" = 'ACCEPTED' THEN
    IF NEW."acceptedAt" IS NULL OR NEW."acceptedByUserId" IS NULL OR NEW."preparationMinutes" IS NULL THEN RAISE EXCEPTION 'suborder_accept_metadata_required'; END IF;
    IF NEW."acceptedByUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'suborder_actor_mismatch'; END IF;
    IF NEW."preparationStartedAt" IS NOT NULL OR NEW."readyConfirmedAt" IS NOT NULL OR NEW."rejectedAt" IS NOT NULL THEN RAISE EXCEPTION 'suborder_accept_future_metadata'; END IF;
  ELSIF NEW."status" = 'REJECTED' THEN
    IF NEW."rejectedAt" IS NULL OR NEW."rejectedByUserId" IS NULL OR NEW."rejectionReason" IS NULL THEN RAISE EXCEPTION 'suborder_reject_metadata_required'; END IF;
    IF NEW."rejectedByUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'suborder_actor_mismatch'; END IF;
    IF NEW."acceptedAt" IS NOT NULL OR NEW."preparationStartedAt" IS NOT NULL OR NEW."readyConfirmedAt" IS NOT NULL THEN RAISE EXCEPTION 'suborder_reject_future_metadata'; END IF;
  ELSIF NEW."status" = 'PREPARING' THEN
    IF NEW."preparationStartedAt" IS NULL OR NEW."acceptedAt" IS NULL OR NEW."preparationMinutes" IS NULL THEN RAISE EXCEPTION 'suborder_preparation_metadata_required'; END IF;
    IF NEW."preparationStartedAt" < NEW."acceptedAt" THEN RAISE EXCEPTION 'suborder_preparation_before_accept'; END IF;
    IF NEW."readyConfirmedAt" IS NOT NULL OR NEW."rejectedAt" IS NOT NULL THEN RAISE EXCEPTION 'suborder_preparation_future_metadata'; END IF;
  ELSIF NEW."status" = 'READY_FOR_PICKUP' THEN
    IF NEW."readyConfirmedAt" IS NULL OR NEW."readyConfirmedByUserId" IS NULL OR NEW."preparationStartedAt" IS NULL THEN RAISE EXCEPTION 'suborder_ready_metadata_required'; END IF;
    IF NEW."readyConfirmedByUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'suborder_actor_mismatch'; END IF;
    IF NEW."readyConfirmedAt" < NEW."preparationStartedAt" THEN RAISE EXCEPTION 'suborder_ready_before_preparation'; END IF;
    IF NEW."rejectedAt" IS NOT NULL THEN RAISE EXCEPTION 'suborder_ready_future_metadata'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS suborder_readiness_guard ON "VendorSuborder";
CREATE TRIGGER suborder_readiness_guard BEFORE UPDATE ON "VendorSuborder" FOR EACH ROW EXECUTE FUNCTION gs_suborder_readiness_guard();
CREATE OR REPLACE FUNCTION gs_suborder_status_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "VendorSuborder"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'suborder_write_privileged_only'; END IF;
  SELECT * INTO s FROM "VendorSuborder" WHERE "id" = NEW."suborderId";
  IF NOT FOUND OR s."status" <> NEW."toStatus" OR s."version" <> NEW."suborderVersion" THEN RAISE EXCEPTION 'suborder_status_event_mismatch'; END IF;
  IF NEW."actorUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'suborder_actor_mismatch'; END IF;
  IF NOT ((NEW."fromStatus" = 'PENDING_VENDOR' AND NEW."toStatus" IN ('ACCEPTED','REJECTED'))
       OR (NEW."fromStatus" = 'ACCEPTED' AND NEW."toStatus" = 'PREPARING')
       OR (NEW."fromStatus" = 'PREPARING' AND NEW."toStatus" = 'READY_FOR_PICKUP')
       OR (NEW."fromStatus" IN ('PENDING_VENDOR','REJECTED') AND NEW."toStatus" = 'CANCELLED')) THEN
    RAISE EXCEPTION 'suborder_status_event_invalid_transition';
  END IF;
  IF NEW."toStatus" = 'ACCEPTED' AND (NEW."preparationMinutes" IS NULL OR NEW."preparationMinutes" <> s."preparationMinutes") THEN RAISE EXCEPTION 'suborder_status_event_preparation_mismatch'; END IF;
  IF NEW."toStatus" = 'REJECTED' AND (NEW."reason" IS NULL OR NEW."reason" <> s."rejectionReason") THEN RAISE EXCEPTION 'suborder_status_event_reason_mismatch'; END IF;
  IF NEW."toStatus" = 'CANCELLED' AND NEW."reason" IS NULL THEN RAISE EXCEPTION 'suborder_cancel_reason_required'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS suborder_status_event_guard ON "VendorSuborderStatusEvent";
CREATE TRIGGER suborder_status_event_guard BEFORE INSERT ON "VendorSuborderStatusEvent" FOR EACH ROW EXECUTE FUNCTION gs_suborder_status_event_guard();
CREATE OR REPLACE FUNCTION gs_inventory_movement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i "Inventory"%ROWTYPE; r "InventoryReservation"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'inventory_write_privileged_only'; END IF;
  IF length(trim(NEW."commandKey")) < 8 OR NEW."commandKey" !~ '^[A-Za-z0-9:_-]{8,128}$' THEN RAISE EXCEPTION 'inventory_command_key_invalid'; END IF;
  SELECT * INTO i FROM "Inventory" WHERE "id" = NEW."inventoryId";
  IF NOT FOUND OR i."version" <> NEW."inventoryVersion" OR i."onHand" <> NEW."onHandAfter" OR i."reserved" <> NEW."reservedAfter" THEN
    RAISE EXCEPTION 'inventory_movement_version_mismatch';
  END IF;
  IF NEW."kind" = 'RESTOCK' THEN
    IF NEW."reservationId" IS NULL OR NEW."cancellationId" IS NULL THEN RAISE EXCEPTION 'inventory_restock_link_required'; END IF;
    SELECT * INTO r FROM "InventoryReservation" WHERE "id" = NEW."reservationId";
    IF NOT FOUND OR r."inventoryId" <> NEW."inventoryId" OR r."state" <> 'CONSUMED' THEN RAISE EXCEPTION 'inventory_restock_reservation_invalid'; END IF;
    IF NEW."onHandDelta" <> r."quantity" OR NEW."reservedDelta" <> 0 THEN RAISE EXCEPTION 'inventory_restock_deltas_invalid'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "OrderCancellation" c
      JOIN "Order" o ON o."id" = c."orderId" AND o."lifecycleStatus" = 'CANCELLED'
      JOIN "VendorSuborder" s ON s."orderId" = o."id" AND s."status" = 'CANCELLED'
      JOIN "OrderItem" oi ON oi."suborderId" = s."id"
      JOIN "CheckoutQuoteItem" qi ON qi."id" = oi."quoteItemId" AND qi."reservationId" = r."id"
      WHERE c."id" = NEW."cancellationId" AND oi."quantity" = r."quantity"
    ) THEN RAISE EXCEPTION 'inventory_restock_cancellation_mismatch'; END IF;
  ELSE
    IF NEW."cancellationId" IS NOT NULL THEN RAISE EXCEPTION 'inventory_cancellation_link_invalid'; END IF;
  IF NEW."kind" = 'ADJUST' THEN
    IF NEW."reservationId" IS NOT NULL OR NEW."reservedDelta" <> 0 OR NEW."onHandDelta" = 0 THEN RAISE EXCEPTION 'inventory_movement_deltas_invalid'; END IF;
  ELSE
    IF NEW."reservationId" IS NULL THEN RAISE EXCEPTION 'inventory_movement_reservation_required'; END IF;
    SELECT * INTO r FROM "InventoryReservation" WHERE "id" = NEW."reservationId";
    IF NOT FOUND OR r."inventoryId" <> NEW."inventoryId" THEN RAISE EXCEPTION 'inventory_movement_reservation_mismatch'; END IF;
    IF NEW."kind" = 'RESERVE' AND (NEW."onHandDelta" <> 0 OR NEW."reservedDelta" <> r."quantity" OR r."state" <> 'ACTIVE') THEN RAISE EXCEPTION 'inventory_movement_deltas_invalid'; END IF;
    IF NEW."kind" IN ('RELEASE','EXPIRE') AND (NEW."onHandDelta" <> 0 OR NEW."reservedDelta" <> -r."quantity" OR r."state" <> CASE NEW."kind" WHEN 'RELEASE' THEN 'RELEASED'::"InventoryReservationState" ELSE 'EXPIRED'::"InventoryReservationState" END) THEN RAISE EXCEPTION 'inventory_movement_deltas_invalid'; END IF;
    IF NEW."kind" = 'CONSUME' AND (NEW."onHandDelta" <> -r."quantity" OR NEW."reservedDelta" <> -r."quantity" OR r."state" <> 'CONSUMED') THEN RAISE EXCEPTION 'inventory_movement_deltas_invalid'; END IF;
  END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS inventory_movement_guard ON "InventoryMovement";
CREATE TRIGGER inventory_movement_guard BEFORE INSERT ON "InventoryMovement" FOR EACH ROW EXECUTE FUNCTION gs_inventory_movement_guard();
CREATE OR REPLACE FUNCTION gs_payment_intent_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o "Order"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'payment_write_privileged_only'; END IF;
  IF NEW."provider" <> 'SANDBOX_MANUAL' OR NEW."environment" <> 'SANDBOX' THEN RAISE EXCEPTION 'payment_provider_disabled'; END IF;
  IF NEW."status" <> 'PENDING' OR NEW."version" <> 1 OR NEW."closedAt" IS NOT NULL THEN RAISE EXCEPTION 'payment_intent_must_start_pending'; END IF;
  SELECT * INTO o FROM "Order" WHERE "id" = NEW."orderId";
  IF NOT FOUND OR o."lifecycleStatus" <> 'ACTIVE' OR o."buyerId" <> NEW."userId" THEN RAISE EXCEPTION 'payment_order_ownership_mismatch'; END IF;
  IF o."paymentMethod" <> 'SANDBOX_MANUAL' OR o."paymentStatus" <> 'AWAITING_PAYMENT' THEN RAISE EXCEPTION 'payment_order_not_payable'; END IF;
  IF NEW."amountMinor" <> o."amountMinor" OR NEW."currency" <> o."currency" THEN RAISE EXCEPTION 'payment_amount_mismatch'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS payment_intent_insert_guard ON "PaymentIntent";
CREATE TRIGGER payment_intent_insert_guard BEFORE INSERT ON "PaymentIntent" FOR EACH ROW EXECUTE FUNCTION gs_payment_intent_insert_guard();

CREATE OR REPLACE FUNCTION gs_order_cancellation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o "Order"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'cancellation_write_privileged_only'; END IF;
  SELECT * INTO o FROM "Order" WHERE "id" = NEW."orderId";
  IF NOT FOUND OR o."lifecycleStatus" <> 'CANCELLED' OR o."version" <> NEW."orderVersion" THEN RAISE EXCEPTION 'cancellation_order_mismatch'; END IF;
  IF NEW."buyerId" <> o."buyerId" OR NEW."countryId" <> o."countryId" OR NEW."amountMinor" <> o."amountMinor" OR NEW."currency" <> o."currency" OR NEW."paymentStatusAtCancellation" <> o."paymentStatus" THEN RAISE EXCEPTION 'cancellation_snapshot_mismatch'; END IF;
  IF NEW."commandKey" !~ '^[A-Za-z0-9:_-]{8,128}$' OR length(trim(NEW.reason)) < 8 THEN RAISE EXCEPTION 'cancellation_command_invalid'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER order_cancellation_guard BEFORE INSERT ON "OrderCancellation" FOR EACH ROW EXECUTE FUNCTION gs_order_cancellation_guard();
CREATE TRIGGER order_cancellation_append_only BEFORE UPDATE OR DELETE ON "OrderCancellation" FOR EACH ROW EXECUTE FUNCTION gs_append_only();

CREATE OR REPLACE FUNCTION gs_order_cancellation_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o "Order"%ROWTYPE; c "OrderCancellation"%ROWTYPE; bad INTEGER; refund_count INTEGER;
BEGIN
  SELECT * INTO o FROM "Order" WHERE "id" = NEW."id";
  IF o."lifecycleStatus" = 'ACTIVE' THEN
    IF EXISTS (SELECT 1 FROM "OrderCancellation" WHERE "orderId" = o."id") THEN RAISE EXCEPTION 'active_order_has_cancellation'; END IF;
    RETURN NULL;
  END IF;
  SELECT * INTO c FROM "OrderCancellation" WHERE "orderId" = o."id";
  IF NOT FOUND THEN RAISE EXCEPTION 'order_cancellation_record_required'; END IF;
  IF EXISTS (SELECT 1 FROM "VendorSuborder" WHERE "orderId" = o."id" AND "status" <> 'CANCELLED') THEN RAISE EXCEPTION 'order_cancellation_suborders_incomplete'; END IF;
  IF EXISTS (SELECT 1 FROM "DispatchRun" WHERE "suborderId" IN (SELECT id FROM "VendorSuborder" WHERE "orderId" = o."id")) THEN RAISE EXCEPTION 'order_cancellation_dispatch_exists'; END IF;
  SELECT count(*) INTO bad FROM "OrderItem" oi JOIN "VendorSuborder" s ON s."id"=oi."suborderId"
    JOIN "CheckoutQuoteItem" qi ON qi."id"=oi."quoteItemId"
    WHERE s."orderId"=o."id" AND NOT EXISTS (
      SELECT 1 FROM "InventoryMovement" m WHERE m."reservationId"=qi."reservationId" AND m.kind='RESTOCK' AND m."cancellationId"=c.id
    );
  IF bad > 0 THEN RAISE EXCEPTION 'order_cancellation_restock_incomplete'; END IF;
  SELECT count(*) INTO refund_count FROM "RefundRequest" WHERE "orderId"=o."id";
  IF (o."paymentStatus"='PAYMENT_VERIFIED' AND refund_count <> 1) OR (o."paymentStatus"<>'PAYMENT_VERIFIED' AND refund_count <> 0) THEN RAISE EXCEPTION 'order_cancellation_refund_mismatch'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER order_cancellation_consistent AFTER UPDATE ON "Order" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_order_cancellation_consistent();

CREATE OR REPLACE FUNCTION gs_refund_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "OrderCancellation"%ROWTYPE; o "Order"%ROWTYPE; p "PaymentIntent"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'refund_write_privileged_only'; END IF;
  IF NEW.status <> 'PENDING_REVIEW' OR NEW.version <> 1 THEN RAISE EXCEPTION 'refund_must_start_pending'; END IF;
  SELECT * INTO c FROM "OrderCancellation" WHERE "id"=NEW."cancellationId";
  SELECT * INTO o FROM "Order" WHERE "id"=NEW."orderId";
  SELECT * INTO p FROM "PaymentIntent" WHERE "id"=NEW."paymentIntentId";
  IF NOT FOUND OR c."orderId" <> o."id" OR o."lifecycleStatus" <> 'CANCELLED' OR o."paymentStatus" <> 'PAYMENT_VERIFIED' THEN RAISE EXCEPTION 'refund_cancellation_invalid'; END IF;
  IF p."orderId" <> o."id" OR p."status" <> 'VERIFIED' OR p."amountMinor" <> o."amountMinor" OR p."currency" <> o."currency" THEN RAISE EXCEPTION 'refund_payment_snapshot_mismatch'; END IF;
  IF NEW."buyerId" <> o."buyerId" OR NEW."countryId" <> o."countryId" OR NEW."amountMinor" <> o."amountMinor" OR NEW."currency" <> o."currency" THEN RAISE EXCEPTION 'refund_snapshot_mismatch'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER refund_request_guard BEFORE INSERT ON "RefundRequest" FOR EACH ROW EXECUTE FUNCTION gs_refund_request_guard();

CREATE OR REPLACE FUNCTION gs_refund_request_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'refund_write_privileged_only'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW."cancellationId" IS DISTINCT FROM OLD."cancellationId" OR NEW."orderId" IS DISTINCT FROM OLD."orderId" OR NEW."paymentIntentId" IS DISTINCT FROM OLD."paymentIntentId" OR NEW."buyerId" IS DISTINCT FROM OLD."buyerId" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor" OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN RAISE EXCEPTION 'refund_immutable_fields'; END IF;
  IF OLD.status <> 'PENDING_REVIEW' OR NEW.status NOT IN ('APPROVED','REJECTED') OR NEW.version <> OLD.version+1 THEN RAISE EXCEPTION 'refund_invalid_transition'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER refund_request_update_guard BEFORE UPDATE ON "RefundRequest" FOR EACH ROW EXECUTE FUNCTION gs_refund_request_update_guard();

CREATE OR REPLACE FUNCTION gs_refund_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "RefundRequest"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'refund_write_privileged_only'; END IF;
  SELECT * INTO r FROM "RefundRequest" WHERE "id"=NEW."refundRequestId";
  IF NOT FOUND OR r.version <> NEW."refundVersion" THEN RAISE EXCEPTION 'refund_review_mismatch'; END IF;
  IF (NEW.decision = 'APPROVE' AND r.status <> 'APPROVED') OR (NEW.decision = 'REJECT' AND r.status <> 'REJECTED') THEN RAISE EXCEPTION 'refund_review_mismatch'; END IF;
  IF NEW."reviewerUserId" <> gs_current_user_id() OR NEW."reviewerUserId" = r."buyerId" THEN RAISE EXCEPTION 'refund_reviewer_invalid'; END IF;
  IF NEW."commandKey" !~ '^[A-Za-z0-9:_-]{8,128}$' OR length(trim(NEW.reason)) < 8 THEN RAISE EXCEPTION 'refund_review_command_invalid'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER refund_review_guard BEFORE INSERT ON "RefundReview" FOR EACH ROW EXECUTE FUNCTION gs_refund_review_guard();
CREATE TRIGGER refund_review_append_only BEFORE UPDATE OR DELETE ON "RefundReview" FOR EACH ROW EXECUTE FUNCTION gs_append_only();
CREATE OR REPLACE FUNCTION gs_refund_review_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "RefundReview" WHERE "refundRequestId"=NEW.id AND "refundVersion"=NEW.version) THEN RAISE EXCEPTION 'refund_review_required'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER refund_review_required AFTER UPDATE ON "RefundRequest" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_refund_review_required();

ALTER TABLE "OrderCancellation" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OrderCancellation" FORCE ROW LEVEL SECURITY;
CREATE POLICY cancellation_select_buyer_or_super ON "OrderCancellation" FOR SELECT USING (gs_is_super() OR "buyerId"=gs_current_user_id());
CREATE POLICY cancellation_insert_super ON "OrderCancellation" FOR INSERT WITH CHECK (gs_is_super());
ALTER TABLE "RefundRequest" ENABLE ROW LEVEL SECURITY; ALTER TABLE "RefundRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY refund_select_buyer_or_super ON "RefundRequest" FOR SELECT USING (gs_is_super() OR "buyerId"=gs_current_user_id());
CREATE POLICY refund_insert_super ON "RefundRequest" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY refund_update_super ON "RefundRequest" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());
ALTER TABLE "RefundReview" ENABLE ROW LEVEL SECURITY; ALTER TABLE "RefundReview" FORCE ROW LEVEL SECURITY;
CREATE POLICY refund_review_super_only ON "RefundReview" FOR SELECT USING (gs_is_super());
CREATE POLICY refund_review_insert_super ON "RefundReview" FOR INSERT WITH CHECK (gs_is_super());
