-- Additive correction: 0038 replaced the readiness guard from 0026 and unintentionally
-- omitted the delivery transitions introduced by 0032. Restore the full 0032 state
-- machine and add only the pre-dispatch CANCELLED branch. Applied migrations stay frozen.
CREATE OR REPLACE FUNCTION gs_suborder_readiness_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o "Order"%ROWTYPE; st "Store"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'suborder_write_privileged_only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."publicReference" IS DISTINCT FROM OLD."publicReference" OR NEW."orderId" IS DISTINCT FROM OLD."orderId" OR NEW."vendorId" IS DISTINCT FROM OLD."vendorId" OR NEW."storeId" IS DISTINCT FROM OLD."storeId" OR NEW."currency" IS DISTINCT FROM OLD."currency" OR NEW."subtotalMinor" IS DISTINCT FROM OLD."subtotalMinor" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN RAISE EXCEPTION 'suborder_immutable_fields'; END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'suborder_version_conflict'; END IF;
  IF NOT ((OLD."status"='PENDING_VENDOR' AND NEW."status" IN ('ACCEPTED','REJECTED')) OR (OLD."status"='ACCEPTED' AND NEW."status"='PREPARING') OR (OLD."status"='PREPARING' AND NEW."status"='READY_FOR_PICKUP') OR (OLD."status"='READY_FOR_PICKUP' AND NEW."status"='FULFILLING') OR (OLD."status"='FULFILLING' AND NEW."status"='DELIVERED') OR (OLD."status"='DELIVERED' AND NEW."status"='COMPLETED') OR (OLD."status" IN ('PENDING_VENDOR','REJECTED') AND NEW."status"='CANCELLED')) THEN RAISE EXCEPTION 'suborder_invalid_transition'; END IF;
  SELECT * INTO o FROM "Order" WHERE "id"=NEW."orderId";
  IF NOT FOUND THEN RAISE EXCEPTION 'suborder_order_missing'; END IF;
  IF NEW."status"='CANCELLED' THEN
    IF o."lifecycleStatus" <> 'CANCELLED' THEN RAISE EXCEPTION 'suborder_cancel_requires_order_cancel'; END IF;
  ELSE
  IF o."lifecycleStatus" <> 'ACTIVE' THEN RAISE EXCEPTION 'suborder_order_not_active'; END IF;
  IF o."paymentStatus" NOT IN ('PAYMENT_VERIFIED','AWAITING_COD') THEN RAISE EXCEPTION 'suborder_payment_not_ready'; END IF;
  SELECT * INTO st FROM "Store" WHERE "id"=NEW."storeId";
  IF NOT FOUND OR st."status" <> 'ACTIVE' OR NOT gs_inventory_vendor_eligible(NEW."vendorId") THEN RAISE EXCEPTION 'suborder_store_vendor_not_eligible'; END IF;
  END IF;
  IF NEW."acceptedAt" IS DISTINCT FROM OLD."acceptedAt" AND NOT (OLD."status"='PENDING_VENDOR' AND NEW."status"='ACCEPTED') THEN RAISE EXCEPTION 'suborder_accepted_at_immutable'; END IF;
  IF NEW."acceptedByUserId" IS DISTINCT FROM OLD."acceptedByUserId" AND NOT (OLD."status"='PENDING_VENDOR' AND NEW."status"='ACCEPTED') THEN RAISE EXCEPTION 'suborder_accepted_by_immutable'; END IF;
  IF NEW."preparationMinutes" IS DISTINCT FROM OLD."preparationMinutes" AND NOT (OLD."status"='PENDING_VENDOR' AND NEW."status"='ACCEPTED') THEN RAISE EXCEPTION 'suborder_preparation_minutes_immutable'; END IF;
  IF NEW."preparationStartedAt" IS DISTINCT FROM OLD."preparationStartedAt" AND NOT (OLD."status"='ACCEPTED' AND NEW."status"='PREPARING') THEN RAISE EXCEPTION 'suborder_preparation_started_immutable'; END IF;
  IF NEW."readyConfirmedAt" IS DISTINCT FROM OLD."readyConfirmedAt" AND NOT (OLD."status"='PREPARING' AND NEW."status"='READY_FOR_PICKUP') THEN RAISE EXCEPTION 'suborder_ready_at_immutable'; END IF;
  IF NEW."readyConfirmedByUserId" IS DISTINCT FROM OLD."readyConfirmedByUserId" AND NOT (OLD."status"='PREPARING' AND NEW."status"='READY_FOR_PICKUP') THEN RAISE EXCEPTION 'suborder_ready_by_immutable'; END IF;
  IF NEW."rejectedAt" IS DISTINCT FROM OLD."rejectedAt" AND NOT (OLD."status"='PENDING_VENDOR' AND NEW."status"='REJECTED') THEN RAISE EXCEPTION 'suborder_rejected_at_immutable'; END IF;
  IF NEW."rejectedByUserId" IS DISTINCT FROM OLD."rejectedByUserId" AND NOT (OLD."status"='PENDING_VENDOR' AND NEW."status"='REJECTED') THEN RAISE EXCEPTION 'suborder_rejected_by_immutable'; END IF;
  IF NEW."rejectionReason" IS DISTINCT FROM OLD."rejectionReason" AND NOT (OLD."status"='PENDING_VENDOR' AND NEW."status"='REJECTED') THEN RAISE EXCEPTION 'suborder_rejection_reason_immutable'; END IF;
  IF NEW."status"='ACCEPTED' THEN
    IF NEW."acceptedAt" IS NULL OR NEW."acceptedByUserId" IS NULL OR NEW."preparationMinutes" IS NULL THEN RAISE EXCEPTION 'suborder_accept_metadata_required'; END IF;
    IF NEW."acceptedByUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'suborder_actor_mismatch'; END IF;
    IF NEW."preparationStartedAt" IS NOT NULL OR NEW."readyConfirmedAt" IS NOT NULL OR NEW."rejectedAt" IS NOT NULL THEN RAISE EXCEPTION 'suborder_accept_future_metadata'; END IF;
  ELSIF NEW."status"='REJECTED' THEN
    IF NEW."rejectedAt" IS NULL OR NEW."rejectedByUserId" IS NULL OR NEW."rejectionReason" IS NULL THEN RAISE EXCEPTION 'suborder_reject_metadata_required'; END IF;
    IF NEW."rejectedByUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'suborder_actor_mismatch'; END IF;
    IF NEW."acceptedAt" IS NOT NULL OR NEW."preparationStartedAt" IS NOT NULL OR NEW."readyConfirmedAt" IS NOT NULL THEN RAISE EXCEPTION 'suborder_reject_future_metadata'; END IF;
  ELSIF NEW."status"='PREPARING' THEN
    IF NEW."preparationStartedAt" IS NULL OR NEW."acceptedAt" IS NULL OR NEW."preparationMinutes" IS NULL THEN RAISE EXCEPTION 'suborder_preparation_metadata_required'; END IF;
    IF NEW."readyConfirmedAt" IS NOT NULL OR NEW."rejectedAt" IS NOT NULL THEN RAISE EXCEPTION 'suborder_preparation_future_metadata'; END IF;
  ELSIF NEW."status"='READY_FOR_PICKUP' THEN
    IF NEW."readyConfirmedAt" IS NULL OR NEW."readyConfirmedByUserId" IS NULL OR NEW."preparationStartedAt" IS NULL THEN RAISE EXCEPTION 'suborder_ready_metadata_required'; END IF;
    IF NEW."readyConfirmedByUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'suborder_actor_mismatch'; END IF;
    IF NEW."readyConfirmedAt" < NEW."preparationStartedAt" THEN RAISE EXCEPTION 'suborder_ready_before_preparation'; END IF;
    IF NEW."rejectedAt" IS NOT NULL THEN RAISE EXCEPTION 'suborder_ready_future_metadata'; END IF;
  ELSIF NEW."status" IN ('FULFILLING','DELIVERED','COMPLETED') THEN
    IF NOT EXISTS (SELECT 1 FROM "Delivery" d WHERE d."suborderId"=NEW."id" AND d."status" = CASE NEW."status" WHEN 'FULFILLING' THEN 'PICKED_UP'::"DeliveryStatus" WHEN 'DELIVERED' THEN 'DELIVERED'::"DeliveryStatus" ELSE 'COMPLETED'::"DeliveryStatus" END) THEN RAISE EXCEPTION 'suborder_delivery_state_required'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION gs_suborder_status_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "VendorSuborder"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'suborder_write_privileged_only'; END IF;
  SELECT * INTO s FROM "VendorSuborder" WHERE "id"=NEW."suborderId";
  IF NOT FOUND OR s."status" <> NEW."toStatus" OR s."version" <> NEW."suborderVersion" THEN RAISE EXCEPTION 'suborder_status_event_mismatch'; END IF;
  IF NEW."actorUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'suborder_actor_mismatch'; END IF;
  IF NOT ((NEW."fromStatus"='PENDING_VENDOR' AND NEW."toStatus" IN ('ACCEPTED','REJECTED')) OR (NEW."fromStatus"='ACCEPTED' AND NEW."toStatus"='PREPARING') OR (NEW."fromStatus"='PREPARING' AND NEW."toStatus"='READY_FOR_PICKUP') OR (NEW."fromStatus"='READY_FOR_PICKUP' AND NEW."toStatus"='FULFILLING') OR (NEW."fromStatus"='FULFILLING' AND NEW."toStatus"='DELIVERED') OR (NEW."fromStatus"='DELIVERED' AND NEW."toStatus"='COMPLETED') OR (NEW."fromStatus" IN ('PENDING_VENDOR','REJECTED') AND NEW."toStatus"='CANCELLED')) THEN RAISE EXCEPTION 'suborder_status_event_invalid_transition'; END IF;
  IF NEW."toStatus"='ACCEPTED' AND (NEW."preparationMinutes" IS NULL OR NEW."preparationMinutes" <> s."preparationMinutes") THEN RAISE EXCEPTION 'suborder_status_event_preparation_mismatch'; END IF;
  IF NEW."toStatus"='REJECTED' AND (NEW."reason" IS NULL OR NEW."reason" <> s."rejectionReason") THEN RAISE EXCEPTION 'suborder_status_event_reason_mismatch'; END IF;
  IF NEW."toStatus"='CANCELLED' AND NEW."reason" IS NULL THEN RAISE EXCEPTION 'suborder_cancel_reason_required'; END IF;
  RETURN NEW;
END;
$$;
