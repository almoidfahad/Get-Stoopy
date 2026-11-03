-- Rider earning rate snapshots, completion earnings, COD custody and verified deposit allocation.
-- Additive only. No live payout, provider transfer or production data migration.

CREATE TABLE "RiderRateRule" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "countryId" UUID NOT NULL REFERENCES "Country"(id),
  currency VARCHAR(3) NOT NULL, status "RiderRateRuleStatus" NOT NULL DEFAULT 'ACTIVE',
  "effectiveFrom" TIMESTAMP(3) NOT NULL, "commandKey" VARCHAR(128) NOT NULL, "payloadHash" VARCHAR(64) NOT NULL,
  "createdByUserId" UUID NOT NULL REFERENCES "User"(id), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("countryId","commandKey")
);
CREATE INDEX "RiderRateRule_countryId_status_effectiveFrom_idx" ON "RiderRateRule"("countryId",status,"effectiveFrom");
CREATE TABLE "RiderRateSlab" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "ruleId" UUID NOT NULL REFERENCES "RiderRateRule"(id),
  "lowerMeters" INTEGER NOT NULL CHECK ("lowerMeters" >= 0), "upperMeters" INTEGER,
  "amountMinor" BIGINT NOT NULL CHECK ("amountMinor" > 0), UNIQUE ("ruleId","lowerMeters"),
  CHECK ("upperMeters" IS NULL OR "upperMeters" > "lowerMeters")
);
CREATE INDEX "RiderRateSlab_ruleId_idx" ON "RiderRateSlab"("ruleId");
CREATE TABLE "RiderRateSnapshot" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "assignmentId" UUID NOT NULL UNIQUE REFERENCES "RiderAssignment"(id),
  "ruleId" UUID NOT NULL REFERENCES "RiderRateRule"(id), "slabId" UUID NOT NULL REFERENCES "RiderRateSlab"(id),
  "countryId" UUID NOT NULL REFERENCES "Country"(id), "riderId" UUID NOT NULL REFERENCES "RiderProfile"(id),
  "roadDistanceMeters" INTEGER NOT NULL, "amountMinor" BIGINT NOT NULL CHECK ("amountMinor" > 0),
  currency VARCHAR(3) NOT NULL, "routeEvidenceHash" VARCHAR(64) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "RiderRateSnapshot_riderId_createdAt_idx" ON "RiderRateSnapshot"("riderId","createdAt");
CREATE TABLE "RiderEarning" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "deliveryId" UUID NOT NULL UNIQUE REFERENCES "Delivery"(id),
  "riderId" UUID NOT NULL REFERENCES "RiderProfile"(id), "countryId" UUID NOT NULL REFERENCES "Country"(id),
  "amountMinor" BIGINT NOT NULL CHECK ("amountMinor" > 0), currency VARCHAR(3) NOT NULL,
  "journalId" UUID NOT NULL UNIQUE REFERENCES "LedgerJournal"(id), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "RiderEarning_riderId_createdAt_idx" ON "RiderEarning"("riderId","createdAt");
CREATE INDEX "RiderEarning_countryId_createdAt_idx" ON "RiderEarning"("countryId","createdAt");
CREATE TABLE "CodCollection" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "deliveryId" UUID NOT NULL UNIQUE REFERENCES "Delivery"(id),
  "orderId" UUID NOT NULL REFERENCES "Order"(id), "riderId" UUID NOT NULL REFERENCES "RiderProfile"(id),
  "countryId" UUID NOT NULL REFERENCES "Country"(id), "amountMinor" BIGINT NOT NULL CHECK ("amountMinor" > 0),
  currency VARCHAR(3) NOT NULL, "journalId" UUID NOT NULL UNIQUE REFERENCES "LedgerJournal"(id),
  "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CodCollection_riderId_collectedAt_idx" ON "CodCollection"("riderId","collectedAt");
CREATE INDEX "CodCollection_countryId_collectedAt_idx" ON "CodCollection"("countryId","collectedAt");
CREATE TABLE "CodDeposit" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "riderId" UUID NOT NULL REFERENCES "RiderProfile"(id),
  "countryId" UUID NOT NULL REFERENCES "Country"(id), "amountMinor" BIGINT NOT NULL CHECK ("amountMinor" > 0),
  currency VARCHAR(3) NOT NULL, method "CodDepositMethod" NOT NULL, "externalReference" VARCHAR(128) NOT NULL,
  "evidenceHash" VARCHAR(64) NOT NULL, status "CodDepositStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "commandKey" VARCHAR(128) NOT NULL, "payloadHash" VARCHAR(64) NOT NULL,
  "submittedByUserId" UUID NOT NULL REFERENCES "User"(id), "reviewedByUserId" UUID REFERENCES "User"(id),
  "reviewCommandKey" VARCHAR(128), "reviewPayloadHash" VARCHAR(64), "reviewReason" VARCHAR(512),
  "journalId" UUID UNIQUE REFERENCES "LedgerJournal"(id), version INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reviewedAt" TIMESTAMP(3),
  UNIQUE ("riderId","commandKey"), UNIQUE ("riderId",method,"externalReference")
);
CREATE INDEX "CodDeposit_countryId_status_createdAt_idx" ON "CodDeposit"("countryId",status,"createdAt");
CREATE TABLE "CodAllocation" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "depositId" UUID NOT NULL REFERENCES "CodDeposit"(id),
  "collectionId" UUID NOT NULL REFERENCES "CodCollection"(id), "amountMinor" BIGINT NOT NULL CHECK ("amountMinor" > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE ("depositId","collectionId")
);
CREATE INDEX "CodAllocation_collectionId_idx" ON "CodAllocation"("collectionId");

-- Rate slabs must be contiguous, lower-inclusive/upper-exclusive, with one open-ended final slab.
CREATE OR REPLACE FUNCTION gs_rider_rate_slabs_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r RECORD; prev_upper INTEGER; cnt INTEGER; open_cnt INTEGER;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE "upperMeters" IS NULL) INTO cnt, open_cnt FROM "RiderRateSlab" WHERE "ruleId"=NEW."ruleId";
  IF cnt < 1 OR open_cnt <> 1 THEN RAISE EXCEPTION 'rider_rate_slabs_invalid'; END IF;
  prev_upper := NULL;
  FOR r IN SELECT "lowerMeters","upperMeters" FROM "RiderRateSlab" WHERE "ruleId"=NEW."ruleId" ORDER BY "lowerMeters" LOOP
    IF prev_upper IS NULL THEN
      IF r."lowerMeters" <> 0 THEN RAISE EXCEPTION 'rider_rate_slabs_gap'; END IF;
    ELSIF r."lowerMeters" <> prev_upper THEN RAISE EXCEPTION 'rider_rate_slabs_gap'; END IF;
    prev_upper := r."upperMeters";
  END LOOP;
  IF prev_upper IS NOT NULL THEN RAISE EXCEPTION 'rider_rate_slabs_invalid'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER rider_rate_slabs_consistent AFTER INSERT ON "RiderRateSlab" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_rider_rate_slabs_consistent();

CREATE OR REPLACE FUNCTION gs_rider_rate_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "RiderAssignment"%ROWTYPE; s "RiderRateSlab"%ROWTYPE; r "RiderRateRule"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'rider_finance_write_privileged_only'; END IF;
  SELECT * INTO a FROM "RiderAssignment" WHERE "id"=NEW."assignmentId";
  SELECT * INTO s FROM "RiderRateSlab" WHERE "id"=NEW."slabId";
  SELECT * INTO r FROM "RiderRateRule" WHERE "id"=NEW."ruleId";
  IF NOT FOUND OR r."countryId" <> NEW."countryId" OR r.currency <> NEW.currency OR s."ruleId" <> r.id THEN RAISE EXCEPTION 'rider_rate_snapshot_mismatch'; END IF;
  IF a."riderId" <> NEW."riderId" OR a."countryId" <> NEW."countryId" OR a."roadDistanceMeters" <> NEW."roadDistanceMeters" OR a."routeEvidenceHash" <> NEW."routeEvidenceHash" THEN RAISE EXCEPTION 'rider_rate_snapshot_assignment_mismatch'; END IF;
  IF NEW."roadDistanceMeters" < s."lowerMeters" OR (s."upperMeters" IS NOT NULL AND NEW."roadDistanceMeters" >= s."upperMeters") OR NEW."amountMinor" <> s."amountMinor" THEN RAISE EXCEPTION 'rider_rate_snapshot_slab_mismatch'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER rider_rate_snapshot_guard BEFORE INSERT ON "RiderRateSnapshot" FOR EACH ROW EXECUTE FUNCTION gs_rider_rate_snapshot_guard();
CREATE TRIGGER rider_rate_snapshot_append_only BEFORE UPDATE OR DELETE ON "RiderRateSnapshot" FOR EACH ROW EXECUTE FUNCTION gs_append_only();
CREATE TRIGGER rider_rate_slab_append_only BEFORE UPDATE OR DELETE ON "RiderRateSlab" FOR EACH ROW EXECUTE FUNCTION gs_append_only();

CREATE OR REPLACE FUNCTION gs_rider_earning_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d "Delivery"%ROWTYPE; snap "RiderRateSnapshot"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'rider_finance_write_privileged_only'; END IF;
  SELECT * INTO d FROM "Delivery" WHERE "id"=NEW."deliveryId";
  IF NOT FOUND OR d."riderId" <> NEW."riderId" OR d."countryId" <> NEW."countryId" OR d."status" <> 'COMPLETED' THEN RAISE EXCEPTION 'rider_earning_delivery_not_completed'; END IF;
  SELECT * INTO snap FROM "RiderRateSnapshot" WHERE "assignmentId"=d."assignmentId";
  IF NOT FOUND OR snap."amountMinor" <> NEW."amountMinor" OR snap.currency <> NEW.currency THEN RAISE EXCEPTION 'rider_earning_snapshot_mismatch'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER rider_earning_guard BEFORE INSERT ON "RiderEarning" FOR EACH ROW EXECUTE FUNCTION gs_rider_earning_guard();
CREATE TRIGGER rider_earning_append_only BEFORE UPDATE OR DELETE ON "RiderEarning" FOR EACH ROW EXECUTE FUNCTION gs_append_only();

CREATE OR REPLACE FUNCTION gs_cod_collection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d "Delivery"%ROWTYPE; o "Order"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'rider_finance_write_privileged_only'; END IF;
  SELECT * INTO d FROM "Delivery" WHERE "id"=NEW."deliveryId";
  SELECT * INTO o FROM "Order" WHERE "id"=NEW."orderId";
  IF NOT FOUND OR o."paymentMethod" <> 'COD' OR d."suborderId" NOT IN (SELECT id FROM "VendorSuborder" WHERE "orderId"=o.id) THEN RAISE EXCEPTION 'cod_collection_order_mismatch'; END IF;
  IF d."riderId" <> NEW."riderId" OR d."countryId" <> NEW."countryId" OR d."status" <> 'COMPLETED' THEN RAISE EXCEPTION 'cod_collection_delivery_not_completed'; END IF;
  IF NEW."amountMinor" <> o."amountMinor" OR NEW.currency <> o.currency THEN RAISE EXCEPTION 'cod_collection_amount_mismatch'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER cod_collection_guard BEFORE INSERT ON "CodCollection" FOR EACH ROW EXECUTE FUNCTION gs_cod_collection_guard();
CREATE TRIGGER cod_collection_append_only BEFORE UPDATE OR DELETE ON "CodCollection" FOR EACH ROW EXECUTE FUNCTION gs_append_only();

CREATE OR REPLACE FUNCTION gs_cod_deposit_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'rider_finance_write_privileged_only'; END IF;
  IF NEW.status <> 'PENDING_REVIEW' OR NEW.version <> 1 OR NEW."journalId" IS NOT NULL OR NEW."reviewedAt" IS NOT NULL THEN RAISE EXCEPTION 'cod_deposit_must_start_pending'; END IF;
  IF NEW."commandKey" !~ '^[A-Za-z0-9:_-]{8,128}$' OR length(trim(NEW."externalReference")) < 3 THEN RAISE EXCEPTION 'cod_deposit_command_invalid'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER cod_deposit_insert_guard BEFORE INSERT ON "CodDeposit" FOR EACH ROW EXECUTE FUNCTION gs_cod_deposit_insert_guard();
CREATE OR REPLACE FUNCTION gs_cod_deposit_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'rider_finance_write_privileged_only'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW."riderId" IS DISTINCT FROM OLD."riderId" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor" OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.method IS DISTINCT FROM OLD.method OR NEW."externalReference" IS DISTINCT FROM OLD."externalReference" OR NEW."evidenceHash" IS DISTINCT FROM OLD."evidenceHash" OR NEW."commandKey" IS DISTINCT FROM OLD."commandKey" OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash" OR NEW."submittedByUserId" IS DISTINCT FROM OLD."submittedByUserId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN RAISE EXCEPTION 'cod_deposit_immutable_fields'; END IF;
  IF OLD.status <> 'PENDING_REVIEW' OR NEW.status NOT IN ('VERIFIED','REJECTED') OR NEW.version <> OLD.version+1 THEN RAISE EXCEPTION 'cod_deposit_invalid_transition'; END IF;
  IF NEW."reviewedByUserId" IS NULL OR NEW."reviewedAt" IS NULL OR NEW."reviewReason" IS NULL OR NEW."reviewCommandKey" IS NULL OR NEW."reviewPayloadHash" IS NULL THEN RAISE EXCEPTION 'cod_deposit_review_metadata_required'; END IF;
  IF NEW."reviewedByUserId" = OLD."submittedByUserId" THEN RAISE EXCEPTION 'cod_deposit_self_review_denied'; END IF;
  IF (NEW.status='VERIFIED' AND NEW."journalId" IS NULL) OR (NEW.status='REJECTED' AND NEW."journalId" IS NOT NULL) THEN RAISE EXCEPTION 'cod_deposit_journal_state_invalid'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER cod_deposit_update_guard BEFORE UPDATE ON "CodDeposit" FOR EACH ROW EXECUTE FUNCTION gs_cod_deposit_update_guard();
CREATE TRIGGER cod_deposit_no_delete BEFORE DELETE ON "CodDeposit" FOR EACH ROW EXECUTE FUNCTION gs_append_only();

CREATE OR REPLACE FUNCTION gs_cod_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE dep "CodDeposit"%ROWTYPE; col "CodCollection"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'rider_finance_write_privileged_only'; END IF;
  SELECT * INTO dep FROM "CodDeposit" WHERE "id"=NEW."depositId";
  SELECT * INTO col FROM "CodCollection" WHERE "id"=NEW."collectionId";
  IF NOT FOUND OR dep.status <> 'VERIFIED' OR dep."riderId" <> col."riderId" OR dep."countryId" <> col."countryId" OR dep.currency <> col.currency THEN RAISE EXCEPTION 'cod_allocation_mismatch'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER cod_allocation_guard BEFORE INSERT ON "CodAllocation" FOR EACH ROW EXECUTE FUNCTION gs_cod_allocation_guard();
CREATE TRIGGER cod_allocation_append_only BEFORE UPDATE OR DELETE ON "CodAllocation" FOR EACH ROW EXECUTE FUNCTION gs_append_only();
CREATE OR REPLACE FUNCTION gs_cod_allocation_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE dep_amount BIGINT; col_amount BIGINT; allocated_dep BIGINT; allocated_col BIGINT;
BEGIN
  SELECT "amountMinor" INTO dep_amount FROM "CodDeposit" WHERE "id"=NEW."depositId";
  SELECT "amountMinor" INTO col_amount FROM "CodCollection" WHERE "id"=NEW."collectionId";
  SELECT COALESCE(SUM("amountMinor"),0) INTO allocated_dep FROM "CodAllocation" WHERE "depositId"=NEW."depositId";
  SELECT COALESCE(SUM("amountMinor"),0) INTO allocated_col FROM "CodAllocation" WHERE "collectionId"=NEW."collectionId";
  IF allocated_dep > dep_amount OR allocated_col > col_amount THEN RAISE EXCEPTION 'cod_allocation_exceeds_balance'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER cod_allocation_consistent AFTER INSERT ON "CodAllocation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gs_cod_allocation_consistent();

ALTER TABLE "RiderRateRule" ENABLE ROW LEVEL SECURITY; ALTER TABLE "RiderRateRule" FORCE ROW LEVEL SECURITY;
CREATE POLICY rider_rate_rule_super_only ON "RiderRateRule" USING (gs_is_super()) WITH CHECK (gs_is_super());
ALTER TABLE "RiderRateSlab" ENABLE ROW LEVEL SECURITY; ALTER TABLE "RiderRateSlab" FORCE ROW LEVEL SECURITY;
CREATE POLICY rider_rate_slab_super_only ON "RiderRateSlab" USING (gs_is_super()) WITH CHECK (gs_is_super());
ALTER TABLE "RiderRateSnapshot" ENABLE ROW LEVEL SECURITY; ALTER TABLE "RiderRateSnapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY rider_rate_snapshot_select ON "RiderRateSnapshot" FOR SELECT USING (gs_is_super() OR EXISTS (SELECT 1 FROM "RiderProfile" r WHERE r.id="riderId" AND r."userId"=gs_current_user_id()));
CREATE POLICY rider_rate_snapshot_insert_super ON "RiderRateSnapshot" FOR INSERT WITH CHECK (gs_is_super());
ALTER TABLE "RiderEarning" ENABLE ROW LEVEL SECURITY; ALTER TABLE "RiderEarning" FORCE ROW LEVEL SECURITY;
CREATE POLICY rider_earning_select ON "RiderEarning" FOR SELECT USING (gs_is_super() OR EXISTS (SELECT 1 FROM "RiderProfile" r WHERE r.id="riderId" AND r."userId"=gs_current_user_id()));
CREATE POLICY rider_earning_insert_super ON "RiderEarning" FOR INSERT WITH CHECK (gs_is_super());
ALTER TABLE "CodCollection" ENABLE ROW LEVEL SECURITY; ALTER TABLE "CodCollection" FORCE ROW LEVEL SECURITY;
CREATE POLICY cod_collection_select ON "CodCollection" FOR SELECT USING (gs_is_super() OR EXISTS (SELECT 1 FROM "RiderProfile" r WHERE r.id="riderId" AND r."userId"=gs_current_user_id()));
CREATE POLICY cod_collection_insert_super ON "CodCollection" FOR INSERT WITH CHECK (gs_is_super());
ALTER TABLE "CodDeposit" ENABLE ROW LEVEL SECURITY; ALTER TABLE "CodDeposit" FORCE ROW LEVEL SECURITY;
CREATE POLICY cod_deposit_select ON "CodDeposit" FOR SELECT USING (gs_is_super() OR EXISTS (SELECT 1 FROM "RiderProfile" r WHERE r.id="riderId" AND r."userId"=gs_current_user_id()));
CREATE POLICY cod_deposit_insert_super ON "CodDeposit" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY cod_deposit_update_super ON "CodDeposit" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());
ALTER TABLE "CodAllocation" ENABLE ROW LEVEL SECURITY; ALTER TABLE "CodAllocation" FORCE ROW LEVEL SECURITY;
CREATE POLICY cod_allocation_select ON "CodAllocation" FOR SELECT USING (gs_is_super() OR EXISTS (SELECT 1 FROM "RiderProfile" r WHERE r.id=(SELECT "riderId" FROM "CodDeposit" d WHERE d.id="depositId") AND r."userId"=gs_current_user_id()));
CREATE POLICY cod_allocation_insert_super ON "CodAllocation" FOR INSERT WITH CHECK (gs_is_super());
