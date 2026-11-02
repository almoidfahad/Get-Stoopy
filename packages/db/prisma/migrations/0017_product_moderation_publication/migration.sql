-- Product moderation/publication gate and public-read eligibility foundation.
-- Additive columns + replacement guards. No existing rows are rewritten.
CREATE TYPE "ProductModerationState" AS ENUM ('NOT_SUBMITTED','PENDING_REVIEW','APPROVED','REJECTED');
ALTER TABLE "Product"
  ADD COLUMN "moderationState" "ProductModerationState" NOT NULL DEFAULT 'NOT_SUBMITTED',
  ADD COLUMN "moderationReason" VARCHAR(512),
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedByUserId" UUID,
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "publishedByUserId" UUID;
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Product_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Product_countryId_moderationState_createdAt_idx" ON "Product"("countryId","moderationState","createdAt");
CREATE INDEX "Product_countryId_status_createdAt_id_idx" ON "Product"("countryId","status","createdAt","id");

CREATE OR REPLACE FUNCTION gs_product_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "Store"%ROWTYPE; v "Vendor"%ROWTYPE; k "KycCase"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'catalog_write_privileged_only'; END IF;
  IF NEW."status" <> 'DRAFT' OR NEW."moderationState" <> 'NOT_SUBMITTED' OR NEW."submittedAt" IS NOT NULL OR NEW."reviewedAt" IS NOT NULL OR NEW."reviewedByUserId" IS NOT NULL OR NEW."publishedAt" IS NOT NULL OR NEW."publishedByUserId" IS NOT NULL THEN
    RAISE EXCEPTION 'product_must_start_draft';
  END IF;
  SELECT * INTO s FROM "Store" WHERE "id" = NEW."storeId";
  IF NOT FOUND OR s."vendorId" <> NEW."vendorId" OR s."countryId" <> NEW."countryId" THEN RAISE EXCEPTION 'product_store_mismatch'; END IF;
  IF s."status" <> 'ACTIVE' THEN RAISE EXCEPTION 'product_store_not_active'; END IF;
  SELECT * INTO v FROM "Vendor" WHERE "id" = NEW."vendorId";
  IF v."countryId" <> NEW."countryId" OR v."status" <> 'ACTIVE' OR v."kycCaseId" IS NULL THEN RAISE EXCEPTION 'product_vendor_kyc_required'; END IF;
  SELECT * INTO k FROM "KycCase" WHERE "id" = v."kycCaseId";
  IF NOT FOUND OR k."subjectUserId" <> v."ownerUserId" OR k."subjectType" <> 'VENDOR' OR k."countryId" <> v."countryId" OR k."status" <> 'APPROVED' OR k."expiresAt" IS NULL OR k."expiresAt" <= CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'product_vendor_kyc_required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION gs_product_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "Store"%ROWTYPE; v "Vendor"%ROWTYPE; k "KycCase"%ROWTYPE; variant_count INTEGER;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'catalog_write_privileged_only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."vendorId" IS DISTINCT FROM OLD."vendorId" OR NEW."storeId" IS DISTINCT FROM OLD."storeId" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'product_immutable_fields';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'product_version_conflict'; END IF;

  -- Moderation transitions happen while the product remains DRAFT.
  IF NEW."moderationState" IS DISTINCT FROM OLD."moderationState" THEN
    IF NEW."status" <> 'DRAFT' OR OLD."status" <> 'DRAFT' THEN RAISE EXCEPTION 'product_moderation_requires_draft'; END IF;
    IF NOT ((OLD."moderationState"='NOT_SUBMITTED' AND NEW."moderationState"='PENDING_REVIEW') OR (OLD."moderationState"='REJECTED' AND NEW."moderationState"='PENDING_REVIEW') OR (OLD."moderationState"='PENDING_REVIEW' AND NEW."moderationState"='APPROVED') OR (OLD."moderationState"='PENDING_REVIEW' AND NEW."moderationState"='REJECTED')) THEN
      RAISE EXCEPTION 'product_moderation_invalid_transition';
    END IF;
    IF NEW."moderationState"='PENDING_REVIEW' THEN
      IF NEW."submittedAt" IS NULL THEN RAISE EXCEPTION 'product_submission_metadata_required'; END IF;
      SELECT * INTO s FROM "Store" WHERE "id" = NEW."storeId";
      SELECT * INTO v FROM "Vendor" WHERE "id" = NEW."vendorId";
      IF s."status" <> 'ACTIVE' OR v."status" <> 'ACTIVE' OR v."kycCaseId" IS NULL THEN RAISE EXCEPTION 'product_vendor_kyc_required'; END IF;
      SELECT * INTO k FROM "KycCase" WHERE "id" = v."kycCaseId";
      IF NOT FOUND OR k."subjectUserId" <> v."ownerUserId" OR k."subjectType" <> 'VENDOR' OR k."countryId" <> v."countryId" OR k."status" <> 'APPROVED' OR k."expiresAt" IS NULL OR k."expiresAt" <= CURRENT_TIMESTAMP THEN
        RAISE EXCEPTION 'product_vendor_kyc_required';
      END IF;
      SELECT count(*) INTO variant_count FROM "ProductVariant" WHERE "productId"=NEW."id" AND "active"=true;
      IF variant_count < 1 THEN RAISE EXCEPTION 'product_active_variant_required'; END IF;
    END IF;
    IF NEW."moderationState" IN ('APPROVED','REJECTED') THEN
      IF NEW."reviewedAt" IS NULL OR NEW."reviewedByUserId" IS NULL OR NEW."moderationReason" IS NULL OR length(trim(NEW."moderationReason")) < 8 THEN
        RAISE EXCEPTION 'product_review_metadata_required';
      END IF;
      SELECT * INTO v FROM "Vendor" WHERE "id" = NEW."vendorId";
      IF NEW."reviewedByUserId" = NEW."createdByUserId" OR NEW."reviewedByUserId" = v."ownerUserId" THEN
        RAISE EXCEPTION 'product_self_review_denied';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- Publication/unpublication/archive transitions keep moderation state unchanged.
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NOT ((OLD."status"='DRAFT' AND NEW."status"='PUBLISHED') OR (OLD."status"='PUBLISHED' AND NEW."status"='DRAFT') OR (OLD."status"='DRAFT' AND NEW."status"='ARCHIVED') OR (OLD."status"='PUBLISHED' AND NEW."status"='ARCHIVED')) THEN
      RAISE EXCEPTION 'product_invalid_transition';
    END IF;
    IF NEW."status"='PUBLISHED' THEN
      IF NEW."moderationState" <> 'APPROVED' THEN RAISE EXCEPTION 'product_moderation_approved_required'; END IF;
      IF NEW."publishedAt" IS NULL OR NEW."publishedByUserId" IS NULL THEN RAISE EXCEPTION 'product_publication_metadata_required'; END IF;
      SELECT * INTO s FROM "Store" WHERE "id" = NEW."storeId";
      SELECT * INTO v FROM "Vendor" WHERE "id" = NEW."vendorId";
      IF NEW."publishedByUserId" = NEW."createdByUserId" OR NEW."publishedByUserId" = v."ownerUserId" THEN
        RAISE EXCEPTION 'product_self_publication_denied';
      END IF;
      IF s."status" <> 'ACTIVE' OR v."status" <> 'ACTIVE' OR v."kycCaseId" IS NULL THEN RAISE EXCEPTION 'product_vendor_kyc_required'; END IF;
      SELECT * INTO k FROM "KycCase" WHERE "id" = v."kycCaseId";
      IF NOT FOUND OR k."subjectUserId" <> v."ownerUserId" OR k."subjectType" <> 'VENDOR' OR k."countryId" <> v."countryId" OR k."status" <> 'APPROVED' OR k."expiresAt" IS NULL OR k."expiresAt" <= CURRENT_TIMESTAMP THEN
        RAISE EXCEPTION 'product_vendor_kyc_required';
      END IF;
      SELECT count(*) INTO variant_count FROM "ProductVariant" WHERE "productId"=NEW."id" AND "active"=true;
      IF variant_count < 1 THEN RAISE EXCEPTION 'product_active_variant_required'; END IF;
    END IF;
    IF NEW."status"='DRAFT' AND OLD."status"='PUBLISHED' THEN
      NEW."publishedAt" := NULL;
      NEW."publishedByUserId" := NULL;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'product_invalid_transition';
END;
$$;

CREATE OR REPLACE FUNCTION gs_product_variant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "Product"%ROWTYPE; expected_currency TEXT;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'catalog_write_privileged_only'; END IF;
  SELECT * INTO p FROM "Product" WHERE "id" = NEW."productId";
  IF NOT FOUND THEN RAISE EXCEPTION 'variant_product_not_found'; END IF;
  IF p."status" = 'ARCHIVED' THEN RAISE EXCEPTION 'variant_product_archived'; END IF;
  IF p."status" = 'PUBLISHED' THEN RAISE EXCEPTION 'variant_product_published_locked'; END IF;
  SELECT "currencyCode" INTO expected_currency FROM "Country" WHERE "id" = p."countryId";
  IF NEW."currency" <> expected_currency THEN RAISE EXCEPTION 'variant_currency_mismatch'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."productId" IS DISTINCT FROM OLD."productId" OR NEW."sku" IS DISTINCT FROM OLD."sku" OR NEW."currency" IS DISTINCT FROM OLD."currency" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
      RAISE EXCEPTION 'variant_immutable_fields';
    END IF;
    IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'variant_version_conflict'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON COLUMN "Product"."moderationState" IS 'Explicit moderation gate; publication requires APPROVED plus privileged non-self publish command.';
COMMENT ON FUNCTION gs_product_update_guard() IS 'Enforces moderation, publication, unpublication and archive transitions with KYC/store/variant eligibility.';
