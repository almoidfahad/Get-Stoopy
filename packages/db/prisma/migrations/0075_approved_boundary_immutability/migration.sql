-- Preserve approved geographic history for future active-boundary pointers.
-- This does not choose, activate or backfill any boundary.
CREATE OR REPLACE FUNCTION gs_approved_boundary_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."approvedBy" IS NOT NULL THEN RAISE EXCEPTION 'approved_boundary_immutable'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."approvedBy" IS NOT NULL THEN RAISE EXCEPTION 'approved_boundary_immutable'; END IF;
  -- A reviewer must approve the exact proposal already stored, not silently
  -- change geometry, owner or metadata in the same statement as approval.
  IF NEW."approvedBy" IS NOT NULL AND (
    ROW(NEW."id", NEW."ownerType", NEW."ownerId", NEW."version", NEW."source", NEW."validFrom", NEW."contentHash", NEW."createdAt")
      IS DISTINCT FROM
    ROW(OLD."id", OLD."ownerType", OLD."ownerId", OLD."version", OLD."source", OLD."validFrom", OLD."contentHash", OLD."createdAt")
    OR ST_AsEWKB(NEW."boundary") IS DISTINCT FROM ST_AsEWKB(OLD."boundary")
  ) THEN
    RAISE EXCEPTION 'boundary_approval_must_not_change_proposal';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER approved_boundary_immutable BEFORE UPDATE OR DELETE ON "BoundaryVersion"
  FOR EACH ROW EXECUTE FUNCTION gs_approved_boundary_immutable();
