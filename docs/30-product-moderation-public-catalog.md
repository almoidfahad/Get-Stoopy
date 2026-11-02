# Product moderation, publication gate and public catalog read foundation

Date: 2026-11-02. Scope: step 7b after the vendor-side draft catalog foundation. This slice adds an explicit product moderation state machine, privileged non-self review/publication/unpublication, a read-only public catalog/search foundation, and database-level fail-closed eligibility checks. It does **not** add category taxonomy, product images, inventory reservation, cart, checkout, payments, dispatch, earnings, settlement, payout or production deployment.

## Why this slice comes next

A draft catalog is not a marketplace until products can be reviewed and published without allowing a vendor to self-approve, and until public reads cannot expose draft, suspended-store or KYC-ineligible products. This slice therefore gates `PUBLISHED` behind moderation and independent privileged publication, then exposes only eligible published products through public read endpoints.

## Executable schema additions

Migration:

- `0017_product_moderation_publication`

The migration is additive for existing rows: it adds moderation/publication metadata to `Product` and replaces the draft-only product guards. It does not rewrite existing product rows. The executable Prisma schema still has **36 models**; this slice adds one enum and columns/guards, not a new model.

New enum:

- `ProductModerationState`: `NOT_SUBMITTED`, `PENDING_REVIEW`, `APPROVED`, `REJECTED`

New `Product` columns:

| Column | Purpose |
|---|---|
| `moderationState` | Explicit moderation gate; defaults to `NOT_SUBMITTED` |
| `moderationReason` | Required review reason for approve/reject decisions |
| `submittedAt` | Submission timestamp |
| `reviewedAt`, `reviewedByUserId` | Independent reviewer metadata |
| `publishedAt`, `publishedByUserId` | Independent publisher metadata; cleared on unpublication |

New indexes:

- `Product(countryId, moderationState, createdAt)` for scoped moderation queues.
- `Product(countryId, status, createdAt, id)` for public country-scoped catalog reads.

## State machines

Moderation transitions, only while product status is `DRAFT`:

```text
NOT_SUBMITTED -> PENDING_REVIEW
REJECTED      -> PENDING_REVIEW
PENDING_REVIEW -> APPROVED
PENDING_REVIEW -> REJECTED
```

Product lifecycle transitions:

```text
DRAFT     -> PUBLISHED   (requires moderationState=APPROVED)
DRAFT     -> ARCHIVED
PUBLISHED -> DRAFT       (unpublish; publication metadata cleared)
PUBLISHED -> ARCHIVED
```

Database guards enforce:

- moderation transitions cannot change product status,
- publication requires `APPROVED`, publication metadata, an ACTIVE store, an ACTIVE vendor with unexpired APPROVED vendor KYC, and at least one active variant,
- reviewer/publisher cannot be the product creator or vendor owner,
- review requires a reason of at least 8 characters,
- version must increment by exactly one,
- immutable identity fields cannot change,
- published product variants are locked; unpublish before editing,
- runtime role cannot write catalog rows; privileged role cannot delete them.

## API surface

Vendor-side commands remain under `/api/v1/catalog` with session + CSRF guards:

- `POST /products/:id/submit` — vendor membership required; product must be `DRAFT` and `NOT_SUBMITTED` or `REJECTED`; requires active store/vendor KYC and at least one active variant.

Privileged moderation/publication commands:

- `GET /admin/products?countryId=&moderationState=&limit=&cursor=` — requires `catalog:product:review`, STEP_UP and country scope.
- `POST /admin/products/:id/review` — requires `catalog:product:review`, STEP_UP, country scope, non-self, version match and `PENDING_REVIEW`.
- `POST /admin/products/:id/publish` — requires `catalog:product:publish`, STEP_UP, country scope, non-self, version match, `APPROVED` moderation and publishable eligibility.
- `POST /admin/products/:id/unpublish` — requires `catalog:product:publish`, STEP_UP, country scope, version match and `PUBLISHED` status.

Public read-only endpoints under `/api/v1/public/catalog`:

- `GET /products?countryId=&cityId=&q=&limit=&cursor=`
- `GET /products/:id?countryId=`

Public reads require an ACTIVE country. Optional city must be ACTIVE and belong to the country. Search is a bounded case-insensitive title/brand substring filter, not a full-text search engine. Pagination is cursor-based with a maximum page size of 50. Public responses project only catalog-safe fields and active variants.

Public eligibility is fail-closed at read time:

- product status must be `PUBLISHED`,
- store must be `ACTIVE`,
- vendor must be `ACTIVE` with unexpired `APPROVED` vendor KYC,
- country must be `ACTIVE`,
- only active variants are returned.

If a store is suspended or vendor KYC is revoked/expired, previously published products disappear from public reads without requiring a product rewrite.

## Authorization, audit and events

New permissions:

- `catalog:product:review`
- `catalog:product:publish`

`scripts/seed-local.ts` now defines a separate `catalog_product_moderator` role with those permissions. The seed script remains idempotent, does not fabricate users or credentials, and was **not executed** in this slice.

Sensitive commands write audit logs and transactional outbox events:

- `catalog.product.submitted`
- `catalog.product.reviewed`
- `catalog.product.published`
- `catalog.product.unpublished`

Audit actions for review decisions are `catalog.product.approve` and `catalog.product.reject`.

## Verification

Executed against isolated `getstoopy_foundation_test` only:

- Prisma generate/validate: PASS
- Migration `0017`: applied successfully to isolated test DB
- Grants re-applied: PASS
- Unit tests: **101 tests / 17 files PASS**
- Integration tests: **66 tests / 12 files PASS**
- TypeScript typecheck: PASS
- API build: PASS
- Worker build: PASS
- Design/doc validator: PASS

New integration coverage in `tests/integration/catalog-moderation.test.ts` verifies:

- submit → independent review → independent publish → public read → unpublish lifecycle,
- permission, STEP_UP, country-scope, self-review and self-publication denial,
- moderation queue visibility,
- rejection, resubmission, version conflict and active-variant requirement,
- database moderation/publication guards and runtime write denial,
- published variant lock,
- public read fail-closed behavior after store suspension and vendor KYC revocation.

## Known limitations / next gates

- Public search is a bounded database substring filter; ranking, facets, synonyms and dedicated search infrastructure remain pending.
- No category taxonomy or product images in this historical slice. Superseded by `31-category-taxonomy-product-images.md`.
- No inventory, stock reservation, cart or checkout yet.
- Store pickup geometry, operating hours and service-area approval remain pending.
- Store-level membership (`storeId`) is still optional in the core interface and not fully exercised by store-scoped grants.
- No production deployment, live payment, paid resource or existing-data migration was performed.
- Dev/prod database migration and `seed-local.ts` execution remain deferred until the pending feature backlog is completed and explicit confirmation/checklists are provided.
