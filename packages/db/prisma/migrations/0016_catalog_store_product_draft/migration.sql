-- Store + product/variant draft catalog foundation.
-- Additive only. No public catalog, publication, cart, checkout, inventory reservation or payment.
CREATE TYPE "StoreStatus" AS ENUM ('DRAFT','ACTIVE','SUSPENDED');
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT','PUBLISHED','ARCHIVED');

CREATE TABLE "Store" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "vendorId" UUID NOT NULL,
  "countryId" UUID NOT NULL,
  "cityId" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "slug" VARCHAR(140) NOT NULL,
  "addressLine" VARCHAR(500) NOT NULL,
  "status" "StoreStatus" NOT NULL DEFAULT 'DRAFT',
  "activatedAt" TIMESTAMP(3),
  "activatedByUserId" UUID,
  "suspendedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Store_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Store_vendorId_slug_key" UNIQUE ("vendorId","slug"),
  CONSTRAINT "Store_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "Store_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT "Store_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Store_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Store_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Store_activatedByUserId_fkey" FOREIGN KEY ("activatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Store_countryId_status_idx" ON "Store"("countryId","status");
CREATE INDEX "Store_cityId_status_idx" ON "Store"("cityId","status");

CREATE TABLE "Product" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "vendorId" UUID NOT NULL,
  "storeId" UUID NOT NULL,
  "countryId" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "description" VARCHAR(5000) NOT NULL,
  "brand" VARCHAR(120),
  "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Product_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "Product_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Product_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Product_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Product_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Product_storeId_status_idx" ON "Product"("storeId","status");
CREATE INDEX "Product_vendorId_status_idx" ON "Product"("vendorId","status");
CREATE INDEX "Product_countryId_status_idx" ON "Product"("countryId","status");

CREATE TABLE "ProductVariant" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "productId" UUID NOT NULL,
  "sku" VARCHAR(120) NOT NULL,
  "optionValues" JSONB NOT NULL,
  "priceAmountMinor" BIGINT NOT NULL,
  "compareAtAmountMinor" BIGINT,
  "currency" VARCHAR(3) NOT NULL,
  "weightGrams" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductVariant_productId_sku_key" UNIQUE ("productId","sku"),
  CONSTRAINT "ProductVariant_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "ProductVariant_price_positive" CHECK ("priceAmountMinor" > 0 AND "priceAmountMinor" <= 9007199254740991),
  CONSTRAINT "ProductVariant_compareAt_valid" CHECK ("compareAtAmountMinor" IS NULL OR ("compareAtAmountMinor" >= "priceAmountMinor" AND "compareAtAmountMinor" <= 9007199254740991)),
  CONSTRAINT "ProductVariant_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "ProductVariant_weight_positive" CHECK ("weightGrams" IS NULL OR "weightGrams" > 0),
  CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ProductVariant_productId_active_idx" ON "ProductVariant"("productId","active");

-- Store drafts must match vendor country and city ancestry.
CREATE OR REPLACE FUNCTION gs_store_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v "Vendor"%ROWTYPE; city_country UUID; city_status "AreaStatus";
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'catalog_write_privileged_only'; END IF;
  IF NEW."status" <> 'DRAFT' OR NEW."activatedAt" IS NOT NULL OR NEW."activatedByUserId" IS NOT NULL OR NEW."suspendedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'store_must_start_draft';
  END IF;
  SELECT * INTO v FROM "Vendor" WHERE "id" = NEW."vendorId";
  IF NOT FOUND OR v."countryId" <> NEW."countryId" THEN RAISE EXCEPTION 'store_vendor_country_mismatch'; END IF;
  SELECT r."countryId", c."status" INTO city_country, city_status
    FROM "City" c JOIN "District" d ON d."id"=c."districtId" JOIN "Region" r ON r."id"=d."regionId"
   WHERE c."id" = NEW."cityId";
  IF NOT FOUND OR city_country <> NEW."countryId" THEN RAISE EXCEPTION 'store_city_country_mismatch'; END IF;
  IF city_status <> 'ACTIVE' THEN RAISE EXCEPTION 'store_city_not_active'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER store_insert_guard BEFORE INSERT ON "Store" FOR EACH ROW EXECUTE FUNCTION gs_store_insert_guard();

CREATE OR REPLACE FUNCTION gs_store_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v "Vendor"%ROWTYPE; k "KycCase"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'catalog_write_privileged_only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."vendorId" IS DISTINCT FROM OLD."vendorId" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."cityId" IS DISTINCT FROM OLD."cityId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'store_immutable_fields';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'store_version_conflict'; END IF;
  IF NOT ((OLD."status"='DRAFT' AND NEW."status"='ACTIVE') OR (OLD."status"='ACTIVE' AND NEW."status"='SUSPENDED') OR (OLD."status"='SUSPENDED' AND NEW."status"='ACTIVE')) THEN
    RAISE EXCEPTION 'store_invalid_transition';
  END IF;
  IF NEW."status"='ACTIVE' THEN
    IF NEW."activatedAt" IS NULL OR NEW."activatedByUserId" IS NULL THEN RAISE EXCEPTION 'store_activation_metadata_required'; END IF;
    SELECT * INTO v FROM "Vendor" WHERE "id" = NEW."vendorId";
    IF NEW."activatedByUserId" = v."ownerUserId" THEN RAISE EXCEPTION 'store_self_activation_denied'; END IF;
    IF v."status" <> 'ACTIVE' OR v."kycCaseId" IS NULL THEN RAISE EXCEPTION 'store_vendor_kyc_required'; END IF;
    SELECT * INTO k FROM "KycCase" WHERE "id" = v."kycCaseId";
    IF NOT FOUND OR k."subjectUserId" <> v."ownerUserId" OR k."subjectType" <> 'VENDOR' OR k."countryId" <> v."countryId" OR k."status" <> 'APPROVED' OR k."expiresAt" IS NULL OR k."expiresAt" <= CURRENT_TIMESTAMP THEN
      RAISE EXCEPTION 'store_vendor_kyc_required';
    END IF;
  END IF;
  IF NEW."status"='SUSPENDED' AND NEW."suspendedAt" IS NULL THEN RAISE EXCEPTION 'store_suspendedAt_required'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER store_activation_guard BEFORE UPDATE ON "Store" FOR EACH ROW EXECUTE FUNCTION gs_store_activation_guard();

-- Product drafts require an ACTIVE store and an ACTIVE KYC-eligible vendor.
-- PUBLISHED is intentionally rejected until moderation/publication slice.
CREATE OR REPLACE FUNCTION gs_product_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "Store"%ROWTYPE; v "Vendor"%ROWTYPE; k "KycCase"%ROWTYPE;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'catalog_write_privileged_only'; END IF;
  IF NEW."status" <> 'DRAFT' THEN RAISE EXCEPTION 'product_publication_not_enabled'; END IF;
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
CREATE TRIGGER product_insert_guard BEFORE INSERT ON "Product" FOR EACH ROW EXECUTE FUNCTION gs_product_insert_guard();

CREATE OR REPLACE FUNCTION gs_product_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'catalog_write_privileged_only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."vendorId" IS DISTINCT FROM OLD."vendorId" OR NEW."storeId" IS DISTINCT FROM OLD."storeId" OR NEW."countryId" IS DISTINCT FROM OLD."countryId" OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'product_immutable_fields';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'product_version_conflict'; END IF;
  IF NEW."status" = 'PUBLISHED' THEN RAISE EXCEPTION 'product_publication_not_enabled'; END IF;
  IF NOT ((OLD."status"='DRAFT' AND NEW."status"='ARCHIVED') OR (OLD."status"='PUBLISHED' AND NEW."status"='ARCHIVED')) THEN
    RAISE EXCEPTION 'product_invalid_transition';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER product_update_guard BEFORE UPDATE ON "Product" FOR EACH ROW EXECUTE FUNCTION gs_product_update_guard();

CREATE OR REPLACE FUNCTION gs_product_variant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "Product"%ROWTYPE; expected_currency TEXT;
BEGIN
  IF NOT gs_is_super() THEN RAISE EXCEPTION 'catalog_write_privileged_only'; END IF;
  SELECT * INTO p FROM "Product" WHERE "id" = NEW."productId";
  IF NOT FOUND THEN RAISE EXCEPTION 'variant_product_not_found'; END IF;
  IF p."status" = 'ARCHIVED' THEN RAISE EXCEPTION 'variant_product_archived'; END IF;
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
CREATE TRIGGER product_variant_guard BEFORE INSERT OR UPDATE ON "ProductVariant" FOR EACH ROW EXECUTE FUNCTION gs_product_variant_guard();

ALTER TABLE "Store" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Store" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ProductVariant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductVariant" FORCE ROW LEVEL SECURITY;

-- Runtime reads are limited to unrevoked/unexpired memberships of ACTIVE vendors.
-- Command-level KYC eligibility is revalidated by session resolution and write triggers.
CREATE POLICY store_select_member_or_super ON "Store" FOR SELECT
  USING (gs_is_super() OR EXISTS (
    SELECT 1 FROM "VendorMembership" m JOIN "Vendor" v ON v."id"=m."vendorId"
    WHERE m."vendorId"="Store"."vendorId" AND m."userId"=gs_current_user_id() AND m."revokedAt" IS NULL
      AND (m."expiresAt" IS NULL OR m."expiresAt" > CURRENT_TIMESTAMP) AND v."status"='ACTIVE'
  ));
CREATE POLICY store_insert_super ON "Store" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY store_update_super ON "Store" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

CREATE POLICY product_select_member_or_super ON "Product" FOR SELECT
  USING (gs_is_super() OR EXISTS (
    SELECT 1 FROM "VendorMembership" m JOIN "Vendor" v ON v."id"=m."vendorId"
    WHERE m."vendorId"="Product"."vendorId" AND m."userId"=gs_current_user_id() AND m."revokedAt" IS NULL
      AND (m."expiresAt" IS NULL OR m."expiresAt" > CURRENT_TIMESTAMP) AND v."status"='ACTIVE'
  ));
CREATE POLICY product_insert_super ON "Product" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY product_update_super ON "Product" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

CREATE POLICY variant_select_member_or_super ON "ProductVariant" FOR SELECT
  USING (gs_is_super() OR EXISTS (
    SELECT 1 FROM "Product" p JOIN "VendorMembership" m ON m."vendorId"=p."vendorId" JOIN "Vendor" v ON v."id"=m."vendorId"
    WHERE p."id"="ProductVariant"."productId" AND m."userId"=gs_current_user_id() AND m."revokedAt" IS NULL
      AND (m."expiresAt" IS NULL OR m."expiresAt" > CURRENT_TIMESTAMP) AND v."status"='ACTIVE'
  ));
CREATE POLICY variant_insert_super ON "ProductVariant" FOR INSERT WITH CHECK (gs_is_super());
CREATE POLICY variant_update_super ON "ProductVariant" FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());

COMMENT ON TABLE "Store" IS 'Vendor store foundation; ACTIVE requires privileged non-self activation and ACTIVE KYC-eligible vendor.';
COMMENT ON TABLE "Product" IS 'Draft-only product foundation; PUBLISHED is rejected until moderation/publication slice.';
COMMENT ON TABLE "ProductVariant" IS 'Draft variant price foundation in integer minor units; currency must match product country.';
