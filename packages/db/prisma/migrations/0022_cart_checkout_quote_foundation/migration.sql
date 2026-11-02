-- Cart + checkout quote foundation. Additive only; no existing rows are rewritten.
CREATE TYPE "CheckoutQuoteState" AS ENUM ('RESERVED','RELEASED','EXPIRED');

CREATE TABLE "Cart" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "countryId" UUID NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Cart_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Cart_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Cart_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Cart_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "Cart_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$')
);
CREATE UNIQUE INDEX "Cart_userId_countryId_key" ON "Cart"("userId","countryId");
CREATE INDEX "Cart_countryId_createdAt_idx" ON "Cart"("countryId","createdAt");

CREATE TABLE "CartItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cartId" UUID NOT NULL,
  "variantId" UUID NOT NULL,
  "storeId" UUID NOT NULL,
  "vendorId" UUID NOT NULL,
  "countryId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CartItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CartItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CartItem_quantity_bounds" CHECK ("quantity" BETWEEN 1 AND 100)
);
CREATE UNIQUE INDEX "CartItem_cartId_variantId_key" ON "CartItem"("cartId","variantId");
CREATE INDEX "CartItem_cartId_createdAt_idx" ON "CartItem"("cartId","createdAt");
CREATE INDEX "CartItem_variantId_idx" ON "CartItem"("variantId");

CREATE TABLE "CheckoutQuote" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "countryId" UUID NOT NULL,
  "cartId" UUID NOT NULL,
  "cartVersion" INTEGER NOT NULL,
  "destinationCityId" UUID NOT NULL,
  "commandKey" VARCHAR(128) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "subtotalMinor" BIGINT NOT NULL,
  "state" "CheckoutQuoteState" NOT NULL DEFAULT 'RESERVED',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CheckoutQuote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CheckoutQuote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CheckoutQuote_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CheckoutQuote_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CheckoutQuote_destinationCityId_fkey" FOREIGN KEY ("destinationCityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CheckoutQuote_subtotal_positive" CHECK ("subtotalMinor" > 0),
  CONSTRAINT "CheckoutQuote_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "CheckoutQuote_cartVersion_positive" CHECK ("cartVersion" >= 1),
  CONSTRAINT "CheckoutQuote_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "CheckoutQuote_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "CheckoutQuote_ttl_bounds" CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '900 seconds')
);
CREATE UNIQUE INDEX "CheckoutQuote_userId_commandKey_key" ON "CheckoutQuote"("userId","commandKey");
CREATE UNIQUE INDEX "CheckoutQuote_one_reserved_per_cart_version" ON "CheckoutQuote"("cartId","cartVersion") WHERE "state" = 'RESERVED';
CREATE INDEX "CheckoutQuote_userId_state_createdAt_idx" ON "CheckoutQuote"("userId","state","createdAt");
CREATE INDEX "CheckoutQuote_cartId_state_idx" ON "CheckoutQuote"("cartId","state");
CREATE INDEX "CheckoutQuote_state_expiresAt_idx" ON "CheckoutQuote"("state","expiresAt");

CREATE TABLE "CheckoutQuoteGroup" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "quoteId" UUID NOT NULL,
  "vendorId" UUID NOT NULL,
  "storeId" UUID NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "subtotalMinor" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CheckoutQuoteGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CheckoutQuoteGroup_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "CheckoutQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CheckoutQuoteGroup_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CheckoutQuoteGroup_subtotal_positive" CHECK ("subtotalMinor" > 0),
  CONSTRAINT "CheckoutQuoteGroup_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$')
);
CREATE UNIQUE INDEX "CheckoutQuoteGroup_quoteId_vendorId_storeId_key" ON "CheckoutQuoteGroup"("quoteId","vendorId","storeId");
CREATE INDEX "CheckoutQuoteGroup_quoteId_idx" ON "CheckoutQuoteGroup"("quoteId");

CREATE TABLE "CheckoutQuoteItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "quoteId" UUID NOT NULL,
  "groupId" UUID NOT NULL,
  "reservationId" UUID NOT NULL,
  "variantId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "productTitle" VARCHAR(200) NOT NULL,
  "sku" VARCHAR(120) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPriceMinor" BIGINT NOT NULL,
  "lineTotalMinor" BIGINT NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CheckoutQuoteItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CheckoutQuoteItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "CheckoutQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CheckoutQuoteItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CheckoutQuoteGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CheckoutQuoteItem_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "InventoryReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CheckoutQuoteItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CheckoutQuoteItem_quantity_bounds" CHECK ("quantity" BETWEEN 1 AND 100),
  CONSTRAINT "CheckoutQuoteItem_price_positive" CHECK ("unitPriceMinor" > 0 AND "lineTotalMinor" > 0),
  CONSTRAINT "CheckoutQuoteItem_line_total" CHECK ("lineTotalMinor" = "unitPriceMinor" * "quantity"),
  CONSTRAINT "CheckoutQuoteItem_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$')
);
CREATE UNIQUE INDEX "CheckoutQuoteItem_reservationId_key" ON "CheckoutQuoteItem"("reservationId");
CREATE UNIQUE INDEX "CheckoutQuoteItem_quoteId_variantId_key" ON "CheckoutQuoteItem"("quoteId","variantId");
CREATE INDEX "CheckoutQuoteItem_quoteId_idx" ON "CheckoutQuoteItem"("quoteId");
CREATE INDEX "CheckoutQuoteItem_groupId_idx" ON "CheckoutQuoteItem"("groupId");

-- RLS: owners may read through runtime; all writes are privileged service commands.
ALTER TABLE "Cart" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Cart" FORCE ROW LEVEL SECURITY;
CREATE POLICY cart_select_self_or_super ON "Cart" FOR SELECT USING (gs_is_super() OR "userId" = gs_current_user_id());
CREATE POLICY cart_insert_super ON "Cart" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY cart_update_super ON "Cart" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

ALTER TABLE "CartItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CartItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY cart_item_select_self_or_super ON "CartItem" FOR SELECT USING (
  gs_is_super() OR EXISTS (SELECT 1 FROM "Cart" c WHERE c."id" = "CartItem"."cartId" AND c."userId" = gs_current_user_id())
);
CREATE POLICY cart_item_insert_super ON "CartItem" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY cart_item_update_super ON "CartItem" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());
CREATE POLICY cart_item_delete_super ON "CartItem" FOR DELETE USING (gs_is_super());

ALTER TABLE "CheckoutQuote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CheckoutQuote" FORCE ROW LEVEL SECURITY;
CREATE POLICY checkout_quote_select_self_or_super ON "CheckoutQuote" FOR SELECT USING (gs_is_super() OR "userId" = gs_current_user_id());
CREATE POLICY checkout_quote_insert_super ON "CheckoutQuote" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY checkout_quote_update_super ON "CheckoutQuote" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

ALTER TABLE "CheckoutQuoteGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CheckoutQuoteGroup" FORCE ROW LEVEL SECURITY;
CREATE POLICY checkout_group_select_self_or_super ON "CheckoutQuoteGroup" FOR SELECT USING (
  gs_is_super() OR EXISTS (SELECT 1 FROM "CheckoutQuote" q WHERE q."id" = "CheckoutQuoteGroup"."quoteId" AND q."userId" = gs_current_user_id())
);
CREATE POLICY checkout_group_insert_super ON "CheckoutQuoteGroup" FOR INSERT WITH CHECK (gs_is_super());

ALTER TABLE "CheckoutQuoteItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CheckoutQuoteItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY checkout_item_select_self_or_super ON "CheckoutQuoteItem" FOR SELECT USING (
  gs_is_super() OR EXISTS (SELECT 1 FROM "CheckoutQuote" q WHERE q."id" = "CheckoutQuoteItem"."quoteId" AND q."userId" = gs_current_user_id())
);
CREATE POLICY checkout_item_insert_super ON "CheckoutQuoteItem" FOR INSERT WITH CHECK (gs_is_super());

-- Cart guards.
CREATE OR REPLACE FUNCTION gs_cart_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "Country"%ROWTYPE; u "User"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'cart_write_privileged_only'; END IF;
  IF NEW."version" <> 1 THEN RAISE EXCEPTION 'cart_version_invalid'; END IF;
  SELECT * INTO u FROM "User" WHERE "id" = NEW."userId";
  IF NOT FOUND OR u."status" <> 'ACTIVE' THEN RAISE EXCEPTION 'cart_user_not_active'; END IF;
  SELECT * INTO c FROM "Country" WHERE "id" = NEW."countryId";
  IF NOT FOUND OR c."status" <> 'ACTIVE' THEN RAISE EXCEPTION 'cart_country_not_active'; END IF;
  IF NEW."currency" <> c."currencyCode" THEN RAISE EXCEPTION 'cart_currency_mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cart_insert_guard BEFORE INSERT ON "Cart" FOR EACH ROW EXECUTE FUNCTION gs_cart_insert_guard();

CREATE OR REPLACE FUNCTION gs_cart_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'cart_write_privileged_only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."currency" IS DISTINCT FROM OLD."currency" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'cart_immutable_fields';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'cart_version_conflict'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cart_update_guard BEFORE UPDATE ON "Cart" FOR EACH ROW EXECUTE FUNCTION gs_cart_update_guard();

CREATE OR REPLACE FUNCTION gs_cart_variant_sellable(variant_uuid UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "ProductVariant" v
    JOIN "Product" p ON p."id" = v."productId"
    JOIN "Store" s ON s."id" = p."storeId"
    JOIN "Country" c ON c."id" = p."countryId"
    WHERE v."id" = variant_uuid AND v."active" = true
      AND p."status" = 'PUBLISHED' AND s."status" = 'ACTIVE' AND c."status" = 'ACTIVE'
      AND gs_inventory_vendor_eligible(p."vendorId")
      AND (p."categoryId" IS NULL OR gs_category_chain_active(p."categoryId"))
  );
$$;

CREATE OR REPLACE FUNCTION gs_cart_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cart "Cart"%ROWTYPE; var "ProductVariant"%ROWTYPE; p "Product"%ROWTYPE; item_count INTEGER;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'cart_write_privileged_only'; END IF;
  SELECT * INTO cart FROM "Cart" WHERE "id" = NEW."cartId";
  IF NOT FOUND THEN RAISE EXCEPTION 'cart_not_found'; END IF;
  SELECT * INTO var FROM "ProductVariant" WHERE "id" = NEW."variantId";
  IF NOT FOUND THEN RAISE EXCEPTION 'cart_variant_not_found'; END IF;
  SELECT * INTO p FROM "Product" WHERE "id" = var."productId";
  IF p."storeId" <> NEW."storeId" OR p."vendorId" <> NEW."vendorId" OR p."countryId" <> NEW."countryId" OR NEW."countryId" <> cart."countryId" THEN
    RAISE EXCEPTION 'cart_item_ancestry_mismatch';
  END IF;
  IF NOT gs_cart_variant_sellable(NEW."variantId") THEN RAISE EXCEPTION 'cart_variant_not_sellable'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO item_count FROM "CartItem" WHERE "cartId" = NEW."cartId";
    IF item_count >= 50 THEN RAISE EXCEPTION 'cart_item_limit'; END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."id" <> OLD."id" OR NEW."cartId" <> OLD."cartId" OR NEW."variantId" <> OLD."variantId" OR NEW."storeId" <> OLD."storeId" OR NEW."vendorId" <> OLD."vendorId" OR NEW."countryId" <> OLD."countryId" OR NEW."createdAt" <> OLD."createdAt") THEN
    RAISE EXCEPTION 'cart_item_immutable_fields';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cart_item_guard BEFORE INSERT OR UPDATE ON "CartItem" FOR EACH ROW EXECUTE FUNCTION gs_cart_item_guard();

CREATE OR REPLACE FUNCTION gs_cart_item_bump_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_cart UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN target_cart := OLD."cartId"; ELSE target_cart := NEW."cartId"; END IF;
  UPDATE "Cart" SET "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = target_cart;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cart_item_bump_version AFTER INSERT OR UPDATE OR DELETE ON "CartItem" FOR EACH ROW EXECUTE FUNCTION gs_cart_item_bump_version();

-- Quote guards.
CREATE OR REPLACE FUNCTION gs_checkout_quote_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cart "Cart"%ROWTYPE; c "Country"%ROWTYPE; city_ok BOOLEAN; active_count INTEGER;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'checkout_write_privileged_only'; END IF;
  IF NEW."state" <> 'RESERVED' OR NEW."version" <> 1 OR NEW."closedAt" IS NOT NULL THEN RAISE EXCEPTION 'checkout_quote_must_start_reserved'; END IF;
  IF NEW."commandKey" !~ '^[A-Za-z0-9:_-]{8,128}$' THEN RAISE EXCEPTION 'checkout_command_key_invalid'; END IF;
  SELECT * INTO cart FROM "Cart" WHERE "id" = NEW."cartId";
  IF NOT FOUND OR cart."userId" <> NEW."userId" OR cart."countryId" <> NEW."countryId" THEN RAISE EXCEPTION 'checkout_cart_ownership_mismatch'; END IF;
  IF NEW."cartVersion" <> cart."version" THEN RAISE EXCEPTION 'checkout_cart_version_conflict'; END IF;
  SELECT * INTO c FROM "Country" WHERE "id" = NEW."countryId";
  IF c."status" <> 'ACTIVE' OR NEW."currency" <> c."currencyCode" OR NEW."currency" <> cart."currency" THEN RAISE EXCEPTION 'checkout_country_currency_invalid'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM "City" ci JOIN "District" d ON d."id" = ci."districtId" JOIN "Region" r ON r."id" = d."regionId"
    WHERE ci."id" = NEW."destinationCityId" AND ci."status" = 'ACTIVE' AND r."countryId" = NEW."countryId"
  ) INTO city_ok;
  IF NOT city_ok THEN RAISE EXCEPTION 'checkout_destination_city_invalid'; END IF;
  SELECT count(*) INTO active_count FROM "CheckoutQuote" WHERE "userId" = NEW."userId" AND "state" = 'RESERVED';
  IF active_count >= 5 THEN RAISE EXCEPTION 'checkout_active_quote_limit'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER checkout_quote_insert_guard BEFORE INSERT ON "CheckoutQuote" FOR EACH ROW EXECUTE FUNCTION gs_checkout_quote_insert_guard();

CREATE OR REPLACE FUNCTION gs_checkout_quote_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'checkout_write_privileged_only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."cartId" IS DISTINCT FROM OLD."cartId" OR NEW."cartVersion" IS DISTINCT FROM OLD."cartVersion" OR NEW."destinationCityId" IS DISTINCT FROM OLD."destinationCityId" OR NEW."commandKey" IS DISTINCT FROM OLD."commandKey" OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash" OR NEW."currency" IS DISTINCT FROM OLD."currency" OR NEW."subtotalMinor" IS DISTINCT FROM OLD."subtotalMinor" OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'checkout_quote_immutable_fields';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'checkout_quote_version_conflict'; END IF;
  IF OLD."state" <> 'RESERVED' OR NEW."state" NOT IN ('RELEASED','EXPIRED') OR NEW."closedAt" IS NULL THEN RAISE EXCEPTION 'checkout_quote_invalid_transition'; END IF;
  IF NEW."state" = 'EXPIRED' AND OLD."expiresAt" > CURRENT_TIMESTAMP THEN RAISE EXCEPTION 'checkout_quote_not_expired'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER checkout_quote_update_guard BEFORE UPDATE ON "CheckoutQuote" FOR EACH ROW EXECUTE FUNCTION gs_checkout_quote_update_guard();

CREATE OR REPLACE FUNCTION gs_checkout_group_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q "CheckoutQuote"%ROWTYPE; g "CheckoutQuoteGroup"%ROWTYPE; r "InventoryReservation"%ROWTYPE; i "Inventory"%ROWTYPE; var "ProductVariant"%ROWTYPE; p "Product"%ROWTYPE; s "Store"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'checkout_write_privileged_only'; END IF;
  IF TG_TABLE_NAME = 'CheckoutQuoteGroup' THEN
    SELECT * INTO q FROM "CheckoutQuote" WHERE "id" = NEW."quoteId";
    IF NOT FOUND OR q."state" <> 'RESERVED' THEN RAISE EXCEPTION 'checkout_quote_not_reserved'; END IF;
    SELECT * INTO s FROM "Store" WHERE "id" = NEW."storeId";
    IF NOT FOUND OR s."vendorId" <> NEW."vendorId" OR s."countryId" <> q."countryId" THEN RAISE EXCEPTION 'checkout_group_ancestry_mismatch'; END IF;
    IF NEW."currency" <> q."currency" THEN RAISE EXCEPTION 'checkout_currency_mismatch'; END IF;
    RETURN NEW;
  ELSE
    SELECT * INTO q FROM "CheckoutQuote" WHERE "id" = NEW."quoteId";
    IF NOT FOUND OR q."state" <> 'RESERVED' THEN RAISE EXCEPTION 'checkout_quote_not_reserved'; END IF;
    SELECT * INTO g FROM "CheckoutQuoteGroup" WHERE "id" = NEW."groupId";
    IF NOT FOUND OR g."quoteId" <> q."id" THEN RAISE EXCEPTION 'checkout_group_mismatch'; END IF;
    SELECT * INTO r FROM "InventoryReservation" WHERE "id" = NEW."reservationId";
    IF NOT FOUND OR r."userId" <> q."userId" OR r."quantity" <> NEW."quantity" OR r."state" <> 'ACTIVE' THEN RAISE EXCEPTION 'checkout_reservation_mismatch'; END IF;
    SELECT * INTO i FROM "Inventory" WHERE "id" = r."inventoryId";
    IF i."variantId" <> NEW."variantId" OR i."storeId" <> g."storeId" OR i."vendorId" <> g."vendorId" OR i."countryId" <> q."countryId" THEN RAISE EXCEPTION 'checkout_item_ancestry_mismatch'; END IF;
    SELECT * INTO var FROM "ProductVariant" WHERE "id" = NEW."variantId";
    SELECT * INTO p FROM "Product" WHERE "id" = var."productId";
    IF p."id" <> NEW."productId" OR p."storeId" <> g."storeId" OR p."vendorId" <> g."vendorId" THEN RAISE EXCEPTION 'checkout_item_product_mismatch'; END IF;
    IF NEW."currency" <> q."currency" OR NEW."unitPriceMinor" <> var."priceAmountMinor" OR NEW."currency" <> var."currency" THEN RAISE EXCEPTION 'checkout_price_mismatch'; END IF;
    IF NEW."productTitle" <> p."title" OR NEW."sku" <> var."sku" THEN RAISE EXCEPTION 'checkout_snapshot_mismatch'; END IF;
    RETURN NEW;
  END IF;
END;
$$;
CREATE TRIGGER checkout_group_guard BEFORE INSERT ON "CheckoutQuoteGroup" FOR EACH ROW EXECUTE FUNCTION gs_checkout_group_item_guard();
CREATE TRIGGER checkout_item_guard BEFORE INSERT ON "CheckoutQuoteItem" FOR EACH ROW EXECUTE FUNCTION gs_checkout_group_item_guard();

-- Deferred quote/reservation/total consistency at COMMIT.
CREATE OR REPLACE FUNCTION gs_checkout_quote_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE quote_id UUID; q "CheckoutQuote"%ROWTYPE; item_sum BIGINT; group_sum BIGINT; bad INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'CheckoutQuote' THEN quote_id := NEW."id";
  ELSIF TG_TABLE_NAME = 'InventoryReservation' THEN
    SELECT "quoteId" INTO quote_id FROM "CheckoutQuoteItem" WHERE "reservationId" = NEW."id";
    IF quote_id IS NULL THEN RETURN NULL; END IF;
  ELSE quote_id := NEW."quoteId"; END IF;
  SELECT * INTO q FROM "CheckoutQuote" WHERE "id" = quote_id;
  SELECT COALESCE(SUM("lineTotalMinor"),0) INTO item_sum FROM "CheckoutQuoteItem" WHERE "quoteId" = quote_id;
  SELECT COALESCE(SUM("subtotalMinor"),0) INTO group_sum FROM "CheckoutQuoteGroup" WHERE "quoteId" = quote_id;
  IF item_sum <> q."subtotalMinor" OR group_sum <> q."subtotalMinor" THEN RAISE EXCEPTION 'checkout_quote_total_mismatch'; END IF;
  SELECT count(*) INTO bad FROM "CheckoutQuoteGroup" g WHERE g."quoteId" = quote_id
    AND g."subtotalMinor" <> (SELECT COALESCE(SUM(i."lineTotalMinor"),0) FROM "CheckoutQuoteItem" i WHERE i."groupId" = g."id");
  IF bad > 0 THEN RAISE EXCEPTION 'checkout_group_total_mismatch'; END IF;
  SELECT count(*) INTO bad FROM "CheckoutQuoteItem" i JOIN "InventoryReservation" r ON r."id" = i."reservationId"
    WHERE i."quoteId" = quote_id AND (r."quantity" <> i."quantity" OR r."userId" <> q."userId");
  IF bad > 0 THEN RAISE EXCEPTION 'checkout_reservation_mismatch'; END IF;
  IF q."state" = 'RESERVED' THEN
    SELECT count(*) INTO bad FROM "CheckoutQuoteItem" i JOIN "InventoryReservation" r ON r."id" = i."reservationId"
      WHERE i."quoteId" = quote_id AND r."state" <> 'ACTIVE';
    IF bad > 0 THEN RAISE EXCEPTION 'checkout_quote_reservation_not_active'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "CheckoutQuoteItem" WHERE "quoteId" = quote_id) THEN RAISE EXCEPTION 'checkout_quote_empty'; END IF;
  ELSE
    SELECT count(*) INTO bad FROM "CheckoutQuoteItem" i JOIN "InventoryReservation" r ON r."id" = i."reservationId"
      WHERE i."quoteId" = quote_id AND r."state" = 'ACTIVE';
    IF bad > 0 THEN RAISE EXCEPTION 'checkout_quote_reservation_still_active'; END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER checkout_quote_consistent_insert AFTER INSERT ON "CheckoutQuote" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_checkout_quote_consistent();
CREATE CONSTRAINT TRIGGER checkout_quote_consistent_update AFTER UPDATE ON "CheckoutQuote" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_checkout_quote_consistent();
CREATE CONSTRAINT TRIGGER checkout_quote_consistent_group AFTER INSERT ON "CheckoutQuoteGroup" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_checkout_quote_consistent();
CREATE CONSTRAINT TRIGGER checkout_quote_consistent_item AFTER INSERT ON "CheckoutQuoteItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_checkout_quote_consistent();
CREATE CONSTRAINT TRIGGER checkout_quote_consistent_reservation AFTER UPDATE ON "InventoryReservation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_checkout_quote_consistent();

-- When expiry closes the last ACTIVE reservation of a quote, close the quote in the same transaction.
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
CREATE TRIGGER checkout_quote_sync_on_reservation AFTER UPDATE ON "InventoryReservation" FOR EACH ROW EXECUTE FUNCTION gs_checkout_quote_sync_on_reservation();

COMMENT ON TABLE "Cart" IS 'Authenticated customer cart; one per user/country; server-side currency; optimistic version.';
COMMENT ON TABLE "CartItem" IS 'Cart line; quantity bounded; ancestry and sellability guarded; mutations bump cart version.';
COMMENT ON TABLE "CheckoutQuote" IS 'Immutable priced checkout quote with atomic stock reservations; no payment/order yet.';
COMMENT ON TABLE "CheckoutQuoteGroup" IS 'Vendor/store split subtotal snapshot for future suborder creation.';
COMMENT ON TABLE "CheckoutQuoteItem" IS 'Immutable quote line snapshot linked 1:1 to an inventory reservation.';
