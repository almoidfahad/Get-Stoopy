-- Fraud-risk manual review foundation. Additive only; applied migrations stay frozen.
-- A risk score never enforces anything by itself: it routes to a human reviewer.
CREATE TYPE "RiskCaseKind" AS ENUM ('ORDER_ABUSE','PAYMENT_ABUSE','COUPON_ABUSE','ACCOUNT_ABUSE');
CREATE TYPE "RiskBand" AS ENUM ('LOW','REVIEW','HIGH');
CREATE TYPE "RiskCaseStatus" AS ENUM ('OPEN','UNDER_REVIEW','CLEARED','CONFIRMED_FRAUD');
CREATE TYPE "RiskReviewDecision" AS ENUM ('CLEAR','CONFIRM_FRAUD');

CREATE TABLE "RiskCase" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "countryId" UUID NOT NULL,
  "subjectUserId" UUID NOT NULL,
  "orderId" UUID,
  "kind" "RiskCaseKind" NOT NULL,
  "status" "RiskCaseStatus" NOT NULL DEFAULT 'OPEN',
  "score" INTEGER NOT NULL DEFAULT 0,
  "band" "RiskBand" NOT NULL DEFAULT 'LOW',
  "policyVersion" VARCHAR(32) NOT NULL,
  "openedByUserId" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "resolvedByUserId" UUID,
  "resolvedAt" TIMESTAMP(3),
  "resolutionReason" VARCHAR(512),
  CONSTRAINT "RiskCase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RiskCase_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT,
  CONSTRAINT "RiskCase_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE RESTRICT,
  CONSTRAINT "RiskCase_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT,
  CONSTRAINT "RiskCase_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT,
  CONSTRAINT "RiskCase_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT,
  CONSTRAINT "RiskCase_score_range" CHECK ("score" >= 0 AND "score" <= 100),
  CONSTRAINT "RiskCase_version_positive" CHECK ("version" >= 1)
);
CREATE INDEX "RiskCase_countryId_status_createdAt_idx" ON "RiskCase"("countryId","status","createdAt");
CREATE INDEX "RiskCase_subjectUserId_createdAt_idx" ON "RiskCase"("subjectUserId","createdAt");

CREATE TABLE "RiskSignal" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "caseId" UUID NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "weight" INTEGER NOT NULL,
  "evidenceHash" VARCHAR(64) NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RiskSignal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RiskSignal_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RiskCase"("id") ON DELETE RESTRICT,
  CONSTRAINT "RiskSignal_weight_range" CHECK ("weight" >= 0 AND "weight" <= 100),
  CONSTRAINT "RiskSignal_evidence_hash" CHECK ("evidenceHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "RiskSignal_case_code_unique" UNIQUE ("caseId","code")
);
CREATE INDEX "RiskSignal_caseId_idx" ON "RiskSignal"("caseId");

CREATE TABLE "RiskCaseReview" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "caseId" UUID NOT NULL,
  "reviewerUserId" UUID NOT NULL,
  "decision" "RiskReviewDecision" NOT NULL,
  "caseVersion" INTEGER NOT NULL,
  "commandKey" VARCHAR(128) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "reason" VARCHAR(512) NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RiskCaseReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RiskCaseReview_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RiskCase"("id") ON DELETE RESTRICT,
  CONSTRAINT "RiskCaseReview_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT,
  CONSTRAINT "RiskCaseReview_case_command_unique" UNIQUE ("caseId","commandKey"),
  CONSTRAINT "RiskCaseReview_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "RiskCaseReview_reason_length" CHECK (length(trim("reason")) >= 8)
);
CREATE INDEX "RiskCaseReview_reviewerUserId_occurredAt_idx" ON "RiskCaseReview"("reviewerUserId","occurredAt");

-- Band thresholds mirror packages/core/src/fraud-risk.ts (risk-v1).
CREATE OR REPLACE FUNCTION gs_risk_band(score INTEGER) RETURNS "RiskBand" LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN score >= 70 THEN 'HIGH'::"RiskBand" WHEN score >= 30 THEN 'REVIEW'::"RiskBand" ELSE 'LOW'::"RiskBand" END
$$;

ALTER TABLE "RiskCase" ENABLE ROW LEVEL SECURITY; ALTER TABLE "RiskCase" FORCE ROW LEVEL SECURITY;
CREATE POLICY risk_case_super ON "RiskCase" USING(gs_is_super()) WITH CHECK(gs_is_super());
ALTER TABLE "RiskSignal" ENABLE ROW LEVEL SECURITY; ALTER TABLE "RiskSignal" FORCE ROW LEVEL SECURITY;
CREATE POLICY risk_signal_super ON "RiskSignal" USING(gs_is_super()) WITH CHECK(gs_is_super());
ALTER TABLE "RiskCaseReview" ENABLE ROW LEVEL SECURITY; ALTER TABLE "RiskCaseReview" FORCE ROW LEVEL SECURITY;
CREATE POLICY risk_case_review_super ON "RiskCaseReview" USING(gs_is_super()) WITH CHECK(gs_is_super());

-- Evidence and reviews are append-only.
CREATE TRIGGER risk_signal_append_only BEFORE UPDATE OR DELETE ON "RiskSignal" FOR EACH ROW EXECUTE FUNCTION gs_append_only();
CREATE TRIGGER risk_review_append_only BEFORE UPDATE OR DELETE ON "RiskCaseReview" FOR EACH ROW EXECUTE FUNCTION gs_append_only();

CREATE OR REPLACE FUNCTION gs_risk_signal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "RiskCase"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'risk_signal_privileged_only'; END IF;
  SELECT * INTO c FROM "RiskCase" WHERE id=NEW."caseId";
  IF NOT FOUND THEN RAISE EXCEPTION 'risk_case_missing'; END IF;
  IF c.status IN ('CLEARED','CONFIRMED_FRAUD') THEN RAISE EXCEPTION 'risk_case_terminal'; END IF;
  IF NEW.code <> trim(NEW.code) OR length(NEW.code) < 3 THEN RAISE EXCEPTION 'risk_signal_code_invalid'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER risk_signal_guard BEFORE INSERT ON "RiskSignal" FOR EACH ROW EXECUTE FUNCTION gs_risk_signal_guard();

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

  IF NOT ((OLD.status='OPEN' AND NEW.status IN ('UNDER_REVIEW','CLEARED','CONFIRMED_FRAUD'))
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
    INSERT INTO "AuditLog"(id,"actorType",action,"resourceType","resourceId","actorUserId","scopeSnapshot","requestId")
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
CREATE TRIGGER risk_case_guard BEFORE INSERT OR UPDATE ON "RiskCase" FOR EACH ROW EXECUTE FUNCTION gs_risk_case_guard();

CREATE OR REPLACE FUNCTION gs_risk_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "RiskCase"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'risk_review_privileged_only'; END IF;
  SELECT * INTO c FROM "RiskCase" WHERE id=NEW."caseId" FOR UPDATE;
  IF NOT FOUND OR c.status IN ('CLEARED','CONFIRMED_FRAUD') THEN RAISE EXCEPTION 'risk_review_case_not_reviewable'; END IF;
  IF NEW."reviewerUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'risk_review_actor_mismatch'; END IF;
  IF NEW."reviewerUserId" = c."subjectUserId" THEN RAISE EXCEPTION 'risk_self_review_denied'; END IF;
  IF c."openedByUserId" IS NOT NULL AND NEW."reviewerUserId" = c."openedByUserId" THEN RAISE EXCEPTION 'risk_review_not_independent'; END IF;
  IF NEW."caseVersion" <> c.version + 1 THEN RAISE EXCEPTION 'risk_review_version_conflict'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER risk_review_guard BEFORE INSERT ON "RiskCaseReview" FOR EACH ROW EXECUTE FUNCTION gs_risk_review_guard();

-- Deferred: the score must equal the capped sum of its evidence at COMMIT, so a
-- case can never be resolved against evidence that was never recorded.
CREATE OR REPLACE FUNCTION gs_risk_score_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID; total INTEGER;
BEGIN
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  SELECT LEAST(100, COALESCE(SUM(s.weight),0))::int INTO total FROM "RiskSignal" s WHERE s."caseId"=target;
  IF EXISTS (SELECT 1 FROM "RiskCase" c WHERE c.id=target AND (c.score <> total OR c.band <> gs_risk_band(total))) THEN
    RAISE EXCEPTION 'risk_score_evidence_mismatch';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER risk_case_score_consistency AFTER INSERT OR UPDATE ON "RiskCase"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_risk_score_consistency();
CREATE CONSTRAINT TRIGGER risk_signal_score_consistency AFTER INSERT ON "RiskSignal"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_risk_score_consistency();

GRANT SELECT,INSERT,UPDATE ON "RiskCase" TO gs_privileged;
GRANT SELECT,INSERT ON "RiskSignal","RiskCaseReview" TO gs_privileged;
REVOKE DELETE ON "RiskCase","RiskSignal","RiskCaseReview" FROM gs_runtime,gs_privileged;
REVOKE UPDATE ON "RiskSignal","RiskCaseReview" FROM gs_runtime,gs_privileged;
