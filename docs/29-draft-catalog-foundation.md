# Store and draft catalog foundation

Date: 2026-11-02. Scope: first executable catalog slice after vendor/rider party activation. This slice adds vendor stores, draft products and draft variants with vendor-membership authorization, KYC-gated vendor eligibility, privileged store activation/suspension, RLS, audit and outbox. It does **not** add public catalog/search, product publication/moderation, cart, checkout, inventory reservation, payments, dispatch, earnings, settlement or payout.

## Why this slice comes next

Commerce writes need a store/product anchor that cannot be created or mutated by an unapproved vendor. The previous party slice resolved vendor memberships only for ACTIVE KYC-eligible vendors. This slice uses that session context and adds database-level guards so draft catalog writes fail closed when vendor eligibility, store state, country/city ancestry or membership is invalid.

## Executable schema additions

Migration:

- `0016_catalog_store_product_draft`

New models:

| Model | Purpose | Important constraints |
|---|---|---|
| `Store` | Vendor store/pickup anchor | Unique `(vendorId, slug)`; country must match vendor; city ancestry must match country and be ACTIVE; versioned `DRAFT -> ACTIVE -> SUSPENDED -> ACTIVE` lifecycle |
| `Product` | Draft product foundation | Must belong to vendor/store/country consistently; store must be ACTIVE; vendor must be ACTIVE with unexpired approved KYC; `PUBLISHED` is rejected in this slice |
| `ProductVariant` | Draft variant price foundation | Unique `(productId, sku)`; positive safe integer minor-unit price; optional compare-at price >= price; currency must match product country; archived products reject new variants |

New enums:

- `StoreStatus`: `DRAFT`, `ACTIVE`, `SUSPENDED`
- `ProductStatus`: `DRAFT`, `PUBLISHED`, `ARCHIVED` (publication intentionally disabled by guard)

The executable Prisma schema now has **36 models** against the Phase-1 logical design's 113 entities.

## Authorization and eligibility

Catalog writes use the vendor-scoped permission `vendor:catalog:write`, which is resolved only from unrevoked/unexpired memberships of ACTIVE KYC-eligible vendors. OWNER and MANAGER memberships have this permission; STAFF does not.

Store activation/suspension uses separate privileged permissions:

- `catalog:store:activate`
- `catalog:store:suspend`

These require recent `STEP_UP`, country scope and non-self activation for the vendor owner. Store activation also revalidates that the vendor is ACTIVE and has an unexpired approved vendor KYC case.

Database triggers enforce core rules independently of the API:

- `gs_store_insert_guard`: store drafts must match vendor country and ACTIVE city ancestry.
- `gs_store_activation_guard`: privileged-only, versioned, non-self, KYC-gated store transitions.
- `gs_product_insert_guard`: product drafts require an ACTIVE store and ACTIVE KYC-eligible vendor; `PUBLISHED` is rejected.
- `gs_product_update_guard`: immutable product identity/store/country/creator; versioned archive transition; `PUBLISHED` rejected.
- `gs_product_variant_guard`: product must exist and not be archived; currency must match country; immutable product/SKU/currency; versioned updates.

Runtime role has `SELECT` only on catalog tables. Privileged role has `SELECT/INSERT/UPDATE` but no `DELETE`. RLS is forced. Runtime reads are limited to unrevoked/unexpired memberships of ACTIVE vendors; command-level KYC eligibility is revalidated by session resolution and write triggers.

## Implemented API surface

All writes require session + CSRF/Origin.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/catalog/stores` | Create own vendor store draft; idempotent per vendor/slug/payload |
| GET | `/api/v1/catalog/stores?vendorId=...` | List own vendor stores through runtime RLS |
| POST | `/api/v1/catalog/admin/stores/:id/activate` | Privileged non-self store activation |
| POST | `/api/v1/catalog/admin/stores/:id/suspend` | Privileged store suspension |
| POST | `/api/v1/catalog/stores/:storeId/products` | Create draft product under ACTIVE store |
| GET | `/api/v1/catalog/stores/:storeId/products` | List store products through runtime RLS |
| POST | `/api/v1/catalog/products/:id/archive` | Archive draft product |
| POST | `/api/v1/catalog/products/:id/variants` | Create draft variant with integer minor-unit price |
| GET | `/api/v1/catalog/products/:id/variants` | List product variants through runtime RLS |

Sensitive commands write append-only audit records and transactional outbox events:

- `catalog.store.created`, `catalog.store.activated`, `catalog.store.suspended`
- `catalog.product.created`, `catalog.product.archived`
- `catalog.variant.created`

Outbox payloads use `schemaVersion: 1`, stable event keys and country anchors. No public search/index, notification, payment or dispatch side effect is claimed.

## Seed and grants

`scripts/db-grants.sql` grants runtime SELECT-only catalog access, privileged SELECT/INSERT/UPDATE without DELETE, and EXECUTE on the new guard functions.

`scripts/seed-local.ts` now defines a separate `catalog_store_admin` role with:

- `catalog:store:activate`
- `catalog:store:suspend`

The seed script remains idempotent and does not fabricate users or credentials. It was **not executed** in this slice.

## Verification

Executed against isolated `getstoopy_foundation_test` only:

- Prisma format/generate/validate: PASS
- Migration `0016`: applied successfully to isolated test DB
- Grants re-applied: PASS
- Unit tests: **101 tests / 17 files PASS**
- Integration tests: **62 tests / 11 files PASS**
- TypeScript typecheck: PASS
- API build: PASS
- Worker build: PASS
- Design/doc validator: PASS

New integration coverage in `tests/integration/catalog.test.ts` verifies:

- store draft idempotency, slug conflict and city-country mismatch denial,
- vendor-membership requirement for store/product writes,
- permission/step-up/country-scope/self-activation denial for store activation,
- product draft denial before store activation and after store suspension,
- variant price/currency/SKU rules and archived-product denial,
- runtime RLS isolation for stores/products/variants,
- database denial of direct `PUBLISHED` transition and privileged DELETE,
- fail-closed catalog writes after vendor KYC revocation or membership revocation.

## Known limitations / next gates

- No public catalog/search/read API yet; this is vendor-side draft catalog only.
- No product moderation/publication workflow yet; `PUBLISHED` is intentionally rejected.
- No category taxonomy, product images, inventory, reservation, cart or checkout yet.
- Store pickup geometry, operating hours and service-area approval remain pending.
- Store-level membership (`storeId`) is still optional in the core interface and not resolved from a store table.
- No production deployment, live payment, paid resource or existing-data migration was performed.
