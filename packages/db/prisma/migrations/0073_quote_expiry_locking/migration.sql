-- Expiry works on one atomic unit per call: an entire quote or one standalone
-- reservation. Quotes lock before inventory, matching checkout release/order.
-- A quote can contain up to 50 lines through the checkout API. batch_limit is
-- validated for compatibility; callers may repeat calls up to their work budget.
CREATE OR REPLACE FUNCTION gs_expire_inventory_reservations(batch_limit INTEGER) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  due RECORD; inv "Inventory"%ROWTYPE; res "InventoryReservation"%ROWTYPE; updated "Inventory"%ROWTYPE;
  selected_quote UUID; standalone_id UUID; standalone_due TIMESTAMP(3); item_count INTEGER;
  expired_count INTEGER := 0; now_ts TIMESTAMP(3) := CURRENT_TIMESTAMP; occurrence TEXT;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'inventory_write_privileged_only'; END IF;
  IF batch_limit IS NULL OR batch_limit < 1 OR batch_limit > 500 THEN RAISE EXCEPTION 'expiry_batch_invalid'; END IF;

  -- Oldest standalone reservation establishes an upper bound on quote age,
  -- so a sustained quote backlog cannot indefinitely starve standalone work.
  SELECT r."id", r."expiresAt" INTO standalone_id, standalone_due
    FROM "InventoryReservation" r
    WHERE r."state"='ACTIVE' AND r."expiresAt" <= now_ts
      AND NOT EXISTS (SELECT 1 FROM "CheckoutQuoteItem" qi WHERE qi."reservationId"=r."id")
    ORDER BY r."expiresAt", r."id" LIMIT 1;

  -- All reservations must be due, not just the quote's earliest expiry.
  -- SKIP LOCKED avoids waiting on a quote held by release or order creation.
  SELECT q."id" INTO selected_quote FROM "CheckoutQuote" q
    WHERE q."state"='RESERVED' AND q."expiresAt" <= now_ts
      AND (standalone_due IS NULL OR q."expiresAt" <= standalone_due)
      AND EXISTS (SELECT 1 FROM "CheckoutQuoteItem" qi WHERE qi."quoteId"=q."id")
      AND NOT EXISTS (
        SELECT 1 FROM "CheckoutQuoteItem" qi JOIN "InventoryReservation" r ON r."id"=qi."reservationId"
        WHERE qi."quoteId"=q."id" AND (r."state" <> 'ACTIVE' OR r."expiresAt" > now_ts)
      )
    ORDER BY q."expiresAt", q."id" LIMIT 1 FOR UPDATE OF q SKIP LOCKED;

  IF selected_quote IS NOT NULL THEN
    SELECT count(*) INTO item_count FROM "CheckoutQuoteItem" WHERE "quoteId"=selected_quote;
    -- API checkout carts are capped at 50; fail closed on unsupported data.
    IF item_count > 50 THEN RAISE EXCEPTION 'expiry_quote_item_limit'; END IF;
  ELSIF standalone_id IS NULL THEN
    RETURN 0;
  END IF;

  -- The same variant ordering is used by checkout release and order creation.
  -- Never acquire another quote after taking inventory locks in this call.
  FOR due IN
    SELECT r."id", r."inventoryId"
    FROM "InventoryReservation" r JOIN "Inventory" i ON i."id"=r."inventoryId"
    WHERE (selected_quote IS NOT NULL AND EXISTS (
      SELECT 1 FROM "CheckoutQuoteItem" qi WHERE qi."quoteId"=selected_quote AND qi."reservationId"=r."id"
    )) OR (selected_quote IS NULL AND r."id"=standalone_id)
    ORDER BY i."variantId", r."id"
  LOOP
    SELECT * INTO inv FROM "Inventory" WHERE "id"=due."inventoryId" FOR UPDATE;
    SELECT * INTO res FROM "InventoryReservation" WHERE "id"=due."id" FOR UPDATE;
    IF res."state" <> 'ACTIVE' OR res."expiresAt" > now_ts THEN
      IF selected_quote IS NOT NULL THEN RAISE EXCEPTION 'expiry_quote_reservation_changed'; END IF;
      CONTINUE;
    END IF;
    -- Standalone reservations must remain unassociated after locking. A quote
    -- is created atomically with its reservations in the supported API flow.
    IF selected_quote IS NULL AND EXISTS (SELECT 1 FROM "CheckoutQuoteItem" WHERE "reservationId"=res."id") THEN CONTINUE; END IF;
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
