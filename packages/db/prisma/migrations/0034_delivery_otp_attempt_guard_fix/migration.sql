-- Allow bounded invalid-attempt counter updates while a challenge remains ISSUED,
-- and keep dispatch offer DB-time validation tolerant of transaction scheduling.
CREATE OR REPLACE FUNCTION gs_delivery_otp_challenge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d "Delivery"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'delivery_write_privileged_only'; END IF;
  SELECT * INTO d FROM "Delivery" WHERE "id"=NEW."deliveryId";
  IF NOT FOUND OR d."recipientId" <> NEW."recipientId" OR d."status" <> 'PICKED_UP' THEN RAISE EXCEPTION 'otp_delivery_not_picked_up'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'ISSUED' OR NEW."attempts" <> 0 OR NEW."verifiedAt" IS NOT NULL OR NEW."closedAt" IS NOT NULL THEN RAISE EXCEPTION 'otp_must_start_issued'; END IF;
  ELSE
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."deliveryId" IS DISTINCT FROM OLD."deliveryId" OR NEW."recipientId" IS DISTINCT FROM OLD."recipientId" OR NEW."sequence" IS DISTINCT FROM OLD."sequence" OR NEW."codeHash" IS DISTINCT FROM OLD."codeHash" OR NEW."maxAttempts" IS DISTINCT FROM OLD."maxAttempts" OR NEW."channel" IS DISTINCT FROM OLD."channel" OR NEW."commandKey" IS DISTINCT FROM OLD."commandKey" OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash" OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt" OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" THEN RAISE EXCEPTION 'otp_immutable_fields'; END IF;
    IF NEW."attempts" < OLD."attempts" OR NEW."attempts" > OLD."attempts" + 1 THEN RAISE EXCEPTION 'otp_attempt_increment_invalid'; END IF;
    IF OLD."status" = 'ISSUED' AND NEW."status" = 'ISSUED' THEN
      IF NEW."attempts" <> OLD."attempts" + 1 OR NEW."verifiedAt" IS NOT NULL OR NEW."closedAt" IS NOT NULL THEN RAISE EXCEPTION 'otp_invalid_attempt_update'; END IF;
      RETURN NEW;
    END IF;
    IF OLD."status" <> 'ISSUED' OR NEW."status" NOT IN ('VERIFIED','EXPIRED','LOCKED') THEN RAISE EXCEPTION 'otp_invalid_transition'; END IF;
    IF NEW."status"='VERIFIED' AND NEW."verifiedAt" IS NULL THEN RAISE EXCEPTION 'otp_verified_metadata_required'; END IF;
    IF NEW."status" IN ('EXPIRED','LOCKED') AND NEW."closedAt" IS NULL THEN RAISE EXCEPTION 'otp_closed_metadata_required'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION gs_dispatch_offer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "DispatchRun"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'dispatch_write_privileged_only'; END IF;
  SELECT * INTO r FROM "DispatchRun" WHERE "id"=NEW."runId";
  IF NOT FOUND THEN RAISE EXCEPTION 'dispatch_run_not_found'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'OFFERED' OR NEW."respondedAt" IS NOT NULL OR NEW."responseCommandKey" IS NOT NULL OR NEW."responsePayloadHash" IS NOT NULL THEN RAISE EXCEPTION 'dispatch_offer_must_start_offered'; END IF;
    IF r."status" <> 'OFFERING' OR r."attemptCount" <> NEW."sequence" THEN RAISE EXCEPTION 'dispatch_offer_run_mismatch'; END IF;
    IF NEW."offeredAt" > gs_dispatch_now() OR NEW."offeredAt" < gs_dispatch_now() - interval '30 seconds' THEN RAISE EXCEPTION 'dispatch_offer_must_use_db_time'; END IF;
    IF NOT gs_rider_dispatch_eligible(NEW."riderId", r."countryId", r."pickupZoneId", r."destinationZoneId", NEW."shiftId", NEW."locationSampleId", NEW."pickupZoneGrantId", NEW."destinationZoneGrantId") THEN RAISE EXCEPTION 'dispatch_rider_not_eligible'; END IF;
  ELSE
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."runId" IS DISTINCT FROM OLD."runId" OR NEW."riderId" IS DISTINCT FROM OLD."riderId" OR NEW."sequence" IS DISTINCT FROM OLD."sequence" OR NEW."offerTokenHash" IS DISTINCT FROM OLD."offerTokenHash" OR NEW."shiftId" IS DISTINCT FROM OLD."shiftId" OR NEW."locationSampleId" IS DISTINCT FROM OLD."locationSampleId" OR NEW."pickupZoneGrantId" IS DISTINCT FROM OLD."pickupZoneGrantId" OR NEW."destinationZoneGrantId" IS DISTINCT FROM OLD."destinationZoneGrantId" OR NEW."pickupDistanceMeters" IS DISTINCT FROM OLD."pickupDistanceMeters" OR NEW."roadDistanceMeters" IS DISTINCT FROM OLD."roadDistanceMeters" OR NEW."durationSeconds" IS DISTINCT FROM OLD."durationSeconds" OR NEW."routingProvider" IS DISTINCT FROM OLD."routingProvider" OR NEW."routingMode" IS DISTINCT FROM OLD."routingMode" OR NEW."routeEvidenceHash" IS DISTINCT FROM OLD."routeEvidenceHash" OR NEW."commandKey" IS DISTINCT FROM OLD."commandKey" OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash" OR NEW."offeredAt" IS DISTINCT FROM OLD."offeredAt" OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" THEN RAISE EXCEPTION 'dispatch_offer_immutable_fields'; END IF;
    IF OLD."status" <> 'OFFERED' OR NEW."status" NOT IN ('ACCEPTED','REJECTED','EXPIRED','CANCELLED') THEN RAISE EXCEPTION 'dispatch_offer_invalid_transition'; END IF;
    IF NEW."respondedAt" IS NULL OR NEW."responseCommandKey" IS NULL OR NEW."responsePayloadHash" IS NULL THEN RAISE EXCEPTION 'dispatch_offer_response_metadata_required'; END IF;
    IF NEW."status"='ACCEPTED' THEN
      IF gs_dispatch_now() >= OLD."expiresAt" THEN RAISE EXCEPTION 'dispatch_offer_expired'; END IF;
      IF r."status" <> 'ASSIGNED' THEN RAISE EXCEPTION 'dispatch_offer_run_not_assigned'; END IF;
      IF NOT gs_rider_dispatch_eligible(NEW."riderId", r."countryId", r."pickupZoneId", r."destinationZoneId", NEW."shiftId", NEW."locationSampleId", NEW."pickupZoneGrantId", NEW."destinationZoneGrantId") THEN RAISE EXCEPTION 'dispatch_rider_not_eligible'; END IF;
    END IF;
    IF NEW."status" IN ('REJECTED','CANCELLED') AND NEW."responseReason" IS NULL THEN RAISE EXCEPTION 'dispatch_offer_reason_required'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
