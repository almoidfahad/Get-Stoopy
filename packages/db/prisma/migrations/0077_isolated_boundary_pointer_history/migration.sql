-- Inert owner-only structural history. No actor or approval authority is
-- asserted. Do not fabricate history for any pre-existing pointer.
BEGIN;
LOCK TABLE "ZoneBoundaryPointer" IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ZoneBoundaryPointer") THEN
    RAISE EXCEPTION 'zone_boundary_pointer_history_requires_empty_table';
  END IF;
END $$;

CREATE TABLE "ZoneBoundaryPointerHistory" (
  "zoneId" UUID NOT NULL REFERENCES "ZoneBoundaryPointer"("zoneId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "version" INTEGER NOT NULL CHECK ("version" >= 1),
  "boundaryId" UUID NOT NULL REFERENCES "BoundaryVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "previousBoundaryId" UUID REFERENCES "BoundaryVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY ("zoneId", "version"),
  CHECK (("version" = 1 AND "previousBoundaryId" IS NULL) OR
         ("version" > 1 AND "previousBoundaryId" IS NOT NULL AND "previousBoundaryId" <> "boundaryId"))
);

-- Only the pointer's own trigger inserts rows; disallow manual insertion or
-- subsequent edits even by an ordinary table owner with enabled triggers.
CREATE OR REPLACE FUNCTION gs_zone_boundary_pointer_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' OR pg_trigger_depth() <> 2 THEN RAISE EXCEPTION 'zone_pointer_history_append_only'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER zone_pointer_history_guard BEFORE INSERT OR UPDATE OR DELETE ON "ZoneBoundaryPointerHistory"
  FOR EACH ROW EXECUTE FUNCTION gs_zone_boundary_pointer_history_guard();

CREATE OR REPLACE FUNCTION gs_zone_boundary_pointer_record_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "ZoneBoundaryPointerHistory"("zoneId", "version", "boundaryId", "previousBoundaryId")
  VALUES (NEW."zoneId", NEW."version", NEW."boundaryId", CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."boundaryId" END);
  RETURN NEW;
END;
$$;
CREATE TRIGGER zone_pointer_record_history AFTER INSERT OR UPDATE ON "ZoneBoundaryPointer"
  FOR EACH ROW EXECUTE FUNCTION gs_zone_boundary_pointer_record_history();

ALTER TABLE "ZoneBoundaryPointerHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ZoneBoundaryPointerHistory" FORCE ROW LEVEL SECURITY;
CREATE POLICY zone_pointer_history_owner_only ON "ZoneBoundaryPointerHistory"
  FOR ALL USING (current_user = 'gs_owner') WITH CHECK (current_user = 'gs_owner');
REVOKE ALL ON TABLE "ZoneBoundaryPointerHistory" FROM PUBLIC, gs_runtime, gs_privileged;
COMMENT ON TABLE "ZoneBoundaryPointerHistory" IS 'Owner-only experimental pointer changes; not an authenticated approval audit or live activation.';
COMMIT;
