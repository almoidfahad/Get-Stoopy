-- Lock dispatch runs before offers during expiry to match acceptance lock order.
CREATE OR REPLACE FUNCTION gs_expire_dispatch_offers(batch_size INTEGER)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE run_row "DispatchRun"%ROWTYPE; offer_row "DispatchOffer"%ROWTYPE; expired INTEGER := 0; next_status "DispatchRunStatus"; event_key TEXT; payload JSONB;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'dispatch_write_privileged_only'; END IF;
  IF batch_size < 1 OR batch_size > 500 THEN RAISE EXCEPTION 'dispatch_expiry_batch_invalid'; END IF;
  FOR run_row IN
    SELECT r.* FROM "DispatchRun" r
    WHERE r."status"='OFFERING' AND EXISTS (SELECT 1 FROM "DispatchOffer" o WHERE o."runId"=r."id" AND o."status"='OFFERED' AND o."expiresAt" <= gs_dispatch_now())
    ORDER BY r."updatedAt" LIMIT batch_size FOR UPDATE OF r SKIP LOCKED
  LOOP
    SELECT * INTO offer_row FROM "DispatchOffer" WHERE "runId"=run_row."id" AND "status"='OFFERED' FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE "DispatchOffer" SET "status"='EXPIRED', "respondedAt"=gs_dispatch_now(), "responseCommandKey"='expire-'||offer_row."id", "responsePayloadHash"=encode(sha256(convert_to('expire:'||offer_row."id"::text,'UTF8')),'hex'), "responseReason"='Offer expired after 30 seconds' WHERE "id"=offer_row."id";
    next_status := CASE WHEN run_row."attemptCount" >= run_row."maxAttempts" THEN 'MANUAL_REVIEW'::"DispatchRunStatus" ELSE 'SEARCHING'::"DispatchRunStatus" END;
    UPDATE "DispatchRun" SET "status"=next_status, "version"="version"+1, "updatedAt"=gs_dispatch_now() WHERE "id"=run_row."id";
    event_key := 'offer-expired-'||offer_row."id";
    payload := jsonb_build_object('offerId',offer_row."id",'riderId',offer_row."riderId",'sequence',offer_row."sequence",'nextStatus',next_status);
    INSERT INTO "DispatchEvent"("runId","offerId","eventType","commandKey","payloadHash","reason") VALUES (run_row."id",offer_row."id",'dispatch.offer.expired',event_key,encode(sha256(convert_to(payload::text,'UTF8')),'hex'),'Offer expired after 30 seconds');
    INSERT INTO "AuditLog"(id,"actorType",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES (gen_random_uuid(),'SYSTEM','dispatch.offer.expired','DispatchRun',run_row."id",jsonb_build_object('countryId',run_row."countryId"),'Offer expired after 30 seconds',gen_random_uuid());
    INSERT INTO "OutboxEvent"(id,"aggregateType","aggregateId","eventKey","eventType","occurredAt",payload) VALUES (gen_random_uuid(),'DispatchRun',run_row."id",event_key,'dispatch.offer.expired',gs_dispatch_now(),jsonb_build_object('schemaVersion',1,'eventKey',event_key,'eventType','dispatch.offer.expired','occurredAt',gs_dispatch_now(),'aggregateType','DispatchRun','aggregateId',run_row."id",'countryId',run_row."countryId",'data',payload));
    expired := expired + 1;
  END LOOP;
  RETURN expired;
END;
$$;
