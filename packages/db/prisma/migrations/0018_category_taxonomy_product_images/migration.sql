-- Category taxonomy and product image foundation.
-- Additive tables/columns plus replacement guards. Existing rows are not rewritten.
CREATE TYPE "CategoryStatus" AS ENUM ('DRAFT','ACTIVE','SUSPENDED');
CREATE TYPE "ProductImageStatus" AS ENUM ('PENDING_REVIEW','APPROVED','REJECTED');

CREATE TABLE "Category" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "countryId" UUID NOT NULL,
  "parentId" UUID,
  "name" VARCHAR(120) NOT NULL,
  "slug" VARCHAR(140) NOT NULL,
  "description" VARCHAR(500),
  "status" "CategoryStatus" NOT NULL DEFAULT 'DRAFT',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "activatedByUserId" UUID,
  "suspendedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Category_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Category_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Category_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Category_activatedByUserId_fkey" FOREIGN KEY ("activatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Category_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT "Category_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "Category_sortOrder_nonnegative" CHECK ("sortOrder" >= 0)
);
CREATE UNIQUE INDEX "Category_countryId_slug_key" ON "Category"("countryId","slug");
CREATE INDEX "Category_countryId_status_sortOrder_idx" ON "Category"("countryId","status","sortOrder");
CREATE INDEX "Category_parentId_status_idx" ON "Category"("parentId","status");

ALTER TABLE "Product" ADD COLUMN "categoryId" UUID;
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProductImage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "productId" UUID NOT NULL,
  "storageObjectId" UUID NOT NULL,
  "countryId" UUID NOT NULL,
  "altText" VARCHAR(180) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "state" "ProductImageStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "reviewedByUserId" UUID,
  "reviewedAt" TIMESTAMP(3),
  "reviewReason" VARCHAR(512),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductImage_storageObjectId_fkey" FOREIGN KEY ("storageObjectId") REFERENCES "StorageObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductImage_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductImage_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductImage_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductImage_altText_length" CHECK (length(trim("altText")) BETWEEN 3 AND 180),
  CONSTRAINT "ProductImage_sortOrder_range" CHECK ("sortOrder" BETWEEN 0 AND 7),
  CONSTRAINT "ProductImage_version_positive" CHECK ("version" >= 1)
);
CREATE UNIQUE INDEX "ProductImage_storageObjectId_key" ON "ProductImage"("storageObjectId");
CREATE UNIQUE INDEX "ProductImage_productId_sortOrder_key" ON "ProductImage"("productId","sortOrder");
CREATE INDEX "ProductImage_productId_state_idx" ON "ProductImage"("productId","state");
CREATE INDEX "ProductImage_countryId_state_createdAt_idx" ON "ProductImage"("countryId","state","createdAt");
CREATE INDEX "Product_categoryId_status_idx" ON "Product"("categoryId","status");

ALTER TABLE "Category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Category" FORCE ROW LEVEL SECURITY;
CREATE POLICY category_select_active_or_super ON "Category" FOR SELECT USING (gs_is_super() OR "status" = 'ACTIVE');
CREATE POLICY category_insert_super_only ON "Category" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY category_update_super_only ON "Category" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

ALTER TABLE "ProductImage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductImage" FORCE ROW LEVEL SECURITY;
CREATE POLICY product_image_select_member_or_super ON "ProductImage" FOR SELECT USING (
  gs_is_super() OR EXISTS (
    SELECT 1 FROM "Product" p
    JOIN "VendorMembership" m ON m."vendorId" = p."vendorId"
    JOIN "Vendor" v ON v."id" = p."vendorId"
    WHERE p."id" = "ProductImage"."productId"
      AND m."userId" = gs_current_user_id()
      AND m."revokedAt" IS NULL
      AND (m."expiresAt" IS NULL OR m."expiresAt" > CURRENT_TIMESTAMP)
      AND v."status" = 'ACTIVE'
  )
);
CREATE POLICY product_image_insert_super_only ON "ProductImage" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY product_image_update_super_only ON "ProductImage" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

CREATE OR REPLACE FUNCTION gs_category_depth(cat_id UUID) RETURNS INTEGER LANGUAGE sql STABLE AS $$
  WITH RECURSIVE chain(id, parent, depth) AS (
    SELECT c."id", c."parentId", 1 FROM "Category" c WHERE c."id" = cat_id
    UNION ALL
    SELECT p."id", p."parentId", chain.depth + 1 FROM "Category" p JOIN chain ON p."id" = chain.parent WHERE chain.depth < 10
  )
  SELECT COALESCE(MAX(depth), 0) FROM chain;
$$;

CREATE OR REPLACE FUNCTION gs_category_chain_active(cat_id UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  WITH RECURSIVE chain(id, parent, status, depth) AS (
    SELECT c."id", c."parentId", c."status", 1 FROM "Category" c WHERE c."id" = cat_id
    UNION ALL
    SELECT p."id", p."parentId", p."status", chain.depth + 1 FROM "Category" p JOIN chain ON p."id" = chain.parent WHERE chain.depth < 10
  )
  SELECT COALESCE(bool_and(status = 'ACTIVE'), false) FROM chain;
$$;

CREATE OR REPLACE FUNCTION gs_category_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent "Category"%ROWTYPE; c "Country"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'catalog_write_privileged_only'; END IF;
  IF NEW."status" <> 'DRAFT' OR NEW."version" <> 1 OR NEW."activatedByUserId" IS NOT NULL OR NEW."suspendedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'category_must_start_draft';
  END IF;
  SELECT * INTO c FROM "Country" WHERE "id" = NEW."countryId";
  IF NOT FOUND OR c."status" <> 'ACTIVE' THEN RAISE EXCEPTION 'category_country_not_active'; END IF;
  IF NEW."parentId" IS NOT NULL THEN
    SELECT * INTO parent FROM "Category" WHERE "id" = NEW."parentId";
    IF NOT FOUND OR parent."countryId" <> NEW."countryId" THEN RAISE EXCEPTION 'category_parent_country_mismatch'; END IF;
    IF parent."status" <> 'ACTIVE' OR NOT gs_category_chain_active(parent."id") THEN RAISE EXCEPTION 'category_parent_not_active'; END IF;
    IF gs_category_depth(parent."id") + 1 > 3 THEN RAISE EXCEPTION 'category_depth_invalid'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER category_insert_guard BEFORE INSERT ON "Category" FOR EACH ROW EXECUTE FUNCTION gs_category_insert_guard();

CREATE OR REPLACE FUNCTION gs_category_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent "Category"%ROWTYPE; c "Country"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'catalog_write_privileged_only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."parentId" IS DISTINCT FROM OLD."parentId" OR NEW."slug" IS DISTINCT FROM OLD."slug" OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'category_immutable_fields';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'category_version_conflict'; END IF;
  IF NOT ((OLD."status"='DRAFT' AND NEW."status"='ACTIVE') OR (OLD."status"='ACTIVE' AND NEW."status"='SUSPENDED') OR (OLD."status"='SUSPENDED' AND NEW."status"='ACTIVE')) THEN
    RAISE EXCEPTION 'category_invalid_transition';
  END IF;
  IF NEW."status"='ACTIVE' THEN
    IF NEW."activatedByUserId" IS NULL THEN RAISE EXCEPTION 'category_activation_metadata_required'; END IF;
    IF NEW."activatedByUserId" = NEW."createdByUserId" THEN RAISE EXCEPTION 'category_self_activation_denied'; END IF;
    SELECT * INTO c FROM "Country" WHERE "id" = NEW."countryId";
    IF c."status" <> 'ACTIVE' THEN RAISE EXCEPTION 'category_country_not_active'; END IF;
    IF NEW."parentId" IS NOT NULL THEN
      SELECT * INTO parent FROM "Category" WHERE "id" = NEW."parentId";
      IF parent."status" <> 'ACTIVE' OR NOT gs_category_chain_active(parent."id") THEN RAISE EXCEPTION 'category_parent_not_active'; END IF;
    END IF;
    NEW."suspendedAt" := NULL;
  END IF;
  IF NEW."status"='SUSPENDED' THEN NEW."suspendedAt" := CURRENT_TIMESTAMP; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER category_update_guard BEFORE UPDATE ON "Category" FOR EACH ROW EXECUTE FUNCTION gs_category_update_guard();

CREATE OR REPLACE FUNCTION gs_product_image_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "Product"%ROWTYPE; s "StorageObject"%ROWTYPE; image_count INTEGER;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'catalog_write_privileged_only'; END IF;
  SELECT * INTO p FROM "Product" WHERE "id" = NEW."productId";
  IF NOT FOUND THEN RAISE EXCEPTION 'product_image_product_not_found'; END IF;
  IF p."status" <> 'DRAFT' OR p."moderationState" NOT IN ('NOT_SUBMITTED','REJECTED') THEN RAISE EXCEPTION 'product_image_product_locked'; END IF;
  IF NEW."countryId" <> p."countryId" THEN RAISE EXCEPTION 'product_image_country_mismatch'; END IF;
  IF NEW."state" <> 'PENDING_REVIEW' OR NEW."version" <> 1 OR NEW."reviewedByUserId" IS NOT NULL OR NEW."reviewedAt" IS NOT NULL OR NEW."reviewReason" IS NOT NULL THEN
    RAISE EXCEPTION 'product_image_must_start_pending';
  END IF;
  SELECT * INTO s FROM "StorageObject" WHERE "id" = NEW."storageObjectId";
  IF NOT FOUND OR s."purpose" <> 'product-image' OR s."state" <> 'QUARANTINED' OR s."magicValid" <> true OR s."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'product_image_storage_not_ready';
  END IF;
  IF s."ownerUserId" <> NEW."createdByUserId" THEN RAISE EXCEPTION 'product_image_storage_owner_mismatch'; END IF;
  IF s."sizeBytes" IS NULL OR s."sizeBytes" <= 0 OR s."sizeBytes" > 5242880 THEN RAISE EXCEPTION 'product_image_size_invalid'; END IF;
  IF s."contentType" NOT IN ('image/png','image/jpeg','image/webp') THEN RAISE EXCEPTION 'product_image_content_type_invalid'; END IF;
  SELECT count(*) INTO image_count FROM "ProductImage" WHERE "productId" = NEW."productId";
  IF image_count >= 8 THEN RAISE EXCEPTION 'product_image_limit_reached'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER product_image_insert_guard BEFORE INSERT ON "ProductImage" FOR EACH ROW EXECUTE FUNCTION gs_product_image_insert_guard();

CREATE OR REPLACE FUNCTION gs_product_image_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "Product"%ROWTYPE; v "Vendor"%ROWTYPE; s "StorageObject"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'catalog_write_privileged_only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."productId" IS DISTINCT FROM OLD."productId" OR NEW."storageObjectId" IS DISTINCT FROM OLD."storageObjectId" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'product_image_immutable_fields';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'product_image_version_conflict'; END IF;
  IF OLD."state" <> 'PENDING_REVIEW' OR NEW."state" NOT IN ('APPROVED','REJECTED') THEN RAISE EXCEPTION 'product_image_invalid_transition'; END IF;
  IF NEW."reviewedAt" IS NULL OR NEW."reviewedByUserId" IS NULL OR NEW."reviewReason" IS NULL OR length(trim(NEW."reviewReason")) < 8 THEN
    RAISE EXCEPTION 'product_image_review_metadata_required';
  END IF;
  SELECT * INTO p FROM "Product" WHERE "id" = NEW."productId";
  SELECT * INTO v FROM "Vendor" WHERE "id" = p."vendorId";
  IF NEW."reviewedByUserId" = NEW."createdByUserId" OR NEW."reviewedByUserId" = p."createdByUserId" OR NEW."reviewedByUserId" = v."ownerUserId" THEN
    RAISE EXCEPTION 'product_image_self_review_denied';
  END IF;
  SELECT * INTO s FROM "StorageObject" WHERE "id" = NEW."storageObjectId";
  IF NEW."state"='APPROVED' AND (s."state" <> 'UPLOADED' OR s."reviewedByUserId" IS DISTINCT FROM NEW."reviewedByUserId") THEN
    RAISE EXCEPTION 'product_image_storage_not_approved';
  END IF;
  IF NEW."state"='REJECTED' AND (s."state" <> 'DELETED' OR s."deletedAt" IS NULL OR s."reviewedByUserId" IS DISTINCT FROM NEW."reviewedByUserId") THEN
    RAISE EXCEPTION 'product_image_storage_not_rejected';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER product_image_update_guard BEFORE UPDATE ON "ProductImage" FOR EACH ROW EXECUTE FUNCTION gs_product_image_update_guard();

-- Extend product update guard for category assignment and pending-image submission gate.
CREATE OR REPLACE FUNCTION gs_product_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "Store"%ROWTYPE; v "Vendor"%ROWTYPE; k "KycCase"%ROWTYPE; c "Category"%ROWTYPE; variant_count INTEGER; pending_images INTEGER;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'catalog_write_privileged_only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."vendorId" IS DISTINCT FROM OLD."vendorId" OR NEW."storeId" IS DISTINCT FROM OLD."storeId" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'product_immutable_fields';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'product_version_conflict'; END IF;

  IF NEW."categoryId" IS DISTINCT FROM OLD."categoryId" THEN
    IF NEW."status" <> 'DRAFT' OR OLD."status" <> 'DRAFT' OR NEW."moderationState" NOT IN ('NOT_SUBMITTED','REJECTED') THEN
      RAISE EXCEPTION 'product_category_locked';
    END IF;
    IF NEW."categoryId" IS NOT NULL THEN
      SELECT * INTO c FROM "Category" WHERE "id" = NEW."categoryId";
      IF NOT FOUND OR c."countryId" <> NEW."countryId" OR c."status" <> 'ACTIVE' THEN RAISE EXCEPTION 'product_category_not_active'; END IF;
    END IF;
    RETURN NEW;
  END IF;

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
      SELECT count(*) INTO pending_images FROM "ProductImage" WHERE "productId"=NEW."id" AND "state"='PENDING_REVIEW';
      IF pending_images > 0 THEN RAISE EXCEPTION 'product_pending_images_required_review'; END IF;
      IF NEW."categoryId" IS NOT NULL THEN
        SELECT * INTO c FROM "Category" WHERE "id" = NEW."categoryId";
        IF c."status" <> 'ACTIVE' OR c."countryId" <> NEW."countryId" OR NOT gs_category_chain_active(c."id") THEN RAISE EXCEPTION 'product_category_not_active'; END IF;
      END IF;
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
      SELECT count(*) INTO pending_images FROM "ProductImage" WHERE "productId"=NEW."id" AND "state"='PENDING_REVIEW';
      IF pending_images > 0 THEN RAISE EXCEPTION 'product_pending_images_required_review'; END IF;
      IF NEW."categoryId" IS NOT NULL THEN
        SELECT * INTO c FROM "Category" WHERE "id" = NEW."categoryId";
        IF c."status" <> 'ACTIVE' OR c."countryId" <> NEW."countryId" OR NOT gs_category_chain_active(c."id") THEN RAISE EXCEPTION 'product_category_not_active'; END IF;
      END IF;
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

-- Product-image storage approvals are privileged, just like KYC approvals.
CREATE OR REPLACE FUNCTION gs_guard_storage_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF gs_is_super() THEN
    RETURN NEW;
  END IF;
  IF NEW."reviewedByUserId" IS DISTINCT FROM OLD."reviewedByUserId"
     OR NEW."reviewedAt" IS DISTINCT FROM OLD."reviewedAt"
     OR NEW."reviewReason" IS DISTINCT FROM OLD."reviewReason" THEN
    RAISE EXCEPTION 'storage_review_fields_privileged_only';
  END IF;
  IF OLD."purpose" IN ('kyc-document','product-image') AND NEW."state" = 'UPLOADED' THEN
    RAISE EXCEPTION 'storage_approval_privileged_only';
  END IF;
  IF OLD."state" = 'QUARANTINED' AND NEW."state" IS DISTINCT FROM OLD."state" THEN
    RAISE EXCEPTION 'storage_quarantine_transition_privileged_only';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON TABLE "Category" IS 'Country-scoped product taxonomy; max depth 3, privileged non-self activation.';
COMMENT ON TABLE "ProductImage" IS 'Product image attachment referencing quarantined product-image storage; independent review required.';
