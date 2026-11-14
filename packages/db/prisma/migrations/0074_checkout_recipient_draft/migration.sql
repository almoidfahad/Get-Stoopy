-- Test-only encrypted pre-order recipient draft foundation. No production
-- feature is enabled by this migration. Tombstones retain the monotonic version.
CREATE TABLE "CheckoutRecipientDraft" (
  "cartId" UUID PRIMARY KEY REFERENCES "Cart"("id") ON DELETE RESTRICT,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" >= 1),
  "envelope" BYTEA,
  "expiresAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CheckoutRecipientDraft_envelope_state" CHECK (
    ("envelope" IS NULL AND "expiresAt" IS NULL) OR
    ("envelope" IS NOT NULL AND octet_length("envelope") > 0 AND "expiresAt" IS NOT NULL)
  )
);
CREATE OR REPLACE FUNCTION gs_checkout_recipient_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'checkout_draft_delete_forbidden'; END IF;
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'checkout_draft_privileged_only'; END IF;
  SELECT "userId" INTO owner_id FROM "Cart" WHERE id = NEW."cartId";
  IF NOT FOUND OR owner_id <> gs_current_user_id() THEN RAISE EXCEPTION 'checkout_draft_owner_mismatch'; END IF;
  IF TG_OP = 'INSERT' AND NEW."version" <> 1 THEN RAISE EXCEPTION 'checkout_draft_initial_version'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW."cartId" IS DISTINCT FROM OLD."cartId" OR NEW."version" <> OLD."version" + 1) THEN
    RAISE EXCEPTION 'checkout_draft_version_invalid';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER checkout_recipient_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON "CheckoutRecipientDraft" FOR EACH ROW EXECUTE FUNCTION gs_checkout_recipient_draft_guard();
ALTER TABLE "CheckoutRecipientDraft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CheckoutRecipientDraft" FORCE ROW LEVEL SECURITY;
CREATE POLICY checkout_draft_select_super ON "CheckoutRecipientDraft" FOR SELECT USING (gs_is_super());
CREATE POLICY checkout_draft_insert_super ON "CheckoutRecipientDraft" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY checkout_draft_update_super ON "CheckoutRecipientDraft" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());
COMMENT ON TABLE "CheckoutRecipientDraft" IS 'Test-only encrypted pre-order draft; expiry is logical, cleanup and retention are not yet automated.';
