-- Order/payment/COD foundation. Sandbox/manual only; no live provider network calls.
CREATE TYPE "OrderPaymentMethod" AS ENUM ('SANDBOX_MANUAL','COD');
CREATE TYPE "OrderPaymentStatus" AS ENUM ('AWAITING_PAYMENT','PAYMENT_VERIFIED','PAYMENT_FAILED','AWAITING_COD');
CREATE TYPE "VendorSuborderStatus" AS ENUM ('PENDING_VENDOR');
CREATE TYPE "PaymentProvider" AS ENUM ('SANDBOX_MANUAL','SSLCOMMERZ','AAMARPAY','SHURJOPAY');
CREATE TYPE "PaymentEnvironment" AS ENUM ('SANDBOX','LIVE');
CREATE TYPE "PaymentIntentStatus" AS ENUM ('CREATED','PENDING','UNKNOWN','VERIFIED','FAILED','CANCELLED','EXPIRED');
CREATE TYPE "PaymentWebhookStatus" AS ENUM ('APPLIED','REJECTED','IGNORED_OUT_OF_ORDER');

CREATE TABLE "Order" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "publicReference" VARCHAR(40) NOT NULL,
  "buyerId" UUID NOT NULL,
  "countryId" UUID NOT NULL,
  "destinationCityId" UUID NOT NULL,
  "quoteId" UUID NOT NULL,
  "commandKey" VARCHAR(128) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "pricingScope" VARCHAR(40) NOT NULL DEFAULT 'PRODUCT_SUBTOTAL_ONLY',
  "paymentMethod" "OrderPaymentMethod" NOT NULL,
  "paymentStatus" "OrderPaymentStatus" NOT NULL,
  "codEligibility" JSONB,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Order_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Order_destinationCityId_fkey" FOREIGN KEY ("destinationCityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "CheckoutQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Order_amount_positive" CHECK ("amountMinor" > 0),
  CONSTRAINT "Order_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "Order_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "Order_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "Order_pricing_scope" CHECK ("pricingScope" = 'PRODUCT_SUBTOTAL_ONLY')
);
CREATE UNIQUE INDEX "Order_publicReference_key" ON "Order"("publicReference");
CREATE UNIQUE INDEX "Order_quoteId_key" ON "Order"("quoteId");
CREATE UNIQUE INDEX "Order_buyerId_commandKey_key" ON "Order"("buyerId","commandKey");
CREATE INDEX "Order_buyerId_createdAt_idx" ON "Order"("buyerId","createdAt");
CREATE INDEX "Order_countryId_paymentStatus_createdAt_idx" ON "Order"("countryId","paymentStatus","createdAt");

CREATE TABLE "VendorSuborder" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "publicReference" VARCHAR(40) NOT NULL,
  "orderId" UUID NOT NULL,
  "vendorId" UUID NOT NULL,
  "storeId" UUID NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "subtotalMinor" BIGINT NOT NULL,
  "status" "VendorSuborderStatus" NOT NULL DEFAULT 'PENDING_VENDOR',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VendorSuborder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VendorSuborder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorSuborder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorSuborder_subtotal_positive" CHECK ("subtotalMinor" > 0),
  CONSTRAINT "VendorSuborder_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$')
);
CREATE UNIQUE INDEX "VendorSuborder_publicReference_key" ON "VendorSuborder"("publicReference");
CREATE UNIQUE INDEX "VendorSuborder_orderId_vendorId_storeId_key" ON "VendorSuborder"("orderId","vendorId","storeId");
CREATE INDEX "VendorSuborder_vendorId_createdAt_idx" ON "VendorSuborder"("vendorId","createdAt");
CREATE INDEX "VendorSuborder_storeId_createdAt_idx" ON "VendorSuborder"("storeId","createdAt");

CREATE TABLE "OrderItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "suborderId" UUID NOT NULL,
  "quoteItemId" UUID NOT NULL,
  "variantId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "productTitle" VARCHAR(200) NOT NULL,
  "sku" VARCHAR(120) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPriceMinor" BIGINT NOT NULL,
  "lineTotalMinor" BIGINT NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderItem_suborderId_fkey" FOREIGN KEY ("suborderId") REFERENCES "VendorSuborder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderItem_quoteItemId_fkey" FOREIGN KEY ("quoteItemId") REFERENCES "CheckoutQuoteItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderItem_quantity_bounds" CHECK ("quantity" BETWEEN 1 AND 100),
  CONSTRAINT "OrderItem_price_positive" CHECK ("unitPriceMinor" > 0 AND "lineTotalMinor" > 0),
  CONSTRAINT "OrderItem_line_total" CHECK ("lineTotalMinor" = "unitPriceMinor" * "quantity"),
  CONSTRAINT "OrderItem_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$')
);
CREATE UNIQUE INDEX "OrderItem_quoteItemId_key" ON "OrderItem"("quoteItemId");
CREATE INDEX "OrderItem_suborderId_idx" ON "OrderItem"("suborderId");
CREATE INDEX "OrderItem_variantId_idx" ON "OrderItem"("variantId");

CREATE TABLE "PaymentIntent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orderId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "commandKey" VARCHAR(128) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "merchantReference" VARCHAR(64) NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "environment" "PaymentEnvironment" NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "status" "PaymentIntentStatus" NOT NULL DEFAULT 'CREATED',
  "providerReference" VARCHAR(128),
  "verificationMethod" VARCHAR(64),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentIntent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentIntent_amount_positive" CHECK ("amountMinor" > 0),
  CONSTRAINT "PaymentIntent_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "PaymentIntent_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "PaymentIntent_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "PaymentIntent_ttl_bounds" CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '900 seconds')
);
CREATE UNIQUE INDEX "PaymentIntent_merchantReference_key" ON "PaymentIntent"("merchantReference");
CREATE UNIQUE INDEX "PaymentIntent_orderId_commandKey_key" ON "PaymentIntent"("orderId","commandKey");
CREATE UNIQUE INDEX "PaymentIntent_one_active_per_order" ON "PaymentIntent"("orderId") WHERE "status" IN ('CREATED','PENDING','UNKNOWN');
CREATE INDEX "PaymentIntent_orderId_status_idx" ON "PaymentIntent"("orderId","status");
CREATE INDEX "PaymentIntent_userId_createdAt_idx" ON "PaymentIntent"("userId","createdAt");
CREATE INDEX "PaymentIntent_status_expiresAt_idx" ON "PaymentIntent"("status","expiresAt");

CREATE TABLE "PaymentWebhookEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" "PaymentProvider" NOT NULL,
  "environment" "PaymentEnvironment" NOT NULL,
  "dedupeKey" VARCHAR(160) NOT NULL,
  "providerEventId" VARCHAR(128) NOT NULL,
  "providerReference" VARCHAR(128),
  "merchantReference" VARCHAR(64) NOT NULL,
  "intentId" UUID,
  "payloadHash" VARCHAR(64) NOT NULL,
  "status" "PaymentWebhookStatus" NOT NULL,
  "rejectionReason" VARCHAR(128),
  "redactedPayload" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentWebhookEvent_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentWebhookEvent_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "PaymentWebhookEvent_dedupeKey_key" ON "PaymentWebhookEvent"("dedupeKey");
CREATE INDEX "PaymentWebhookEvent_intentId_receivedAt_idx" ON "PaymentWebhookEvent"("intentId","receivedAt");
CREATE INDEX "PaymentWebhookEvent_merchantReference_receivedAt_idx" ON "PaymentWebhookEvent"("merchantReference","receivedAt");

CREATE TABLE "CodPolicy" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "countryId" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "maxOrderMinor" BIGINT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CodPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CodPolicy_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CodPolicy_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CodPolicy_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CodPolicy_max_positive" CHECK ("maxOrderMinor" > 0),
  CONSTRAINT "CodPolicy_version_positive" CHECK ("version" >= 1)
);
CREATE UNIQUE INDEX "CodPolicy_countryId_key" ON "CodPolicy"("countryId");

-- RLS
ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY; ALTER TABLE "Order" FORCE ROW LEVEL SECURITY;
CREATE POLICY order_select_buyer_or_super ON "Order" FOR SELECT USING (gs_is_super() OR "buyerId" = gs_current_user_id());
CREATE POLICY order_insert_super ON "Order" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY order_update_super ON "Order" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

ALTER TABLE "VendorSuborder" ENABLE ROW LEVEL SECURITY; ALTER TABLE "VendorSuborder" FORCE ROW LEVEL SECURITY;
CREATE POLICY suborder_select_buyer_member_or_super ON "VendorSuborder" FOR SELECT USING (
  gs_is_super() OR EXISTS (SELECT 1 FROM "Order" o WHERE o."id" = "VendorSuborder"."orderId" AND o."buyerId" = gs_current_user_id())
  OR EXISTS (SELECT 1 FROM "VendorMembership" m WHERE m."vendorId" = "VendorSuborder"."vendorId" AND m."userId" = gs_current_user_id() AND m."revokedAt" IS NULL AND (m."expiresAt" IS NULL OR m."expiresAt" > CURRENT_TIMESTAMP))
);
CREATE POLICY suborder_insert_super ON "VendorSuborder" FOR INSERT WITH CHECK (gs_is_super());

ALTER TABLE "OrderItem" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OrderItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY order_item_select_buyer_member_or_super ON "OrderItem" FOR SELECT USING (
  gs_is_super() OR EXISTS (SELECT 1 FROM "VendorSuborder" s JOIN "Order" o ON o."id" = s."orderId" WHERE s."id" = "OrderItem"."suborderId" AND o."buyerId" = gs_current_user_id())
  OR EXISTS (SELECT 1 FROM "VendorSuborder" s JOIN "VendorMembership" m ON m."vendorId" = s."vendorId" WHERE s."id" = "OrderItem"."suborderId" AND m."userId" = gs_current_user_id() AND m."revokedAt" IS NULL AND (m."expiresAt" IS NULL OR m."expiresAt" > CURRENT_TIMESTAMP))
);
CREATE POLICY order_item_insert_super ON "OrderItem" FOR INSERT WITH CHECK (gs_is_super());

ALTER TABLE "PaymentIntent" ENABLE ROW LEVEL SECURITY; ALTER TABLE "PaymentIntent" FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_intent_select_self_or_super ON "PaymentIntent" FOR SELECT USING (gs_is_super() OR "userId" = gs_current_user_id());
CREATE POLICY payment_intent_insert_super ON "PaymentIntent" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY payment_intent_update_super ON "PaymentIntent" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

ALTER TABLE "PaymentWebhookEvent" ENABLE ROW LEVEL SECURITY; ALTER TABLE "PaymentWebhookEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_webhook_super_only ON "PaymentWebhookEvent" FOR SELECT USING (gs_is_super());
CREATE POLICY payment_webhook_insert_super ON "PaymentWebhookEvent" FOR INSERT WITH CHECK (gs_is_super());

ALTER TABLE "CodPolicy" ENABLE ROW LEVEL SECURITY; ALTER TABLE "CodPolicy" FORCE ROW LEVEL SECURITY;
CREATE POLICY cod_policy_super_only ON "CodPolicy" FOR SELECT USING (gs_is_super());
CREATE POLICY cod_policy_insert_super ON "CodPolicy" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY cod_policy_update_super ON "CodPolicy" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

-- Extend quote lifecycle for consumed quotes.
CREATE OR REPLACE FUNCTION gs_checkout_quote_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'checkout_write_privileged_only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."cartId" IS DISTINCT FROM OLD."cartId" OR NEW."cartVersion" IS DISTINCT FROM OLD."cartVersion" OR NEW."destinationCityId" IS DISTINCT FROM OLD."destinationCityId" OR NEW."commandKey" IS DISTINCT FROM OLD."commandKey" OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash" OR NEW."currency" IS DISTINCT FROM OLD."currency" OR NEW."subtotalMinor" IS DISTINCT FROM OLD."subtotalMinor" OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'checkout_quote_immutable_fields';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'checkout_quote_version_conflict'; END IF;
  IF OLD."state" <> 'RESERVED' OR NEW."state" NOT IN ('RELEASED','EXPIRED','CONSUMED') OR NEW."closedAt" IS NULL THEN RAISE EXCEPTION 'checkout_quote_invalid_transition'; END IF;
  IF NEW."state" = 'EXPIRED' AND OLD."expiresAt" > CURRENT_TIMESTAMP THEN RAISE EXCEPTION 'checkout_quote_not_expired'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION gs_checkout_quote_sync_on_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q "CheckoutQuote"%ROWTYPE; quote_id UUID; next_state "CheckoutQuoteState"; occurrence TEXT; now_ts TIMESTAMP(3) := CURRENT_TIMESTAMP;
BEGIN
  IF OLD."state" <> 'ACTIVE' OR NEW."state" = 'ACTIVE' THEN RETURN NULL; END IF;
  SELECT "quoteId" INTO quote_id FROM "CheckoutQuoteItem" WHERE "reservationId" = NEW."id";
  IF quote_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO q FROM "CheckoutQuote" WHERE "id" = quote_id FOR UPDATE;
  IF q."state" <> 'RESERVED' THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM "CheckoutQuoteItem" i JOIN "InventoryReservation" r ON r."id" = i."reservationId" WHERE i."quoteId" = quote_id AND r."state" = 'ACTIVE') THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM "CheckoutQuoteItem" i JOIN "InventoryReservation" r ON r."id" = i."reservationId" WHERE i."quoteId" = quote_id AND r."state" = 'EXPIRED') THEN
    next_state := 'EXPIRED';
  ELSIF EXISTS (SELECT 1 FROM "CheckoutQuoteItem" i JOIN "InventoryReservation" r ON r."id" = i."reservationId" WHERE i."quoteId" = quote_id AND r."state" = 'CONSUMED') THEN
    next_state := 'CONSUMED';
  ELSE
    next_state := 'RELEASED';
  END IF;
  UPDATE "CheckoutQuote" SET "state" = next_state, "closedAt" = now_ts, "version" = "version" + 1, "updatedAt" = now_ts WHERE "id" = quote_id;
  INSERT INTO "AuditLog"(id,"actorType",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId")
  VALUES (gen_random_uuid(), 'SYSTEM', 'checkout.quote.' || lower(next_state::text), 'CheckoutQuote', quote_id, jsonb_build_object('countryId', q."countryId"), 'reservation lifecycle synchronization', gen_random_uuid()::text);
  occurrence := to_char(now_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  INSERT INTO "OutboxEvent"(id,"aggregateType","aggregateId","eventKey","eventType",payload,"occurredAt")
  VALUES (gen_random_uuid(), 'CheckoutQuote', quote_id, 'checkout-quote-' || lower(next_state::text) || '-' || quote_id, 'checkout.quote.' || lower(next_state::text),
    jsonb_build_object('schemaVersion',1,'eventKey','checkout-quote-' || lower(next_state::text) || '-' || quote_id,'eventType','checkout.quote.' || lower(next_state::text),'occurredAt',occurrence,'aggregateType','CheckoutQuote','aggregateId',quote_id,'countryId',q."countryId",'data',jsonb_build_object('quoteId',quote_id,'state',next_state)), now_ts);
  RETURN NULL;
END;
$$;

-- Order guards.
CREATE OR REPLACE FUNCTION gs_order_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q "CheckoutQuote"%ROWTYPE; cod "CodPolicy"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'order_write_privileged_only'; END IF;
  IF NEW."version" <> 1 THEN RAISE EXCEPTION 'order_version_invalid'; END IF;
  IF NEW."commandKey" !~ '^[A-Za-z0-9:_-]{8,128}$' THEN RAISE EXCEPTION 'order_command_key_invalid'; END IF;
  SELECT * INTO q FROM "CheckoutQuote" WHERE "id" = NEW."quoteId";
  IF NOT FOUND OR q."userId" <> NEW."buyerId" OR q."countryId" <> NEW."countryId" OR q."destinationCityId" <> NEW."destinationCityId" THEN RAISE EXCEPTION 'order_quote_ownership_mismatch'; END IF;
  IF q."state" NOT IN ('RESERVED','CONSUMED') THEN RAISE EXCEPTION 'order_quote_not_consumable'; END IF;
  IF q."state" = 'RESERVED' AND q."expiresAt" <= CURRENT_TIMESTAMP THEN RAISE EXCEPTION 'order_quote_expired'; END IF;
  IF NEW."amountMinor" <> q."subtotalMinor" OR NEW."currency" <> q."currency" THEN RAISE EXCEPTION 'order_amount_mismatch'; END IF;
  IF NEW."paymentMethod" = 'COD' THEN
    IF NEW."paymentStatus" <> 'AWAITING_COD' THEN RAISE EXCEPTION 'order_cod_status_invalid'; END IF;
    SELECT * INTO cod FROM "CodPolicy" WHERE "countryId" = NEW."countryId";
    IF NOT FOUND OR cod."enabled" <> true OR NEW."amountMinor" > cod."maxOrderMinor" THEN RAISE EXCEPTION 'cod_not_eligible'; END IF;
  ELSIF NEW."paymentMethod" = 'SANDBOX_MANUAL' THEN
    IF NEW."paymentStatus" <> 'AWAITING_PAYMENT' THEN RAISE EXCEPTION 'order_payment_status_invalid'; END IF;
  ELSE
    RAISE EXCEPTION 'order_payment_method_disabled';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER order_insert_guard BEFORE INSERT ON "Order" FOR EACH ROW EXECUTE FUNCTION gs_order_insert_guard();

CREATE OR REPLACE FUNCTION gs_order_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'order_write_privileged_only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."publicReference" IS DISTINCT FROM OLD."publicReference" OR NEW."buyerId" IS DISTINCT FROM OLD."buyerId" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."destinationCityId" IS DISTINCT FROM OLD."destinationCityId" OR NEW."quoteId" IS DISTINCT FROM OLD."quoteId" OR NEW."commandKey" IS DISTINCT FROM OLD."commandKey" OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash" OR NEW."currency" IS DISTINCT FROM OLD."currency" OR NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor" OR NEW."pricingScope" IS DISTINCT FROM OLD."pricingScope" OR NEW."paymentMethod" IS DISTINCT FROM OLD."paymentMethod" OR NEW."codEligibility" IS DISTINCT FROM OLD."codEligibility" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'order_immutable_fields';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'order_version_conflict'; END IF;
  IF OLD."paymentStatus" <> 'AWAITING_PAYMENT' OR NEW."paymentStatus" NOT IN ('PAYMENT_VERIFIED','PAYMENT_FAILED') THEN RAISE EXCEPTION 'order_payment_invalid_transition'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER order_update_guard BEFORE UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION gs_order_update_guard();

CREATE OR REPLACE FUNCTION gs_suborder_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o "Order"%ROWTYPE; s "VendorSuborder"%ROWTYPE; qi "CheckoutQuoteItem"%ROWTYPE; qg "CheckoutQuoteGroup"%ROWTYPE; st "Store"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'order_write_privileged_only'; END IF;
  IF TG_TABLE_NAME = 'VendorSuborder' THEN
    SELECT * INTO o FROM "Order" WHERE "id" = NEW."orderId";
    SELECT * INTO st FROM "Store" WHERE "id" = NEW."storeId";
    IF NOT FOUND OR st."vendorId" <> NEW."vendorId" OR st."countryId" <> o."countryId" THEN RAISE EXCEPTION 'suborder_ancestry_mismatch'; END IF;
    IF NEW."currency" <> o."currency" THEN RAISE EXCEPTION 'suborder_currency_mismatch'; END IF;
    RETURN NEW;
  ELSE
    SELECT * INTO s FROM "VendorSuborder" WHERE "id" = NEW."suborderId";
    SELECT * INTO o FROM "Order" WHERE "id" = s."orderId";
    SELECT * INTO qi FROM "CheckoutQuoteItem" WHERE "id" = NEW."quoteItemId";
    SELECT * INTO qg FROM "CheckoutQuoteGroup" WHERE "id" = qi."groupId";
    IF qi."quoteId" <> o."quoteId" OR qg."vendorId" <> s."vendorId" OR qg."storeId" <> s."storeId" THEN RAISE EXCEPTION 'order_item_quote_mismatch'; END IF;
    IF NEW."variantId" <> qi."variantId" OR NEW."productId" <> qi."productId" OR NEW."productTitle" <> qi."productTitle" OR NEW."sku" <> qi."sku" OR NEW."quantity" <> qi."quantity" OR NEW."unitPriceMinor" <> qi."unitPriceMinor" OR NEW."lineTotalMinor" <> qi."lineTotalMinor" OR NEW."currency" <> qi."currency" THEN RAISE EXCEPTION 'order_item_snapshot_mismatch'; END IF;
    RETURN NEW;
  END IF;
END;
$$;
CREATE TRIGGER suborder_insert_guard BEFORE INSERT ON "VendorSuborder" FOR EACH ROW EXECUTE FUNCTION gs_suborder_item_guard();
CREATE TRIGGER order_item_insert_guard BEFORE INSERT ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION gs_suborder_item_guard();

CREATE OR REPLACE FUNCTION gs_order_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_id UUID; o "Order"%ROWTYPE; sub_sum BIGINT; item_sum BIGINT; bad INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'Order' THEN order_id := NEW."id"; ELSE
    SELECT "orderId" INTO order_id FROM "VendorSuborder" WHERE "id" = NEW."suborderId";
  END IF;
  SELECT * INTO o FROM "Order" WHERE "id" = order_id;
  SELECT COALESCE(SUM("subtotalMinor"),0) INTO sub_sum FROM "VendorSuborder" WHERE "orderId" = order_id;
  SELECT COALESCE(SUM(i."lineTotalMinor"),0) INTO item_sum FROM "OrderItem" i JOIN "VendorSuborder" s ON s."id" = i."suborderId" WHERE s."orderId" = order_id;
  IF sub_sum <> o."amountMinor" OR item_sum <> o."amountMinor" THEN RAISE EXCEPTION 'order_total_mismatch'; END IF;
  SELECT count(*) INTO bad FROM "CheckoutQuoteItem" qi JOIN "InventoryReservation" r ON r."id" = qi."reservationId"
    WHERE qi."quoteId" = o."quoteId" AND r."state" <> 'CONSUMED';
  IF bad > 0 THEN RAISE EXCEPTION 'order_reservations_not_consumed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "CheckoutQuote" WHERE "id" = o."quoteId" AND "state" = 'CONSUMED') THEN RAISE EXCEPTION 'order_quote_not_consumed'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER order_consistent_insert AFTER INSERT ON "Order" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_order_consistent();
CREATE CONSTRAINT TRIGGER order_consistent_item AFTER INSERT ON "OrderItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_order_consistent();

-- Payment intent guards.
CREATE OR REPLACE FUNCTION gs_payment_intent_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o "Order"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'payment_write_privileged_only'; END IF;
  IF NEW."provider" <> 'SANDBOX_MANUAL' OR NEW."environment" <> 'SANDBOX' THEN RAISE EXCEPTION 'payment_provider_disabled'; END IF;
  IF NEW."status" <> 'PENDING' OR NEW."version" <> 1 OR NEW."closedAt" IS NOT NULL THEN RAISE EXCEPTION 'payment_intent_must_start_pending'; END IF;
  SELECT * INTO o FROM "Order" WHERE "id" = NEW."orderId";
  IF NOT FOUND OR o."buyerId" <> NEW."userId" THEN RAISE EXCEPTION 'payment_order_ownership_mismatch'; END IF;
  IF o."paymentMethod" <> 'SANDBOX_MANUAL' OR o."paymentStatus" <> 'AWAITING_PAYMENT' THEN RAISE EXCEPTION 'payment_order_not_payable'; END IF;
  IF NEW."amountMinor" <> o."amountMinor" OR NEW."currency" <> o."currency" THEN RAISE EXCEPTION 'payment_amount_mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_intent_insert_guard BEFORE INSERT ON "PaymentIntent" FOR EACH ROW EXECUTE FUNCTION gs_payment_intent_insert_guard();

CREATE OR REPLACE FUNCTION gs_payment_intent_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'payment_write_privileged_only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."orderId" IS DISTINCT FROM OLD."orderId" OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."commandKey" IS DISTINCT FROM OLD."commandKey" OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash" OR NEW."merchantReference" IS DISTINCT FROM OLD."merchantReference" OR NEW."provider" IS DISTINCT FROM OLD."provider" OR NEW."environment" IS DISTINCT FROM OLD."environment" OR NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor" OR NEW."currency" IS DISTINCT FROM OLD."currency" OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'payment_intent_immutable_fields';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'payment_intent_version_conflict'; END IF;
  IF OLD."status" NOT IN ('CREATED','PENDING','UNKNOWN') OR NEW."status" NOT IN ('UNKNOWN','VERIFIED','FAILED','CANCELLED','EXPIRED') THEN RAISE EXCEPTION 'payment_intent_invalid_transition'; END IF;
  IF NEW."status" IN ('VERIFIED','FAILED','CANCELLED','EXPIRED') AND NEW."closedAt" IS NULL THEN RAISE EXCEPTION 'payment_intent_closed_at_required'; END IF;
  IF NEW."status" = 'EXPIRED' AND OLD."expiresAt" > CURRENT_TIMESTAMP THEN RAISE EXCEPTION 'payment_intent_not_expired'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_intent_update_guard BEFORE UPDATE ON "PaymentIntent" FOR EACH ROW EXECUTE FUNCTION gs_payment_intent_update_guard();

CREATE OR REPLACE FUNCTION gs_cod_policy_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'cod_policy_write_privileged_only'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."id" <> OLD."id" OR NEW."countryId" <> OLD."countryId" OR NEW."createdByUserId" <> OLD."createdByUserId" OR NEW."createdAt" <> OLD."createdAt" OR NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'cod_policy_invalid_update'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cod_policy_guard BEFORE INSERT OR UPDATE ON "CodPolicy" FOR EACH ROW EXECUTE FUNCTION gs_cod_policy_guard();

COMMENT ON TABLE "Order" IS 'Immutable order boundary created from a consumed checkout quote; product subtotal only until delivery pricing exists.';
COMMENT ON TABLE "VendorSuborder" IS 'Vendor/store split snapshot; fulfillment lifecycle not yet implemented.';
COMMENT ON TABLE "OrderItem" IS 'Immutable order line copied from quote item snapshot.';
COMMENT ON TABLE "PaymentIntent" IS 'Sandbox/manual payment intent; live providers disabled.';
COMMENT ON TABLE "PaymentWebhookEvent" IS 'Redacted idempotent webhook evidence; no raw secrets.';
COMMENT ON TABLE "CodPolicy" IS 'Country COD eligibility policy; disabled by default.';
