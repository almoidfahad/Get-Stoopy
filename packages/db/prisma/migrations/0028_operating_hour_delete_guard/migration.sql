-- Fix operating-hour DELETE trigger to avoid referencing unassigned NEW record.
CREATE OR REPLACE FUNCTION gs_store_operating_hour_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "Store"%ROWTYPE; sid UUID;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'serviceability_write_privileged_only'; END IF;
  IF TG_OP = 'DELETE' THEN sid := OLD."storeId"; ELSE sid := NEW."storeId"; END IF;
  SELECT * INTO s FROM "Store" WHERE "id" = sid;
  IF NOT FOUND OR s."status" <> 'ACTIVE' OR NOT gs_inventory_vendor_eligible(s."vendorId") THEN RAISE EXCEPTION 'hours_store_not_eligible'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM "StoreOperatingHour" h WHERE h."storeId" = NEW."storeId" AND h."dayOfWeek" = NEW."dayOfWeek" AND h."id" <> NEW."id" AND NEW."openMinute" < h."closeMinute" AND NEW."closeMinute" > h."openMinute") THEN
    RAISE EXCEPTION 'hours_overlap';
  END IF;
  RETURN NEW;
END;
$$;
