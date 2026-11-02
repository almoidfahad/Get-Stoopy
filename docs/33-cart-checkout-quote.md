# 33 — Cart and checkout quote orchestration

Status: **Implemented and verified in the isolated development/test database only (2026-11-02).** This slice adds authenticated carts, server-priced checkout quotes, atomic multi-vendor stock reservation, vendor/store split snapshots, quote release and expiry synchronization. It does **not** create orders, collect payments, calculate delivery fees, or deploy anything.

## 1. Scope

Implemented:

- `Cart`: one authenticated cart per user/country, server-derived currency, optimistic version.
- `CartItem`: bounded quantity, ancestry/sellability guards, version-bumping mutations.
- `CheckoutQuote`: immutable priced snapshot with idempotent command key, cart-version binding, destination city, TTL and explicit terminal states.
- `CheckoutQuoteGroup`: vendor/store subtotal split for future suborder creation.
- `CheckoutQuoteItem`: immutable line snapshot linked 1:1 to an `InventoryReservation`.
- Atomic quote creation: all cart lines are reserved in one database transaction; any failure rolls back every reservation, movement, audit row and outbox event.
- Quote release: closes the quote and releases every linked reservation in one transaction.
- Expiry synchronization: when the inventory expiry worker closes the last active reservation of a quote, the quote becomes `EXPIRED` in the same transaction.
- Deferred database invariants for quote totals, group totals and reservation/quote state consistency.

Not implemented here:

- Order/parent-suborder persistence, vendor accept/reject, dispatch, rider assignment, OTP delivery proof.
- Payment/COD adapters, webhooks, refunds, settlements, payouts.
- Address book, recipient privacy, delivery fee/ETA/service-area geometry, store pickup hours.
- Guest carts, cart merge, coupons, taxes, recommendations.

## 2. Migration

Applied only to `getstoopy_foundation_test`:

- `0022_cart_checkout_quote_foundation`
  - enum `CheckoutQuoteState`;
  - tables `Cart`, `CartItem`, `CheckoutQuote`, `CheckoutQuoteGroup`, `CheckoutQuoteItem`;
  - checks, unique keys, partial unique reserved quote per cart version, indexes and foreign keys;
  - RLS policies and least-privilege grants;
  - cart/quote insert/update guards, append-only quote snapshot guards;
  - deferred constraint trigger `gs_checkout_quote_consistent`;
  - reservation-to-quote lifecycle synchronization trigger `gs_checkout_quote_sync_on_reservation`.

`scripts/db-grants.sql` was re-run after migration. Runtime role has SELECT-only on commerce tables; privileged role has bounded writes. Quote groups/items are insert-only; carts/quotes cannot be deleted. No applied migration was edited.

## 3. Invariants and state machines

### Cart

- Unique `(userId, countryId)`.
- Currency must equal the active country currency.
- Item quantity `1..100`; maximum 50 distinct variants per cart.
- Item ancestry must match variant → product → store/vendor/country and cart country.
- Items must be sellable at mutation time: active variant, PUBLISHED product, ACTIVE store/country, vendor KYC eligibility, active category chain if assigned.
- Every item insert/update/delete bumps `Cart.version` by exactly one.
- Client-supplied totals are never accepted.

### CheckoutQuote

- Unique `(userId, commandKey)`; payload hash detects key reuse with different input.
- Bound to `cartId` and `cartVersion`; stale cart versions are rejected.
- At most one `RESERVED` quote per cart version and at most five active quotes per user.
- TTL `60..900` seconds; default 900.
- States: `RESERVED -> RELEASED | EXPIRED` (terminal).
- Subtotal is computed server-side from current variant prices using exact `bigint` arithmetic.
- Destination city must be active and in the same country; cross-border remains disabled.
- `deliveryFeeMinor` and `totalMinor` are intentionally `null`; `paymentStatus` is `NOT_IMPLEMENTED`.

### Quote groups/items

- Group unique `(quoteId, vendorId, storeId)`.
- Item unique `(quoteId, variantId)` and unique `reservationId`.
- Item price/title/SKU snapshots must match the catalog at quote creation.
- Deferred triggers enforce:
  - quote subtotal = sum(item line totals) = sum(group subtotals);
  - each group subtotal = sum(its item line totals);
  - reserved quotes have only ACTIVE reservations;
  - terminal quotes have no ACTIVE reservations.

## 4. Authorization

- All commerce HTTP routes require an authenticated session and CSRF/origin checks on writes.
- Owners can read/write only their own carts/quotes; foreign resources return 404.
- Runtime database role cannot write commerce tables.
- Privileged service commands set RLS context and still enforce ownership in queries.
- No admin override is exposed for customer carts/quotes in this slice.

## 5. HTTP surface

Base path: `/api/v1/commerce`.

| Method | Path | Notes |
|---|---|---|
| POST | `/carts` | `{ countryId }`; idempotent get-or-create |
| GET | `/carts/:cartId` | owner-only cart with current price/availability projection |
| POST | `/carts/:cartId/items` | `{ variantId, quantity, expectedVersion }` |
| PATCH | `/carts/:cartId/items/:variantId` | `{ quantity, expectedVersion }` |
| DELETE | `/carts/:cartId/items/:variantId?expectedVersion=` | owner-only removal |
| POST | `/carts/:cartId/quotes` | `{ expectedVersion, destinationCityId, commandKey, ttlSeconds? }` |
| GET | `/quotes/:quoteId` | owner-only quote snapshot |
| POST | `/quotes/:quoteId/release` | `{ version, reason }`; idempotent terminal replay |

Quote responses include `groups`, `items`, `subtotalMinor`, `expiresAt`, `state`, and explicit null delivery/total fields. They do not imply that an order or payment exists.

## 6. Events and audit

Outbox events (schemaVersion 1, country-scoped):

- `commerce.cart.created`
- `commerce.cart.item.added`
- `commerce.cart.item.updated`
- `commerce.cart.item.removed`
- `commerce.checkout.quote.created`
- `commerce.checkout.quote.released`
- `checkout.quote.expired` / `checkout.quote.released` from reservation lifecycle synchronization

Audit actions mirror the same verbs. Event payloads contain IDs, versions and amounts only; no payment data or identity documents.

## 7. Verification

Executed against the isolated test database and Redis DB 15:

- `npm run db:validate`: PASS
- `npm run db:generate` + `npm run typecheck`: PASS
- `npm run build:api`: PASS
- `npm run build:worker`: PASS
- `npm test`: **113 tests / 20 files PASS**
- `npm run test:integration`: **80 tests / 15 files PASS**
- `python tools/validate_design_artifacts.py`: **10 passed / 0 failed**
- Migration `0022` applied to `getstoopy_foundation_test` only; grants re-run PASS.

New integration coverage (`tests/integration/commerce.test.ts`, 5 tests):

1. Owner-scoped carts, idempotent creation, version conflicts, quantity bounds, draft-product sellability denial.
2. Atomic multi-vendor quote, immutable snapshots, vendor/store subtotals, idempotency, owner isolation, release.
3. Full rollback when any cart line has insufficient stock.
4. Worker expiry closes quote reservations and the quote exactly once.
5. RLS write denial, cross-owner read denial, append-only snapshot denial, deferred total/empty-quote consistency.

## 8. Known limits / next slice

- Checkout currently stops at a reserved quote. The next finance slice must add order persistence and verified payment/COD adapters before any money movement.
- Delivery fees, ETA, service-area geometry and recipient address privacy remain pending.
- Quote availability is not a final order guarantee until order creation consumes reservations atomically.
- Expiry worker remains opt-in via `INVENTORY_EXPIRY_ENABLED`; production scheduling/monitoring is not configured.
