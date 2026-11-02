-- Inventory and stock reservation foundation.
-- Additive tables; no existing catalog rows are rewritten.
CREATE TYPE "InventoryMovementKind" AS ENUM ('ADJUST','RESERVE','RELEASE','CONSUME','EXPIRE');
CREATE TYPE "InventoryReservationState" AS ENUM ('ACTIVE','RELEASED','CONSUMED','EXPIRED');

CREATE TABLE "Inventory" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "variantId" UUID NOT NULL,
  "storeId" UUID NOT NULL,
  "vendorId" UUID NOT NULL,
  "countryId" UUID NOT NULL,
  "onHand" INTEGER NOT NULL DEFAULT 0,
  "reserved" INTEGER NOT NULL DEFAULT 0,
  "reorderLevel" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Inventory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Inventory_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Inventory_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Inventory_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Inventory_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Inventory_bounds" CHECK ("onHand" >= 0 AND "reserved" >= 0 AND "reserved" <= "onHand" AND "onHand" <= 1000000),
  CONSTRAINT "Inventory_reorder_nonnegative" CHECK ("reorderLevel" >= 0),
  CONSTRAINT "Inventory_version_positive" CHECK ("version" >= 1)
);
CREATE UNIQUE INDEX "Inventory_variantId_key" ON "Inventory"("variantId");
CREATE INDEX "Inventory_storeId_countryId_idx" ON "Inventory"("storeId","countryId");
CREATE INDEX "Inventory_vendorId_countryId_idx" ON "Inventory"("vendorId","countryId");

CREATE TABLE "InventoryReservation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "inventoryId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "commandKey" VARCHAR(128) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "state" "InventoryReservationState" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryReservation_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InventoryReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InventoryReservation_quantity_bounds" CHECK ("quantity" BETWEEN 1 AND 100),
  CONSTRAINT "InventoryReservation_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "InventoryReservation_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "InventoryReservation_ttl_bounds" CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '900 seconds')
);
CREATE UNIQUE INDEX "InventoryReservation_userId_commandKey_key" ON "InventoryReservation"("userId","commandKey");
CREATE INDEX "InventoryReservation_inventoryId_state_idx" ON "InventoryReservation"("inventoryId","state");
CREATE INDEX "InventoryReservation_state_expiresAt_idx" ON "InventoryReservation"("state","expiresAt");
CREATE INDEX "InventoryReservation_userId_state_createdAt_idx" ON "InventoryReservation"("userId","state","createdAt");

CREATE TABLE "InventoryMovement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "inventoryId" UUID NOT NULL,
  "inventoryVersion" INTEGER NOT NULL,
  "kind" "InventoryMovementKind" NOT NULL,
  "commandKey" VARCHAR(128) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "reservationId" UUID,
  "onHandDelta" INTEGER NOT NULL DEFAULT 0,
  "reservedDelta" INTEGER NOT NULL DEFAULT 0,
  "onHandAfter" INTEGER NOT NULL,
  "reservedAfter" INTEGER NOT NULL,
  "reason" VARCHAR(512) NOT NULL,
  "actorUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryMovement_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InventoryMovement_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "InventoryReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InventoryMovement_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InventoryMovement_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "InventoryMovement_reason_length" CHECK (length(trim("reason")) BETWEEN 8 AND 512),
  CONSTRAINT "InventoryMovement_after_bounds" CHECK ("onHandAfter" >= 0 AND "reservedAfter" >= 0 AND "reservedAfter" <= "onHandAfter" AND "onHandAfter" <= 1000000)
);
CREATE UNIQUE INDEX "InventoryMovement_inventoryId_commandKey_key" ON "InventoryMovement"("inventoryId","commandKey");
CREATE UNIQUE INDEX "InventoryMovement_inventoryId_inventoryVersion_key" ON "InventoryMovement"("inventoryId","inventoryVersion");
CREATE INDEX "InventoryMovement_inventoryId_createdAt_idx" ON "InventoryMovement"("inventoryId","createdAt");
CREATE INDEX "InventoryMovement_reservationId_idx" ON "InventoryMovement"("reservationId");

ALTER TABLE "Inventory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Inventory" FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_select_member_or_super ON "Inventory" FOR SELECT USING (
  gs_is_super() OR EXISTS (
    SELECT 1 FROM "VendorMembership" m JOIN "Vendor" v ON v."id" = m."vendorId"
    WHERE m."vendorId" = "Inventory"."vendorId" AND m."userId" = gs_current_user_id()
      AND m."revokedAt" IS NULL AND (m."expiresAt" IS NULL OR m."expiresAt" > CURRENT_TIMESTAMP)
      AND v."status" = 'ACTIVE'
  )
);
CREATE POLICY inventory_insert_super_only ON "Inventory" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY inventory_update_super_only ON "Inventory" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

ALTER TABLE "InventoryMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryMovement" FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_movement_select_member_or_super ON "InventoryMovement" FOR SELECT USING (
  gs_is_super() OR EXISTS (
    SELECT 1 FROM "Inventory" i JOIN "VendorMembership" m ON m."vendorId" = i."vendorId" JOIN "Vendor" v ON v."id" = i."vendorId"
    WHERE i."id" = "InventoryMovement"."inventoryId" AND m."userId" = gs_current_user_id()
      AND m."revokedAt" IS NULL AND (m."expiresAt" IS NULL OR m."expiresAt" > CURRENT_TIMESTAMP)
      AND v."status" = 'ACTIVE'
  )
);
CREATE POLICY inventory_movement_insert_super_only ON "InventoryMovement" FOR INSERT WITH CHECK (gs_is_super());

ALTER TABLE "InventoryReservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryReservation" FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_reservation_select_self_or_super ON "InventoryReservation" FOR SELECT USING (gs_is_super() OR "userId" = gs_current_user_id());
CREATE POLICY inventory_reservation_insert_super_only ON "InventoryReservation" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY inventory_reservation_update_super_only ON "InventoryReservation" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

CREATE OR REPLACE FUNCTION gs_inventory_vendor_eligible(vendor_uuid UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Vendor" v JOIN "KycCase" k ON k."id" = v."kycCaseId"
    WHERE v."id" = vendor_uuid AND v."status" = 'ACTIVE'
      AND k."subjectUserId" = v."ownerUserId" AND k."subjectType" = 'VENDOR'
      AND k."countryId" = v."countryId" AND k."status" = 'APPROVED'
      AND k."expiresAt" IS NOT NULL AND k."expiresAt" > CURRENT_TIMESTAMP
  );
$$;

CREATE OR REPLACE FUNCTION gs_inventory_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE var "ProductVariant"%ROWTYPE; p "Product"%ROWTYPE; s "Store"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'inventory_write_privileged_only'; END IF;
  IF NEW."onHand" <> 0 OR NEW."reserved" <> 0 OR NEW."version" <> 1 THEN RAISE EXCEPTION 'inventory_must_start_empty'; END IF;
  SELECT * INTO var FROM "ProductVariant" WHERE "id" = NEW."variantId";
  IF NOT FOUND OR var."active" <> true THEN RAISE EXCEPTION 'inventory_variant_not_active'; END IF;
  SELECT * INTO p FROM "Product" WHERE "id" = var."productId";
  IF p."status" = 'ARCHIVED' THEN RAISE EXCEPTION 'inventory_product_archived'; END IF;
  SELECT * INTO s FROM "Store" WHERE "id" = p."storeId";
  IF s."id" <> NEW."storeId" OR p."vendorId" <> NEW."vendorId" OR p."countryId" <> NEW."countryId" OR s."countryId" <> NEW."countryId" THEN
    RAISE EXCEPTION 'inventory_ancestry_mismatch';
  END IF;
  IF s."status" <> 'ACTIVE' OR NOT gs_inventory_vendor_eligible(NEW."vendorId") THEN RAISE EXCEPTION 'inventory_vendor_kyc_required'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_insert_guard BEFORE INSERT ON "Inventory" FOR EACH ROW EXECUTE FUNCTION gs_inventory_insert_guard();

CREATE OR REPLACE FUNCTION gs_inventory_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'inventory_write_privileged_only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."variantId" IS DISTINCT FROM OLD."variantId" OR NEW."storeId" IS DISTINCT FROM OLD."storeId" OR NEW."vendorId" IS DISTINCT FROM OLD."vendorId" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW."reorderLevel" IS DISTINCT FROM OLD."reorderLevel" THEN
    RAISE EXCEPTION 'inventory_immutable_fields';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'inventory_version_conflict'; END IF;
  IF NEW."onHand" = OLD."onHand" AND NEW."reserved" = OLD."reserved" THEN RAISE EXCEPTION 'inventory_noop_update'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_update_guard BEFORE UPDATE ON "Inventory" FOR EACH ROW EXECUTE FUNCTION gs_inventory_update_guard();

CREATE OR REPLACE FUNCTION gs_inventory_movement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i "Inventory"%ROWTYPE; r "InventoryReservation"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'inventory_write_privileged_only'; END IF;
  IF length(trim(NEW."commandKey")) < 8 OR NEW."commandKey" !~ '^[A-Za-z0-9:_-]{8,128}$' THEN RAISE EXCEPTION 'inventory_command_key_invalid'; END IF;
  SELECT * INTO i FROM "Inventory" WHERE "id" = NEW."inventoryId";
  IF NOT FOUND OR i."version" <> NEW."inventoryVersion" OR i."onHand" <> NEW."onHandAfter" OR i."reserved" <> NEW."reservedAfter" THEN
    RAISE EXCEPTION 'inventory_movement_version_mismatch';
  END IF;
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
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_movement_guard BEFORE INSERT ON "InventoryMovement" FOR EACH ROW EXECUTE FUNCTION gs_inventory_movement_guard();
CREATE TRIGGER inventory_movement_no_update_delete BEFORE UPDATE OR DELETE ON "InventoryMovement" FOR EACH ROW EXECUTE FUNCTION gs_append_only();

CREATE OR REPLACE FUNCTION gs_inventory_reservation_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i "Inventory"%ROWTYPE; var "ProductVariant"%ROWTYPE; p "Product"%ROWTYPE; s "Store"%ROWTYPE; c "Country"%ROWTYPE; u "User"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'inventory_write_privileged_only'; END IF;
  IF NEW."state" <> 'ACTIVE' OR NEW."version" <> 1 OR NEW."closedAt" IS NOT NULL THEN RAISE EXCEPTION 'reservation_must_start_active'; END IF;
  IF length(trim(NEW."commandKey")) < 8 OR NEW."commandKey" !~ '^[A-Za-z0-9:_-]{8,128}$' THEN RAISE EXCEPTION 'inventory_command_key_invalid'; END IF;
  SELECT * INTO u FROM "User" WHERE "id" = NEW."userId";
  IF NOT FOUND OR u."status" <> 'ACTIVE' THEN RAISE EXCEPTION 'reservation_user_not_active'; END IF;
  SELECT * INTO i FROM "Inventory" WHERE "id" = NEW."inventoryId";
  IF NOT FOUND THEN RAISE EXCEPTION 'inventory_not_found'; END IF;
  SELECT * INTO var FROM "ProductVariant" WHERE "id" = i."variantId";
  SELECT * INTO p FROM "Product" WHERE "id" = var."productId";
  SELECT * INTO s FROM "Store" WHERE "id" = i."storeId";
  SELECT * INTO c FROM "Country" WHERE "id" = i."countryId";
  IF var."active" <> true OR p."status" <> 'PUBLISHED' OR s."status" <> 'ACTIVE' OR c."status" <> 'ACTIVE' OR NOT gs_inventory_vendor_eligible(i."vendorId") THEN
    RAISE EXCEPTION 'reservation_not_sellable';
  END IF;
  IF p."categoryId" IS NOT NULL AND NOT gs_category_chain_active(p."categoryId") THEN RAISE EXCEPTION 'reservation_not_sellable'; END IF;
  IF i."onHand" - i."reserved" < NEW."quantity" THEN RAISE EXCEPTION 'insufficient_stock'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_reservation_insert_guard BEFORE INSERT ON "InventoryReservation" FOR EACH ROW EXECUTE FUNCTION gs_inventory_reservation_insert_guard();

CREATE OR REPLACE FUNCTION gs_inventory_reservation_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'inventory_write_privileged_only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."inventoryId" IS DISTINCT FROM OLD."inventoryId" OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."commandKey" IS DISTINCT FROM OLD."commandKey" OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash" OR NEW."quantity" IS DISTINCT FROM OLD."quantity" OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'reservation_immutable_fields';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'reservation_version_conflict'; END IF;
  IF OLD."state" <> 'ACTIVE' OR NEW."state" NOT IN ('RELEASED','CONSUMED','EXPIRED') OR NEW."closedAt" IS NULL THEN RAISE EXCEPTION 'reservation_invalid_transition'; END IF;
  IF NEW."state" = 'CONSUMED' AND OLD."expiresAt" <= CURRENT_TIMESTAMP THEN RAISE EXCEPTION 'reservation_expired'; END IF;
  IF NEW."state" = 'EXPIRED' AND OLD."expiresAt" > CURRENT_TIMESTAMP THEN RAISE EXCEPTION 'reservation_not_expired'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_reservation_update_guard BEFORE UPDATE ON "InventoryReservation" FOR EACH ROW EXECUTE FUNCTION gs_inventory_reservation_update_guard();

-- Deferred invariant: reserved equals the sum of ACTIVE reservations at COMMIT.
CREATE OR REPLACE FUNCTION gs_inventory_reserved_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inv_id UUID; expected INTEGER; actual INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'Inventory' THEN inv_id := NEW."id"; ELSE inv_id := NEW."inventoryId"; END IF;
  SELECT COALESCE(SUM("quantity"),0) INTO expected FROM "InventoryReservation" WHERE "inventoryId" = inv_id AND "state" = 'ACTIVE';
  SELECT "reserved" INTO actual FROM "Inventory" WHERE "id" = inv_id;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'inventory_reserved_mismatch'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER inventory_reserved_consistent_insert AFTER INSERT ON "InventoryReservation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_inventory_reserved_consistent();
CREATE CONSTRAINT TRIGGER inventory_reserved_consistent_update AFTER UPDATE ON "InventoryReservation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_inventory_reserved_consistent();
CREATE CONSTRAINT TRIGGER inventory_reserved_consistent_balance AFTER UPDATE ON "Inventory" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_inventory_reserved_consistent();

-- Deferred invariant: every inventory balance/version change has exactly one movement.
CREATE OR REPLACE FUNCTION gs_inventory_movement_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "InventoryMovement" m
    WHERE m."inventoryId" = NEW."id" AND m."inventoryVersion" = NEW."version"
      AND m."onHandAfter" = NEW."onHand" AND m."reservedAfter" = NEW."reserved"
      AND m."onHandDelta" = NEW."onHand" - OLD."onHand" AND m."reservedDelta" = NEW."reserved" - OLD."reserved"
  ) THEN RAISE EXCEPTION 'inventory_movement_required'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER inventory_movement_required AFTER UPDATE ON "Inventory" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_inventory_movement_required();

COMMENT ON TABLE "Inventory" IS 'Per-variant stock balance; onHand/reserved bounded and versioned; writes require append-only movement.';
COMMENT ON TABLE "InventoryReservation" IS 'Short-lived checkout stock hold; idempotent per user/commandKey; terminal states release or consume exactly once.';
COMMENT ON TABLE "InventoryMovement" IS 'Append-only stock movement history; one movement per inventory version.';

-- Shared expiry routine used by API and worker. Caller must be privileged and set super context.
CREATE OR REPLACE FUNCTION gs_expire_inventory_reservations(batch_limit INTEGER) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  due RECORD; inv "Inventory"%ROWTYPE; res "InventoryReservation"%ROWTYPE; updated "Inventory"%ROWTYPE;
  expired_count INTEGER := 0; now_ts TIMESTAMP(3) := CURRENT_TIMESTAMP; occurrence TEXT;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'inventory_write_privileged_only'; END IF;
  IF batch_limit IS NULL OR batch_limit < 1 OR batch_limit > 500 THEN RAISE EXCEPTION 'expiry_batch_invalid'; END IF;
  FOR due IN SELECT "id", "inventoryId" FROM "InventoryReservation" WHERE "state"='ACTIVE' AND "expiresAt" <= now_ts ORDER BY "expiresAt" ASC LIMIT batch_limit LOOP
    SELECT * INTO inv FROM "Inventory" WHERE "id" = due."inventoryId" FOR UPDATE;
    SELECT * INTO res FROM "InventoryReservation" WHERE "id" = due."id" FOR UPDATE;
    IF res."state" <> 'ACTIVE' OR res."expiresAt" > now_ts THEN CONTINUE; END IF;
    UPDATE "InventoryReservation" SET "state"='EXPIRED', "closedAt"=now_ts, "version"="version"+1, "updatedAt"=now_ts WHERE "id"=res."id";
    UPDATE "Inventory" SET "reserved"="reserved"-res."quantity", "version"="version"+1, "updatedAt"=now_ts WHERE "id"=inv."id" RETURNING * INTO updated;
    INSERT INTO "InventoryMovement"(id,"inventoryId","inventoryVersion",kind,"commandKey","payloadHash","reservationId","onHandDelta","reservedDelta","onHandAfter","reservedAfter",reason,"actorUserId")
    VALUES (gen_random_uuid(), inv."id", updated."version", 'EXPIRE', 'expire:' || res."id", encode(sha256(convert_to('{"reservationId":"' || res."id" || '","kind":"EXPIRE"}','UTF8')),'hex'), res."id", 0, -res."quantity", updated."onHand", updated."reserved", 'reservation expired', NULL);
    INSERT INTO "AuditLog"(id,"actorType",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId")
    VALUES (gen_random_uuid(), 'SYSTEM', 'inventory.expire', 'InventoryReservation', res."id", jsonb_build_object('countryId', inv."countryId"), 'reservation expired', gen_random_uuid()::text);
    occurrence := to_char(now_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    INSERT INTO "OutboxEvent"(id,"aggregateType","aggregateId","eventKey","eventType",payload,"occurredAt")
    VALUES (gen_random_uuid(), 'Inventory', inv."id", 'inventory-expire-' || res."id", 'inventory.expire',
      jsonb_build_object('schemaVersion',1,'eventKey','inventory-expire-' || res."id",'eventType','inventory.expire','occurredAt',occurrence,'aggregateType','Inventory','aggregateId',inv."id",'countryId',inv."countryId",'data',jsonb_build_object('reservationId',res."id",'quantity',res."quantity",'version',updated."version")), now_ts);
    expired_count := expired_count + 1;
  END LOOP;
  RETURN expired_count;
END;
$$;
