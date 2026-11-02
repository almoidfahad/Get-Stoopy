-- Hardening: catalog content fields are immutable in the current foundation slices.
-- Lifecycle/moderation/review commands must not smuggle content edits through privileged transitions.
CREATE OR REPLACE FUNCTION gs_product_content_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."title" IS DISTINCT FROM OLD."title" OR NEW."description" IS DISTINCT FROM OLD."description" OR NEW."brand" IS DISTINCT FROM OLD."brand" THEN
    RAISE EXCEPTION 'product_content_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER product_content_immutable BEFORE UPDATE ON "Product" FOR EACH ROW EXECUTE FUNCTION gs_product_content_immutable();

CREATE OR REPLACE FUNCTION gs_category_content_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."name" IS DISTINCT FROM OLD."name" OR NEW."description" IS DISTINCT FROM OLD."description" OR NEW."sortOrder" IS DISTINCT FROM OLD."sortOrder" THEN
    RAISE EXCEPTION 'category_content_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER category_content_immutable BEFORE UPDATE ON "Category" FOR EACH ROW EXECUTE FUNCTION gs_category_content_immutable();

CREATE OR REPLACE FUNCTION gs_product_image_content_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."altText" IS DISTINCT FROM OLD."altText" OR NEW."sortOrder" IS DISTINCT FROM OLD."sortOrder" THEN
    RAISE EXCEPTION 'product_image_content_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER product_image_content_immutable BEFORE UPDATE ON "ProductImage" FOR EACH ROW EXECUTE FUNCTION gs_product_image_content_immutable();
