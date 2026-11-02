-- PostGIS 3.4 does not define a geometry <> operator. Unqualified <> can
-- resolve ambiguously through implicit casts, while PostGIS 3.5 added a direct
-- operator. Use the extension-schema equality operator explicitly so dispatch
-- snapshot guards behave identically on both versions. All point columns are
-- NOT NULL, so NOT (a = b) also preserves the previous IS DISTINCT FROM checks.
-- Additive replacement only; migration 0029 remains frozen.
CREATE OR REPLACE FUNCTION gs_dispatch_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "VendorSuborder"%ROWTYPE; o "Order"%ROWTYPE; d "OrderDeliveryDestination"%ROWTYPE; p "StorePickupPoint"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'dispatch_write_privileged_only'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'SEARCHING' OR NEW."version" <> 1 OR NEW."attemptCount" <> 0 THEN RAISE EXCEPTION 'dispatch_run_must_start_searching'; END IF;
    IF NEW."createdByUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'dispatch_run_actor_mismatch'; END IF;
    SELECT * INTO s FROM "VendorSuborder" WHERE "id"=NEW."suborderId";
    IF NOT FOUND OR s."status" <> 'READY_FOR_PICKUP' OR s."storeId" <> NEW."storeId" THEN RAISE EXCEPTION 'dispatch_suborder_not_ready'; END IF;
    SELECT * INTO o FROM "Order" WHERE "id"=s."orderId";
    IF NOT FOUND OR o."countryId" <> NEW."countryId" OR o."paymentStatus" NOT IN ('PAYMENT_VERIFIED','AWAITING_COD') THEN RAISE EXCEPTION 'dispatch_payment_not_ready'; END IF;
    IF NOT gs_store_serviceable(NEW."storeId") THEN RAISE EXCEPTION 'dispatch_store_not_serviceable'; END IF;
    SELECT * INTO d FROM "OrderDeliveryDestination" WHERE "id"=NEW."destinationId";
    IF NOT FOUND OR d."orderId" <> o."id" OR d."countryId" <> NEW."countryId" OR d."serviceZoneId" <> NEW."destinationZoneId" OR NOT (d."destinationPoint" OPERATOR(public.=) NEW."destinationPoint") THEN RAISE EXCEPTION 'dispatch_destination_mismatch'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "StoreServiceArea" a WHERE a."storeId"=NEW."storeId" AND a."serviceZoneId"=NEW."destinationZoneId" AND a."status"='APPROVED') THEN RAISE EXCEPTION 'dispatch_store_area_not_approved'; END IF;
    SELECT * INTO p FROM "StorePickupPoint" WHERE "storeId"=NEW."storeId" AND "status"='APPROVED';
    IF NOT FOUND OR NOT (p."pickupPoint" OPERATOR(public.=) NEW."pickupPoint") THEN RAISE EXCEPTION 'dispatch_pickup_mismatch'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ServiceZone" z JOIN "BoundaryVersion" b ON b."ownerType"='ZONE' AND b."ownerId"=z."id" WHERE z."id"=NEW."pickupZoneId" AND z."status"='ACTIVE' AND b."approvedBy" IS NOT NULL AND b."validFrom"<=gs_dispatch_now() AND ST_Covers(b."boundary", NEW."pickupPoint")) THEN RAISE EXCEPTION 'dispatch_pickup_zone_not_covered'; END IF;
  ELSE
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."suborderId" IS DISTINCT FROM OLD."suborderId" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."storeId" IS DISTINCT FROM OLD."storeId" OR NEW."destinationId" IS DISTINCT FROM OLD."destinationId" OR NEW."pickupZoneId" IS DISTINCT FROM OLD."pickupZoneId" OR NEW."destinationZoneId" IS DISTINCT FROM OLD."destinationZoneId" OR NOT (NEW."pickupPoint" OPERATOR(public.=) OLD."pickupPoint") OR NOT (NEW."destinationPoint" OPERATOR(public.=) OLD."destinationPoint") OR NEW."commandKey" IS DISTINCT FROM OLD."commandKey" OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash" OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW."maxAttempts" IS DISTINCT FROM OLD."maxAttempts" THEN RAISE EXCEPTION 'dispatch_run_immutable_fields'; END IF;
    IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'dispatch_run_version_conflict'; END IF;
    IF NOT ((OLD."status"='SEARCHING' AND NEW."status" IN ('OFFERING','MANUAL_REVIEW')) OR (OLD."status"='OFFERING' AND NEW."status" IN ('SEARCHING','ASSIGNED','MANUAL_REVIEW'))) THEN RAISE EXCEPTION 'dispatch_run_invalid_transition'; END IF;
    IF NEW."status"='OFFERING' THEN
      IF NEW."attemptCount" <> OLD."attemptCount" + 1 OR NEW."attemptCount" > NEW."maxAttempts" THEN RAISE EXCEPTION 'dispatch_attempt_invalid'; END IF;
    ELSIF NEW."attemptCount" <> OLD."attemptCount" THEN RAISE EXCEPTION 'dispatch_attempt_immutable'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
