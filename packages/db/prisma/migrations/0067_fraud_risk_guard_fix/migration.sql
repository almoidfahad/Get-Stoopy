-- Additive correction to 0066 (applied migrations stay frozen).
-- 1. AuditLog's actor column is "actorId"; 0066 used a non-existent name.
-- 2. An evidence rescore must be able to keep the current non-terminal status.
CREATE OR REPLACE FUNCTION gs_risk_case_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'risk_case_privileged_only'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' OR NEW.version <> 1 THEN RAISE EXCEPTION 'risk_case_initial_state'; END IF;
    IF length(trim(NEW."policyVersion")) < 1 THEN RAISE EXCEPTION 'risk_case_policy_version_required'; END IF;
    IF NEW."resolvedAt" IS NOT NULL OR NEW."resolvedByUserId" IS NOT NULL OR NEW."resolutionReason" IS NOT NULL THEN RAISE EXCEPTION 'risk_case_initial_resolution'; END IF;
    IF NEW."openedByUserId" IS NOT NULL AND NEW."openedByUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'risk_case_actor_mismatch'; END IF;
    IF NEW."openedByUserId" = NEW."subjectUserId" THEN RAISE EXCEPTION 'risk_case_self_open_denied'; END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW."countryId" <> OLD."countryId" OR NEW."subjectUserId" <> OLD."subjectUserId"
     OR NEW."orderId" IS DISTINCT FROM OLD."orderId" OR NEW.kind <> OLD.kind
     OR NEW."policyVersion" <> OLD."policyVersion" OR NEW."openedByUserId" IS DISTINCT FROM OLD."openedByUserId"
     OR NEW."createdAt" <> OLD."createdAt" THEN RAISE EXCEPTION 'risk_case_immutable_fields'; END IF;
  IF NEW.version <> OLD.version + 1 THEN RAISE EXCEPTION 'risk_case_version_conflict'; END IF;
  IF OLD.status IN ('CLEARED','CONFIRMED_FRAUD') THEN RAISE EXCEPTION 'risk_case_terminal'; END IF;

  -- Rescoring keeps the current non-terminal status; only evidence may change it.
  IF NOT (NEW.status = OLD.status
       OR (OLD.status='OPEN' AND NEW.status IN ('UNDER_REVIEW','CLEARED','CONFIRMED_FRAUD'))
       OR (OLD.status='UNDER_REVIEW' AND NEW.status IN ('CLEARED','CONFIRMED_FRAUD'))) THEN
    RAISE EXCEPTION 'risk_case_invalid_transition';
  END IF;

  IF NEW.status IN ('CLEARED','CONFIRMED_FRAUD') THEN
    IF NEW."resolvedByUserId" IS NULL OR NEW."resolvedAt" IS NULL OR NEW."resolutionReason" IS NULL THEN RAISE EXCEPTION 'risk_case_resolution_metadata_required'; END IF;
    IF NEW."resolvedByUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'risk_case_actor_mismatch'; END IF;
    IF NEW."resolvedByUserId" = NEW."subjectUserId" THEN RAISE EXCEPTION 'risk_self_review_denied'; END IF;
    IF OLD."openedByUserId" IS NOT NULL AND NEW."resolvedByUserId" = OLD."openedByUserId" THEN RAISE EXCEPTION 'risk_review_not_independent'; END IF;
    IF length(trim(NEW."resolutionReason")) < 8 THEN RAISE EXCEPTION 'risk_review_reason_invalid'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "RiskCaseReview" r WHERE r."caseId"=NEW.id AND r."reviewerUserId"=NEW."resolvedByUserId"
                   AND r."caseVersion"=NEW.version AND r.reason=NEW."resolutionReason"
                   AND r.decision = CASE NEW.status WHEN 'CLEARED' THEN 'CLEAR'::"RiskReviewDecision" ELSE 'CONFIRM_FRAUD'::"RiskReviewDecision" END) THEN
      RAISE EXCEPTION 'risk_review_record_required';
    END IF;
    INSERT INTO "AuditLog"(id,"actorType",action,"resourceType","resourceId","actorId","scopeSnapshot","requestId")
      VALUES(gen_random_uuid(),'ADMIN','risk.case.resolved','RiskCase',NEW.id,NEW."resolvedByUserId",jsonb_build_object('countryId',NEW."countryId",'status',NEW.status),gen_random_uuid());
    INSERT INTO "OutboxEvent"(id,"aggregateType","aggregateId","eventKey","eventType","occurredAt",payload,"availableAt")
      VALUES(gen_random_uuid(),'RiskCase',NEW.id,'risk-resolved-'||NEW.id||'-'||NEW.version,'risk.case.resolved',CURRENT_TIMESTAMP,
        jsonb_build_object('schemaVersion',1,'eventKey','risk-resolved-'||NEW.id||'-'||NEW.version,'eventType','risk.case.resolved','occurredAt',CURRENT_TIMESTAMP,
          'aggregateType','RiskCase','aggregateId',NEW.id,'countryId',NEW."countryId",'data',jsonb_build_object('version',NEW.version,'status',NEW.status,'band',NEW.band)),CURRENT_TIMESTAMP);
  ELSE
    IF NEW."resolvedAt" IS NOT NULL OR NEW."resolvedByUserId" IS NOT NULL OR NEW."resolutionReason" IS NOT NULL THEN RAISE EXCEPTION 'risk_case_premature_resolution'; END IF;
  END IF;
  RETURN NEW;
END; $$;
