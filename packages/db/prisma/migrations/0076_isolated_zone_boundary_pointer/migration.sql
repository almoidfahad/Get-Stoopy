-- Inert structural foundation only. No API, application-role access or
-- automatic backfill; preview and dispatch do not use this table.
CREATE TABLE "ZoneBoundaryPointer" (
  "zoneId" UUID PRIMARY KEY REFERENCES "ServiceZone"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "boundaryId" UUID NOT NULL REFERENCES "BoundaryVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "version" INTEGER NOT NULL CHECK ("version" >= 1)
);

CREATE OR REPLACE FUNCTION gs_zone_boundary_pointer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "BoundaryVersion"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'zone_boundary_pointer_delete_forbidden'; END IF;
  IF TG_OP = 'INSERT' AND NEW."version" <> 1 THEN RAISE EXCEPTION 'zone_boundary_pointer_initial_version'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW."zoneId" IS DISTINCT FROM OLD."zoneId" OR NEW."version"::bigint <> OLD."version"::bigint + 1 OR NEW."boundaryId" IS NOT DISTINCT FROM OLD."boundaryId") THEN
    RAISE EXCEPTION 'zone_boundary_pointer_version_invalid';
  END IF;
  -- Row lock coordinates with concurrent approval. Already-approved geometry
  -- is immutable under migration 0075; rollback leaves the pointer untouched.
  SELECT * INTO b FROM "BoundaryVersion" WHERE id=NEW."boundaryId" FOR SHARE;
  IF NOT FOUND OR b."ownerType" <> 'ZONE' OR b."ownerId" <> NEW."zoneId" OR b."approvedBy" IS NULL OR b."validFrom" > gs_dispatch_now() THEN
    RAISE EXCEPTION 'zone_boundary_pointer_boundary_invalid';
  END IF;
  IF ST_IsEmpty(b.boundary) OR NOT ST_IsValid(b.boundary) OR ST_XMin(Box3D(b.boundary)) < -180 OR ST_XMax(Box3D(b.boundary)) > 180 OR ST_YMin(Box3D(b.boundary)) < -90 OR ST_YMax(Box3D(b.boundary)) > 90 THEN
    RAISE EXCEPTION 'zone_boundary_pointer_geometry_invalid';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER zone_boundary_pointer_guard BEFORE INSERT OR UPDATE OR DELETE ON "ZoneBoundaryPointer"
  FOR EACH ROW EXECUTE FUNCTION gs_zone_boundary_pointer_guard();

-- Fail closed even if default grants are broad. Only the migration owner can
-- access this inert table; application roles get no policy and no privileges.
ALTER TABLE "ZoneBoundaryPointer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ZoneBoundaryPointer" FORCE ROW LEVEL SECURITY;
CREATE POLICY zone_boundary_pointer_owner_only ON "ZoneBoundaryPointer"
  FOR ALL USING (current_user = 'gs_owner') WITH CHECK (current_user = 'gs_owner');
REVOKE ALL ON TABLE "ZoneBoundaryPointer" FROM PUBLIC, gs_runtime, gs_privileged;
COMMENT ON TABLE "ZoneBoundaryPointer" IS 'Isolated owner-only pointer foundation; not an approved activation workflow or live serviceability source.';
