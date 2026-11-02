-- Pickup confirmation, recipient OTP proof and completion gating.
-- Additive only. No live SMS/notification provider, financial ledger posting,
-- cancellation/restock/refund, settlement or payout is enabled by this migration.
CREATE TYPE "DeliveryStatus" AS ENUM ('PICKED_UP','DELIVERED','COMPLETED');
CREATE TYPE "DeliveryOtpStatus" AS ENUM ('ISSUED','VERIFIED','EXPIRED','LOCKED');
CREATE TYPE "DeliveryOtpAttemptOutcome" AS ENUM ('VALID','INVALID','EXPIRED','LOCKED');

CREATE TABLE "DeliveryRecipient" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orderId" UUID NOT NULL,
  "countryId" UUID NOT NULL,
  "contactEnvelope" BYTEA NOT NULL,
  "phoneHash" VARCHAR(64) NOT NULL,
  "commandKey" VARCHAR(128) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "setByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryRecipient_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeliveryRecipient_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeliveryRecipient_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeliveryRecipient_setByUserId_fkey" FOREIGN KEY ("setByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeliveryRecipient_phone_hash" CHECK ("phoneHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "DeliveryRecipient_command_key" CHECK ("commandKey" ~ '^[A-Za-z0-9:_-]{8,128}$'),
  CONSTRAINT "DeliveryRecipient_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "DeliveryRecipient_envelope_nonempty" CHECK (length("contactEnvelope") > 0)
);
CREATE UNIQUE INDEX "DeliveryRecipient_orderId_key" ON "DeliveryRecipient"("orderId");
CREATE INDEX "DeliveryRecipient_phoneHash_idx" ON "DeliveryRecipient"("phoneHash");

CREATE TABLE "Delivery" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assignmentId" UUID NOT NULL,
  "suborderId" UUID NOT NULL,
  "riderId" UUID NOT NULL,
  "countryId" UUID NOT NULL,
  "recipientId" UUID NOT NULL,
  "status" "DeliveryStatus" NOT NULL DEFAULT 'PICKED_UP',
  "version" INTEGER NOT NULL DEFAULT 1,
  "pickupConfirmedAt" TIMESTAMP(3) NOT NULL,
  "pickupCommandKey" VARCHAR(128) NOT NULL,
  "pickupPayloadHash" VARCHAR(64) NOT NULL,
  "deliveredAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "completionCommandKey" VARCHAR(128),
  "completionPayloadHash" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Delivery_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "RiderAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Delivery_suborderId_fkey" FOREIGN KEY ("suborderId") REFERENCES "VendorSuborder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Delivery_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Delivery_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Delivery_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "DeliveryRecipient"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Delivery_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "Delivery_pickup_command_key" CHECK ("pickupCommandKey" ~ '^[A-Za-z0-9:_-]{8,128}$'),
  CONSTRAINT "Delivery_pickup_payload_hash" CHECK ("pickupPayloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "Delivery_completion_command_key" CHECK ("completionCommandKey" IS NULL OR "completionCommandKey" ~ '^[A-Za-z0-9:_-]{8,128}$'),
  CONSTRAINT "Delivery_completion_payload_hash" CHECK ("completionPayloadHash" IS NULL OR "completionPayloadHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "Delivery_assignmentId_key" ON "Delivery"("assignmentId");
CREATE UNIQUE INDEX "Delivery_suborderId_key" ON "Delivery"("suborderId");
CREATE INDEX "Delivery_riderId_status_idx" ON "Delivery"("riderId","status");
CREATE INDEX "Delivery_countryId_status_idx" ON "Delivery"("countryId","status");

CREATE TABLE "DeliveryOtpChallenge" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "deliveryId" UUID NOT NULL,
  "recipientId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "codeHash" VARCHAR(64) NOT NULL,
  "status" "DeliveryOtpStatus" NOT NULL DEFAULT 'ISSUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "channel" VARCHAR(20) NOT NULL,
  "commandKey" VARCHAR(128) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "DeliveryOtpChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeliveryOtpChallenge_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeliveryOtpChallenge_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "DeliveryRecipient"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeliveryOtpChallenge_sequence_positive" CHECK ("sequence" >= 1),
  CONSTRAINT "DeliveryOtpChallenge_code_hash" CHECK ("codeHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "DeliveryOtpChallenge_attempts_bounds" CHECK ("attempts" >= 0 AND "maxAttempts" BETWEEN 3 AND 10 AND "attempts" <= "maxAttempts"),
  CONSTRAINT "DeliveryOtpChallenge_channel" CHECK ("channel" IN ('test')),
  CONSTRAINT "DeliveryOtpChallenge_command_key" CHECK ("commandKey" ~ '^[A-Za-z0-9:_-]{8,128}$'),
  CONSTRAINT "DeliveryOtpChallenge_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "DeliveryOtpChallenge_ttl_bounds" CHECK ("expiresAt" > "issuedAt" AND "expiresAt" <= "issuedAt" + interval '600 seconds')
);
CREATE UNIQUE INDEX "DeliveryOtpChallenge_deliveryId_sequence_key" ON "DeliveryOtpChallenge"("deliveryId","sequence");
CREATE UNIQUE INDEX "DeliveryOtpChallenge_deliveryId_commandKey_key" ON "DeliveryOtpChallenge"("deliveryId","commandKey");
CREATE UNIQUE INDEX "DeliveryOtpChallenge_one_issued_per_delivery" ON "DeliveryOtpChallenge"("deliveryId") WHERE "status" = 'ISSUED';
CREATE INDEX "DeliveryOtpChallenge_deliveryId_status_idx" ON "DeliveryOtpChallenge"("deliveryId","status");
CREATE INDEX "DeliveryOtpChallenge_recipientId_issuedAt_idx" ON "DeliveryOtpChallenge"("recipientId","issuedAt");

CREATE TABLE "DeliveryOtpAttempt" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "challengeId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "commandKey" VARCHAR(128) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "outcome" "DeliveryOtpAttemptOutcome" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryOtpAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeliveryOtpAttempt_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "DeliveryOtpChallenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeliveryOtpAttempt_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeliveryOtpAttempt_command_key" CHECK ("commandKey" ~ '^[A-Za-z0-9:_-]{8,128}$'),
  CONSTRAINT "DeliveryOtpAttempt_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "DeliveryOtpAttempt_challengeId_commandKey_key" ON "DeliveryOtpAttempt"("challengeId","commandKey");
CREATE INDEX "DeliveryOtpAttempt_challengeId_occurredAt_idx" ON "DeliveryOtpAttempt"("challengeId","occurredAt");

CREATE TABLE "DeliveryProof" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "deliveryId" UUID NOT NULL,
  "challengeId" UUID NOT NULL,
  "method" VARCHAR(40) NOT NULL DEFAULT 'RECIPIENT_OTP',
  "verifiedByUserId" UUID NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "evidenceHash" VARCHAR(64) NOT NULL,
  CONSTRAINT "DeliveryProof_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeliveryProof_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeliveryProof_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "DeliveryOtpChallenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeliveryProof_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeliveryProof_method" CHECK ("method" = 'RECIPIENT_OTP'),
  CONSTRAINT "DeliveryProof_evidence_hash" CHECK ("evidenceHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "DeliveryProof_deliveryId_key" ON "DeliveryProof"("deliveryId");
CREATE UNIQUE INDEX "DeliveryProof_challengeId_key" ON "DeliveryProof"("challengeId");
CREATE INDEX "DeliveryProof_deliveryId_idx" ON "DeliveryProof"("deliveryId");

CREATE TABLE "DeliveryEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "deliveryId" UUID NOT NULL,
  "eventType" VARCHAR(80) NOT NULL,
  "actorUserId" UUID NOT NULL,
  "commandKey" VARCHAR(128) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeliveryEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeliveryEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeliveryEvent_command_key" CHECK ("commandKey" ~ '^[A-Za-z0-9:_-]{8,128}$'),
  CONSTRAINT "DeliveryEvent_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "DeliveryEvent_deliveryId_commandKey_key" ON "DeliveryEvent"("deliveryId","commandKey");
CREATE INDEX "DeliveryEvent_deliveryId_occurredAt_idx" ON "DeliveryEvent"("deliveryId","occurredAt");

-- Guards ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gs_delivery_recipient_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o "Order"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'delivery_write_privileged_only'; END IF;
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'delivery_recipient_immutable'; END IF;
  SELECT * INTO o FROM "Order" WHERE "id"=NEW."orderId";
  IF NOT FOUND OR o."buyerId" <> NEW."setByUserId" OR NEW."setByUserId" <> gs_current_user_id() OR o."countryId" <> NEW."countryId" THEN RAISE EXCEPTION 'delivery_recipient_actor_mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER delivery_recipient_guard BEFORE INSERT OR UPDATE OR DELETE ON "DeliveryRecipient" FOR EACH ROW EXECUTE FUNCTION gs_delivery_recipient_guard();

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
      IF o."paymentMethod"='COD' THEN RAISE EXCEPTION 'cod_accounting_required'; END IF;
      IF o."paymentStatus" <> 'PAYMENT_VERIFIED' THEN RAISE EXCEPTION 'payment_not_verified'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER delivery_guard BEFORE INSERT OR UPDATE ON "Delivery" FOR EACH ROW EXECUTE FUNCTION gs_delivery_guard();

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
    IF OLD."status" <> 'ISSUED' OR NEW."status" NOT IN ('VERIFIED','EXPIRED','LOCKED') THEN RAISE EXCEPTION 'otp_invalid_transition'; END IF;
    IF NEW."status"='VERIFIED' AND NEW."verifiedAt" IS NULL THEN RAISE EXCEPTION 'otp_verified_metadata_required'; END IF;
    IF NEW."status" IN ('EXPIRED','LOCKED') AND NEW."closedAt" IS NULL THEN RAISE EXCEPTION 'otp_closed_metadata_required'; END IF;
    IF NEW."attempts" < OLD."attempts" OR NEW."attempts" > OLD."attempts" + 1 THEN RAISE EXCEPTION 'otp_attempt_increment_invalid'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER delivery_otp_challenge_guard BEFORE INSERT OR UPDATE ON "DeliveryOtpChallenge" FOR EACH ROW EXECUTE FUNCTION gs_delivery_otp_challenge_guard();

CREATE OR REPLACE FUNCTION gs_delivery_otp_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "DeliveryOtpChallenge"%ROWTYPE; d "Delivery"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'delivery_write_privileged_only'; END IF;
  SELECT * INTO c FROM "DeliveryOtpChallenge" WHERE "id"=NEW."challengeId";
  IF NOT FOUND THEN RAISE EXCEPTION 'otp_challenge_missing'; END IF;
  SELECT * INTO d FROM "Delivery" WHERE "id"=c."deliveryId";
  IF NOT EXISTS (SELECT 1 FROM "RiderProfile" rp WHERE rp."id"=d."riderId" AND rp."userId"=NEW."actorUserId" AND rp."userId"=gs_current_user_id()) THEN RAISE EXCEPTION 'otp_actor_mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER delivery_otp_attempt_guard BEFORE INSERT ON "DeliveryOtpAttempt" FOR EACH ROW EXECUTE FUNCTION gs_delivery_otp_attempt_guard();
CREATE TRIGGER delivery_otp_attempt_append_only BEFORE UPDATE OR DELETE ON "DeliveryOtpAttempt" FOR EACH ROW EXECUTE FUNCTION gs_append_only();

CREATE OR REPLACE FUNCTION gs_delivery_proof_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "DeliveryOtpChallenge"%ROWTYPE; d "Delivery"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'delivery_write_privileged_only'; END IF;
  SELECT * INTO c FROM "DeliveryOtpChallenge" WHERE "id"=NEW."challengeId";
  IF NOT FOUND OR c."deliveryId" <> NEW."deliveryId" OR c."status" <> 'VERIFIED' OR c."verifiedAt" IS NULL THEN RAISE EXCEPTION 'proof_challenge_not_verified'; END IF;
  SELECT * INTO d FROM "Delivery" WHERE "id"=NEW."deliveryId";
  IF NOT EXISTS (SELECT 1 FROM "RiderProfile" rp WHERE rp."id"=d."riderId" AND rp."userId"=NEW."verifiedByUserId" AND rp."userId"=gs_current_user_id()) THEN RAISE EXCEPTION 'proof_actor_mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER delivery_proof_guard BEFORE INSERT ON "DeliveryProof" FOR EACH ROW EXECUTE FUNCTION gs_delivery_proof_guard();
CREATE TRIGGER delivery_proof_append_only BEFORE UPDATE OR DELETE ON "DeliveryProof" FOR EACH ROW EXECUTE FUNCTION gs_append_only();

CREATE OR REPLACE FUNCTION gs_delivery_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'delivery_write_privileged_only'; END IF;
  IF NEW."actorUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'delivery_event_actor_mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER delivery_event_guard BEFORE INSERT ON "DeliveryEvent" FOR EACH ROW EXECUTE FUNCTION gs_delivery_event_guard();
CREATE TRIGGER delivery_event_append_only BEFORE UPDATE OR DELETE ON "DeliveryEvent" FOR EACH ROW EXECUTE FUNCTION gs_append_only();

-- Extend suborder readiness guard for dispatch/delivery lifecycle.
CREATE OR REPLACE FUNCTION gs_suborder_readiness_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o "Order"%ROWTYPE; st "Store"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'suborder_write_privileged_only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."publicReference" IS DISTINCT FROM OLD."publicReference" OR NEW."orderId" IS DISTINCT FROM OLD."orderId" OR NEW."vendorId" IS DISTINCT FROM OLD."vendorId" OR NEW."storeId" IS DISTINCT FROM OLD."storeId" OR NEW."currency" IS DISTINCT FROM OLD."currency" OR NEW."subtotalMinor" IS DISTINCT FROM OLD."subtotalMinor" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN RAISE EXCEPTION 'suborder_immutable_fields'; END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'suborder_version_conflict'; END IF;
  IF NOT ((OLD."status"='PENDING_VENDOR' AND NEW."status" IN ('ACCEPTED','REJECTED')) OR (OLD."status"='ACCEPTED' AND NEW."status"='PREPARING') OR (OLD."status"='PREPARING' AND NEW."status"='READY_FOR_PICKUP') OR (OLD."status"='READY_FOR_PICKUP' AND NEW."status"='FULFILLING') OR (OLD."status"='FULFILLING' AND NEW."status"='DELIVERED') OR (OLD."status"='DELIVERED' AND NEW."status"='COMPLETED')) THEN RAISE EXCEPTION 'suborder_invalid_transition'; END IF;
  SELECT * INTO o FROM "Order" WHERE "id"=NEW."orderId";
  IF NOT FOUND OR o."paymentStatus" NOT IN ('PAYMENT_VERIFIED','AWAITING_COD') THEN RAISE EXCEPTION 'suborder_payment_not_ready'; END IF;
  SELECT * INTO st FROM "Store" WHERE "id"=NEW."storeId";
  IF NOT FOUND OR st."status" <> 'ACTIVE' OR NOT gs_inventory_vendor_eligible(NEW."vendorId") THEN RAISE EXCEPTION 'suborder_store_vendor_not_eligible'; END IF;
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
  IF NOT ((NEW."fromStatus"='PENDING_VENDOR' AND NEW."toStatus" IN ('ACCEPTED','REJECTED')) OR (NEW."fromStatus"='ACCEPTED' AND NEW."toStatus"='PREPARING') OR (NEW."fromStatus"='PREPARING' AND NEW."toStatus"='READY_FOR_PICKUP') OR (NEW."fromStatus"='READY_FOR_PICKUP' AND NEW."toStatus"='FULFILLING') OR (NEW."fromStatus"='FULFILLING' AND NEW."toStatus"='DELIVERED') OR (NEW."fromStatus"='DELIVERED' AND NEW."toStatus"='COMPLETED')) THEN RAISE EXCEPTION 'suborder_status_event_invalid_transition'; END IF;
  IF NEW."toStatus"='ACCEPTED' AND (NEW."preparationMinutes" IS NULL OR NEW."preparationMinutes" <> s."preparationMinutes") THEN RAISE EXCEPTION 'suborder_status_event_preparation_mismatch'; END IF;
  IF NEW."toStatus"='REJECTED' AND (NEW."reason" IS NULL OR NEW."reason" <> s."rejectionReason") THEN RAISE EXCEPTION 'suborder_status_event_reason_mismatch'; END IF;
  RETURN NEW;
END;
$$;

-- Allow assignment completion only after delivery completion; all route fields stay immutable.
CREATE OR REPLACE FUNCTION gs_rider_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o "DispatchOffer"%ROWTYPE; r "DispatchRun"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'dispatch_write_privileged_only'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'ACTIVE' THEN RAISE EXCEPTION 'rider_assignment_must_start_active'; END IF;
    SELECT * INTO o FROM "DispatchOffer" WHERE "id"=NEW."offerId";
    IF NOT FOUND OR o."status" <> 'ACCEPTED' OR o."runId" <> NEW."runId" OR o."riderId" <> NEW."riderId" THEN RAISE EXCEPTION 'assignment_offer_mismatch'; END IF;
    SELECT * INTO r FROM "DispatchRun" WHERE "id"=NEW."runId";
    IF NOT FOUND OR r."status" <> 'ASSIGNED' OR r."suborderId" <> NEW."suborderId" OR r."countryId" <> NEW."countryId" THEN RAISE EXCEPTION 'assignment_run_mismatch'; END IF;
    IF NEW."shiftId" <> o."shiftId" OR NEW."locationSampleId" <> o."locationSampleId" OR NEW."pickupDistanceMeters" <> o."pickupDistanceMeters" OR NEW."roadDistanceMeters" <> o."roadDistanceMeters" OR NEW."durationSeconds" IS DISTINCT FROM o."durationSeconds" OR NEW."routingProvider" <> o."routingProvider" OR NEW."routingMode" <> o."routingMode" OR NEW."routeEvidenceHash" <> o."routeEvidenceHash" THEN RAISE EXCEPTION 'assignment_route_snapshot_mismatch'; END IF;
    IF gs_dispatch_now() >= o."expiresAt" THEN RAISE EXCEPTION 'dispatch_offer_expired'; END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."runId" IS DISTINCT FROM OLD."runId" OR NEW."offerId" IS DISTINCT FROM OLD."offerId" OR NEW."riderId" IS DISTINCT FROM OLD."riderId" OR NEW."suborderId" IS DISTINCT FROM OLD."suborderId" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."shiftId" IS DISTINCT FROM OLD."shiftId" OR NEW."locationSampleId" IS DISTINCT FROM OLD."locationSampleId" OR NEW."pickupDistanceMeters" IS DISTINCT FROM OLD."pickupDistanceMeters" OR NEW."roadDistanceMeters" IS DISTINCT FROM OLD."roadDistanceMeters" OR NEW."durationSeconds" IS DISTINCT FROM OLD."durationSeconds" OR NEW."routingProvider" IS DISTINCT FROM OLD."routingProvider" OR NEW."routingMode" IS DISTINCT FROM OLD."routingMode" OR NEW."routeEvidenceHash" IS DISTINCT FROM OLD."routeEvidenceHash" OR NEW."assignedAt" IS DISTINCT FROM OLD."assignedAt" THEN RAISE EXCEPTION 'rider_assignment_immutable'; END IF;
    IF OLD."status" <> 'ACTIVE' OR NEW."status" <> 'COMPLETED' THEN RAISE EXCEPTION 'rider_assignment_invalid_transition'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "Delivery" d WHERE d."assignmentId"=NEW."id" AND d."status"='COMPLETED') THEN RAISE EXCEPTION 'assignment_delivery_not_completed'; END IF;
  ELSE
    RAISE EXCEPTION 'rider_assignment_immutable';
  END IF;
  RETURN NEW;
END;
$$;

-- RLS ------------------------------------------------------------------------
ALTER TABLE "DeliveryRecipient" ENABLE ROW LEVEL SECURITY; ALTER TABLE "DeliveryRecipient" FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_recipient_select_buyer_or_super ON "DeliveryRecipient" FOR SELECT USING (gs_is_super() OR EXISTS (SELECT 1 FROM "Order" o WHERE o."id"="DeliveryRecipient"."orderId" AND o."buyerId"=gs_current_user_id()));
CREATE POLICY delivery_recipient_insert_super ON "DeliveryRecipient" FOR INSERT WITH CHECK (gs_is_super());

ALTER TABLE "Delivery" ENABLE ROW LEVEL SECURITY; ALTER TABLE "Delivery" FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_select_authorized ON "Delivery" FOR SELECT USING (
  gs_is_super() OR EXISTS (SELECT 1 FROM "RiderProfile" r WHERE r."id"="Delivery"."riderId" AND r."userId"=gs_current_user_id())
  OR EXISTS (SELECT 1 FROM "VendorSuborder" s JOIN "Order" o ON o."id"=s."orderId" WHERE s."id"="Delivery"."suborderId" AND o."buyerId"=gs_current_user_id())
);
CREATE POLICY delivery_insert_super ON "Delivery" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY delivery_update_super ON "Delivery" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

ALTER TABLE "DeliveryOtpChallenge" ENABLE ROW LEVEL SECURITY; ALTER TABLE "DeliveryOtpChallenge" FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_otp_select_super ON "DeliveryOtpChallenge" FOR SELECT USING (gs_is_super());
CREATE POLICY delivery_otp_insert_super ON "DeliveryOtpChallenge" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY delivery_otp_update_super ON "DeliveryOtpChallenge" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

ALTER TABLE "DeliveryOtpAttempt" ENABLE ROW LEVEL SECURITY; ALTER TABLE "DeliveryOtpAttempt" FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_otp_attempt_select_super ON "DeliveryOtpAttempt" FOR SELECT USING (gs_is_super());
CREATE POLICY delivery_otp_attempt_insert_super ON "DeliveryOtpAttempt" FOR INSERT WITH CHECK (gs_is_super());

ALTER TABLE "DeliveryProof" ENABLE ROW LEVEL SECURITY; ALTER TABLE "DeliveryProof" FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_proof_select_authorized ON "DeliveryProof" FOR SELECT USING (
  gs_is_super() OR EXISTS (SELECT 1 FROM "Delivery" d JOIN "RiderProfile" r ON r."id"=d."riderId" WHERE d."id"="DeliveryProof"."deliveryId" AND r."userId"=gs_current_user_id())
  OR EXISTS (SELECT 1 FROM "Delivery" d JOIN "VendorSuborder" s ON s."id"=d."suborderId" JOIN "Order" o ON o."id"=s."orderId" WHERE d."id"="DeliveryProof"."deliveryId" AND o."buyerId"=gs_current_user_id())
);
CREATE POLICY delivery_proof_insert_super ON "DeliveryProof" FOR INSERT WITH CHECK (gs_is_super());

ALTER TABLE "DeliveryEvent" ENABLE ROW LEVEL SECURITY; ALTER TABLE "DeliveryEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_event_select_super ON "DeliveryEvent" FOR SELECT USING (gs_is_super());
CREATE POLICY delivery_event_insert_super ON "DeliveryEvent" FOR INSERT WITH CHECK (gs_is_super());

COMMENT ON TABLE "DeliveryRecipient" IS 'Encrypted recipient contact snapshot; phone hash is HMAC-peppered, never plaintext.';
COMMENT ON TABLE "DeliveryOtpChallenge" IS 'Recipient OTP challenge; only HMAC code hash stored. Test channel only; live delivery disabled.';
COMMENT ON TABLE "DeliveryProof" IS 'Append-only recipient OTP delivery proof; no OTP material.';
