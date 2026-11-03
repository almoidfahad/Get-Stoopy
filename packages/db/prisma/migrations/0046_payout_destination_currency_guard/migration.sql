-- Correct the country currency column reference; keep all destination eligibility checks.
CREATE OR REPLACE FUNCTION gs_payout_destination_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v "Vendor"%ROWTYPE; c "Country"%ROWTYPE; proof "StorageObject"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'payout_destination_write_privileged_only'; END IF;
  SELECT * INTO v FROM "Vendor" WHERE id=NEW."vendorId";
  SELECT * INTO c FROM "Country" WHERE id=NEW."countryId";
  IF NOT FOUND OR v."countryId" <> NEW."countryId" OR c."currencyCode" <> NEW.currency OR NOT gs_inventory_vendor_eligible(NEW."vendorId") THEN RAISE EXCEPTION 'payout_destination_vendor_ineligible'; END IF;
  IF v."ownerUserId" <> NEW."submittedByUserId" OR NEW."submittedByUserId" <> gs_current_user_id() THEN RAISE EXCEPTION 'payout_destination_owner_required'; END IF;
  SELECT * INTO proof FROM "StorageObject" WHERE id=NEW."proofStorageObjectId";
  IF NOT FOUND OR proof."ownerUserId" <> v."ownerUserId" OR proof.purpose <> 'payout-destination-proof' OR proof.state <> 'UPLOADED' OR NOT proof."magicValid" OR proof."deletedAt" IS NOT NULL THEN RAISE EXCEPTION 'payout_destination_proof_required'; END IF;
  IF NEW.status <> 'PENDING_REVIEW' OR NEW.version <> 1 OR NEW."reviewedByUserId" IS NOT NULL OR NEW."reviewedAt" IS NOT NULL THEN RAISE EXCEPTION 'payout_destination_initial_state'; END IF;
  RETURN NEW;
END; $$;
