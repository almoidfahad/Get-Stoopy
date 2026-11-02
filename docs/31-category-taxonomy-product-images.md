# Category taxonomy and product image foundation

Date: 2026-11-02. Scope: step 7c after product moderation/publication and public catalog reads. This slice adds a country-scoped category taxonomy, product category assignment, quarantined product-image uploads, independent product-image review, and fail-closed public category/image reads. It does **not** add inventory reservation, cart, checkout, payments, dispatch, earnings, settlement, payout or production deployment.

## Executable schema additions

Migrations:

- `0018_category_taxonomy_product_images`
- `0019_catalog_content_immutability`

New models:

| Model | Purpose | Important constraints |
|---|---|---|
| `Category` | Country-scoped product taxonomy | Unique `(countryId, slug)`; max depth 3; parent must be same country and active chain; versioned `DRAFT -> ACTIVE -> SUSPENDED -> ACTIVE` lifecycle; privileged non-self activation |
| `ProductImage` | Product image attachment and review state | References a `product-image` storage object; unique storage object; unique `(productId, sortOrder)`; max 8 images; `PENDING_REVIEW -> APPROVED/REJECTED`; independent non-self review |

New enums:

- `CategoryStatus`: `DRAFT`, `ACTIVE`, `SUSPENDED`
- `ProductImageStatus`: `PENDING_REVIEW`, `APPROVED`, `REJECTED`

`Product` gains optional `categoryId`. Existing products are not rewritten. The executable Prisma schema now has **38 models** against the Phase-1 logical design's 113 entities.

Migration `0019` adds content-immutability guards so lifecycle/moderation/review commands cannot smuggle product title/description/brand, category name/description/sort order, or image alt text/sort order edits through privileged transitions.

## Storage behavior

Storage purpose `product-image` is now allowed for PNG/JPEG/WEBP up to 5 MiB. Product-image uploads:

1. require the same magic-byte validation as other storage uploads,
2. become `QUARANTINED`, not immediately downloadable,
3. do not expire automatically while awaiting review (`expiresAt` is cleared on successful upload),
4. can be attached only by the storage owner to a draft product in `NOT_SUBMITTED` or `REJECTED` moderation state,
5. require independent privileged review before public serving.

Magic-byte validation is **not** malware scanning. Production AV/KMS/object-store/CDN policy remains pending.

## Category rules

- Categories are country-scoped; cross-border taxonomy is not shared.
- Slug must be lowercase URL-safe and unique per country.
- Maximum depth is 3.
- A child can be created only under an active parent chain.
- Activation requires `catalog:category:manage`, STEP_UP, country scope and a non-creator actor.
- Suspension does not rewrite products, but public reads fail closed for products assigned to a suspended category chain.
- Public category reads return only active chains.

## Product image rules

- A product may have at most 8 attached images.
- `sortOrder` is bounded to 0–7 and unique per product.
- Alt text is required and bounded to 3–180 characters.
- Attachment is locked once a product leaves editable draft moderation states.
- Pending images block product submission/publication.
- Image review requires `catalog:product-image:review`, STEP_UP, country scope and a non-related reviewer.
- Review approval atomically marks the storage object `UPLOADED` and the image `APPROVED`.
- Review rejection atomically marks the storage object `DELETED` and the image `REJECTED`.
- Public image bytes are served only when the product is publicly eligible and the image/storage object are approved/uploaded.
- Public image responses use `Cache-Control: no-store` in this local foundation; production CDN/cache invalidation policy remains pending.

## API surface

Privileged category commands under `/api/v1/catalog`:

- `POST /admin/categories`
- `GET /admin/categories?countryId=`
- `POST /admin/categories/:id/activate`
- `POST /admin/categories/:id/suspend`

Vendor product commands:

- `POST /products/:id/category`
- `POST /products/:id/images`
- `GET /products/:id/images`

Privileged image review:

- `POST /admin/product-images/:id/review`
- `POST /admin/product-images/:id/review-download-url`

Public reads under `/api/v1/public/catalog`:

- `GET /categories?countryId=`
- `GET /products?countryId=&categoryId=`
- `GET /products/:id/images/:imageId?countryId=`

Public product detail/list now include category and approved image metadata. Image URLs point back through the fail-closed public image endpoint.

## Authorization, audit and events

New permissions:

- `catalog:category:manage`
- `catalog:product-image:review`

`scripts/seed-local.ts` now defines separate `catalog_taxonomy_admin` and `catalog_media_reviewer` roles. The seed script remains idempotent, does not fabricate users or credentials, and was **not executed** in this slice.

Audit/outbox events include:

- `catalog.category.created`
- `catalog.category.activated`
- `catalog.category.suspended`
- `catalog.product.category.assigned`
- `catalog.product-image.attached`
- `catalog.product-image.reviewed`

## Verification

Executed against isolated `getstoopy_foundation_test` only:

- Prisma generate/validate: PASS
- Migrations `0018` and `0019`: applied successfully to isolated test DB
- Grants re-applied: PASS
- Unit tests: **104 tests / 18 files PASS**
- Integration tests: **70 tests / 13 files PASS**
- TypeScript typecheck: PASS
- API build: PASS
- Worker build: PASS
- Design/doc validator: PASS

New integration coverage in `tests/integration/catalog-taxonomy-media.test.ts` verifies:

- bounded country-scoped taxonomy creation and non-self activation,
- public active-chain category reads,
- product-image quarantine, owner download denial before approval, and reviewer download,
- permission/STEP_UP/self-review denial for image review,
- pending-image submission gate,
- approved image serving only for eligible published products,
- invalid upload type/size and non-product storage attachment denial,
- database write guards, content-immutability guards and runtime write denial,
- fail-closed public product/image reads after category suspension.

## Known limitations / next gates

- No inventory, stock reservation, cart or checkout yet.
- Store pickup geometry, operating hours and service-area approval remain pending.
- Store-level membership (`storeId`) is still optional in the core interface and not fully exercised by store-scoped grants.
- Production AV scanning, KMS, object store, CDN and cache invalidation remain pending.
- No production deployment, live payment, paid resource or existing-data migration was performed.
- Dev/prod database migration and `seed-local.ts` execution remain deferred until the pending feature backlog is completed and explicit confirmation/checklists are provided.
