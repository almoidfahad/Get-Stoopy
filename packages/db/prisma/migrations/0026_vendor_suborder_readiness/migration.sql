-- Vendor suborder readiness: accept/reject, start preparation, manual ready.
-- Additive only. Dispatch, rider assignment, OTP, cancellation/restock and refunds remain pending.

ALTER TABLE "VendorMembership" ADD COLUMN "storeId" UUID;
ALTER TABLE "VendorMembership" ADD CONSTRAINT "VendorMembership_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "VendorMembership_storeId_idx" ON "VendorMembership"("storeId");

ALTER TABLE "VendorSuborder" ADD COLUMN "acceptedAt" TIMESTAMP(3);
ALTER TABLE "VendorSuborder" ADD COLUMN "acceptedByUserId" UUID;
ALTER TABLE "VendorSuborder" ADD COLUMN "preparationMinutes" INTEGER;
ALTER TABLE "VendorSuborder" ADD COLUMN "preparationStartedAt" TIMESTAMP(3);
ALTER TABLE "VendorSuborder" ADD COLUMN "readyConfirmedAt" TIMESTAMP(3);
ALTER TABLE "VendorSuborder" ADD COLUMN "readyConfirmedByUserId" UUID;
ALTER TABLE "VendorSuborder" ADD COLUMN "rejectedAt" TIMESTAMP(3);
ALTER TABLE "VendorSuborder" ADD COLUMN "rejectedByUserId" UUID;
ALTER TABLE "VendorSuborder" ADD COLUMN "rejectionReason" VARCHAR(512);
ALTER TABLE "VendorSuborder" ADD CONSTRAINT "VendorSuborder_acceptedByUserId_fkey"
  FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorSuborder" ADD CONSTRAINT "VendorSuborder_readyConfirmedByUserId_fkey"
  FOREIGN KEY ("readyConfirmedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorSuborder" ADD CONSTRAINT "VendorSuborder_rejectedByUserId_fkey"
  FOREIGN KEY ("rejectedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorSuborder" ADD CONSTRAINT "VendorSuborder_preparation_minutes_bounds"
  CHECK ("preparationMinutes" IS NULL OR "preparationMinutes" BETWEEN 1 AND 1440);
ALTER TABLE "VendorSuborder" ADD CONSTRAINT "VendorSuborder_rejection_reason_length"
  CHECK ("rejectionReason" IS NULL OR length(trim("rejectionReason")) BETWEEN 8 AND 512);
CREATE INDEX "VendorSuborder_vendorId_status_createdAt_idx" ON "VendorSuborder"("vendorId","status","createdAt");

CREATE TABLE "VendorSuborderStatusEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "suborderId" UUID NOT NULL,
  "fromStatus" "VendorSuborderStatus" NOT NULL,
  "toStatus" "VendorSuborderStatus" NOT NULL,
  "suborderVersion" INTEGER NOT NULL,
  "actorUserId" UUID NOT NULL,
  "commandKey" VARCHAR(128) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "reason" VARCHAR(512),
  "preparationMinutes" INTEGER,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VendorSuborderStatusEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VendorSuborderStatusEvent_suborderId_fkey" FOREIGN KEY ("suborderId") REFERENCES "VendorSuborder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorSuborderStatusEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorSuborderStatusEvent_version_positive" CHECK ("suborderVersion" >= 2),
  CONSTRAINT "VendorSuborderStatusEvent_command_key" CHECK ("commandKey" ~ '^[A-Za-z0-9:_-]{8,128}$'),
  CONSTRAINT "VendorSuborderStatusEvent_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "VendorSuborderStatusEvent_preparation_bounds" CHECK ("preparationMinutes" IS NULL OR "preparationMinutes" BETWEEN 1 AND 1440),
  CONSTRAINT "VendorSuborderStatusEvent_reason_length" CHECK ("reason" IS NULL OR length(trim("reason")) BETWEEN 8 AND 512)
);
CREATE UNIQUE INDEX "VendorSuborderStatusEvent_suborderId_commandKey_key" ON "VendorSuborderStatusEvent"("suborderId","commandKey");
CREATE UNIQUE INDEX "VendorSuborderStatusEvent_suborderId_suborderVersion_key" ON "VendorSuborderStatusEvent"("suborderId","suborderVersion");
CREATE INDEX "VendorSuborderStatusEvent_suborderId_occurredAt_idx" ON "VendorSuborderStatusEvent"("suborderId","occurredAt");
CREATE INDEX "VendorSuborderStatusEvent_actorUserId_occurredAt_idx" ON "VendorSuborderStatusEvent"("actorUserId","occurredAt");

-- Store-scoped membership hardening for the new readiness surface.
CREATE OR REPLACE FUNCTION gs_vendor_membership_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id UUID; vendor_country UUID; store_vendor UUID; store_country UUID;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'party_write_privileged_only'; END IF;
  IF NEW."revokedAt" IS NOT NULL THEN RAISE EXCEPTION 'membership_must_start_unrevoked'; END IF;
  IF NEW."expiresAt" IS NOT NULL AND NEW."expiresAt" <= CURRENT_TIMESTAMP THEN RAISE EXCEPTION 'membership_expiry_must_be_future'; END IF;
  SELECT "ownerUserId", "countryId" INTO owner_id, vendor_country FROM "Vendor" WHERE "id" = NEW."vendorId";
  IF NOT FOUND THEN RAISE EXCEPTION 'membership_vendor_not_found'; END IF;
  IF NEW."role" = 'OWNER' AND (NEW."userId" <> owner_id OR NEW."storeId" IS NOT NULL) THEN RAISE EXCEPTION 'membership_owner_mismatch'; END IF;
  IF NEW."storeId" IS NOT NULL THEN
    SELECT "vendorId", "countryId" INTO store_vendor, store_country FROM "Store" WHERE "id" = NEW."storeId";
    IF NOT FOUND OR store_vendor <> NEW."vendorId" OR store_country <> vendor_country THEN RAISE EXCEPTION 'membership_store_ancestry_mismatch'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION gs_vendor_membership_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'party_write_privileged_only'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."vendorId" IS DISTINCT FROM OLD."vendorId" OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."storeId" IS DISTINCT FROM OLD."storeId" OR NEW."role" IS DISTINCT FROM OLD."role" OR NEW."grantedBy" IS DISTINCT FROM OLD."grantedBy" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
      RAISE EXCEPTION 'membership_immutable_fields';
    END IF;
    IF OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" THEN
      RAISE EXCEPTION 'membership_revocation_immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Readiness update guard. Payment must be verified or COD; store/vendor must remain eligible.
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
       OR (OLD."status" = 'PREPARING' AND NEW."status" = 'READY_FOR_PICKUP')) THEN
    RAISE EXCEPTION 'suborder_invalid_transition';
  END IF;
  SELECT * INTO o FROM "Order" WHERE "id" = NEW."orderId";
  IF NOT FOUND OR o."paymentStatus" NOT IN ('PAYMENT_VERIFIED','AWAITING_COD') THEN RAISE EXCEPTION 'suborder_payment_not_ready'; END IF;
  SELECT * INTO st FROM "Store" WHERE "id" = NEW."storeId";
  IF NOT FOUND OR st."status" <> 'ACTIVE' OR NOT gs_inventory_vendor_eligible(NEW."vendorId") THEN RAISE EXCEPTION 'suborder_store_vendor_not_eligible'; END IF;

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
       OR (NEW."fromStatus" = 'PREPARING' AND NEW."toStatus" = 'READY_FOR_PICKUP')) THEN
    RAISE EXCEPTION 'suborder_status_event_invalid_transition';
  END IF;
  IF NEW."toStatus" = 'ACCEPTED' AND (NEW."preparationMinutes" IS NULL OR NEW."preparationMinutes" <> s."preparationMinutes") THEN RAISE EXCEPTION 'suborder_status_event_preparation_mismatch'; END IF;
  IF NEW."toStatus" = 'REJECTED' AND (NEW."reason" IS NULL OR NEW."reason" <> s."rejectionReason") THEN RAISE EXCEPTION 'suborder_status_event_reason_mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER suborder_status_event_guard BEFORE INSERT ON "VendorSuborderStatusEvent" FOR EACH ROW EXECUTE FUNCTION gs_suborder_status_event_guard();
CREATE TRIGGER suborder_status_event_append_only BEFORE UPDATE OR DELETE ON "VendorSuborderStatusEvent" FOR EACH ROW EXECUTE FUNCTION gs_append_only();

CREATE OR REPLACE FUNCTION gs_suborder_status_event_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "VendorSuborderStatusEvent" WHERE "suborderId" = NEW."id" AND "suborderVersion" = NEW."version" AND "toStatus" = NEW."status") THEN
    RAISE EXCEPTION 'suborder_status_event_required';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER suborder_status_event_required AFTER UPDATE ON "VendorSuborder" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_suborder_status_event_required();

-- RLS: buyer keeps order visibility; vendor members are store-scoped when membership.storeId is set.
ALTER POLICY suborder_select_buyer_member_or_super ON "VendorSuborder" USING (
  gs_is_super()
  OR EXISTS (SELECT 1 FROM "Order" o WHERE o."id" = "VendorSuborder"."orderId" AND o."buyerId" = gs_current_user_id())
  OR EXISTS (
    SELECT 1 FROM "VendorMembership" m
    WHERE m."vendorId" = "VendorSuborder"."vendorId" AND m."userId" = gs_current_user_id()
      AND m."revokedAt" IS NULL AND (m."expiresAt" IS NULL OR m."expiresAt" > CURRENT_TIMESTAMP)
      AND (m."storeId" IS NULL OR m."storeId" = "VendorSuborder"."storeId")
      AND EXISTS (SELECT 1 FROM "Vendor" v WHERE v."id" = "VendorSuborder"."vendorId" AND v."status" = 'ACTIVE')
  )
);
CREATE POLICY suborder_update_super ON "VendorSuborder" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

ALTER POLICY order_item_select_buyer_member_or_super ON "OrderItem" USING (
  gs_is_super()
  OR EXISTS (SELECT 1 FROM "VendorSuborder" s JOIN "Order" o ON o."id" = s."orderId" WHERE s."id" = "OrderItem"."suborderId" AND o."buyerId" = gs_current_user_id())
  OR EXISTS (
    SELECT 1 FROM "VendorSuborder" s JOIN "VendorMembership" m ON m."vendorId" = s."vendorId"
    WHERE s."id" = "OrderItem"."suborderId" AND m."userId" = gs_current_user_id()
      AND m."revokedAt" IS NULL AND (m."expiresAt" IS NULL OR m."expiresAt" > CURRENT_TIMESTAMP)
      AND (m."storeId" IS NULL OR m."storeId" = s."storeId")
      AND EXISTS (SELECT 1 FROM "Vendor" v WHERE v."id" = s."vendorId" AND v."status" = 'ACTIVE')
  )
);

ALTER TABLE "VendorSuborderStatusEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VendorSuborderStatusEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY suborder_status_event_select_member_or_super ON "VendorSuborderStatusEvent" FOR SELECT USING (
  gs_is_super() OR EXISTS (
    SELECT 1 FROM "VendorSuborder" s JOIN "VendorMembership" m ON m."vendorId" = s."vendorId"
    WHERE s."id" = "VendorSuborderStatusEvent"."suborderId" AND m."userId" = gs_current_user_id()
      AND m."revokedAt" IS NULL AND (m."expiresAt" IS NULL OR m."expiresAt" > CURRENT_TIMESTAMP)
      AND (m."storeId" IS NULL OR m."storeId" = s."storeId")
      AND EXISTS (SELECT 1 FROM "Vendor" v WHERE v."id" = s."vendorId" AND v."status" = 'ACTIVE')
  )
);
CREATE POLICY suborder_status_event_insert_super ON "VendorSuborderStatusEvent" FOR INSERT WITH CHECK (gs_is_super());

COMMENT ON TABLE "VendorSuborder" IS 'Vendor/store split snapshot with implemented manual readiness lifecycle; dispatch/OTP/cancellation/refunds pending.';
COMMENT ON TABLE "VendorSuborderStatusEvent" IS 'Append-only vendor readiness transition evidence; one event per suborder version/command.';
COMMENT ON COLUMN "VendorMembership"."storeId" IS 'Optional store scope. NULL means vendor-wide; OWNER memberships must remain vendor-wide.';
