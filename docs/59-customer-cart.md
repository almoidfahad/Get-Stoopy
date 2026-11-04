# Customer cart: add, update, remove, with honest totals

Status: **implemented and verified.** Second Phase 3 slice. Checkout and payment remain disabled.

## What was added

| Piece | Purpose |
| --- | --- |
| `/cart` | Session cart: lines, per-line and subtotal figures, availability problems, summary panel |
| `/api/cart/items` | BFF mutation route — `POST` add, `PATCH` quantity, `DELETE` remove |
| `AddToCart` on `/shop/[id]` | Option selector + quantity, signed-out prompt instead of a dead button |
| `packages/core/src/cart-summary.ts` | Independently computed totals, issue detection, mutation validation |

Header navigation now includes Cart.

## Design decisions worth recording

**No cart cookie.** The API enforces a unique cart per `(user, country)` and makes creation
idempotent, so `POST /commerce/carts` is a get-or-create. Storing a cart id in the browser would
add stale-after-logout and cross-user-pickup failure modes for no benefit. The tradeoff is that
opening `/cart` performs an idempotent write; that is acceptable because it creates at most one
row per user per country and is audited only on real creation.

**Version handling is deliberately asymmetric.**

- `add` resolves the current cart version **server-side**, so a product page left open for an hour
  still works.
- `update` / `remove` must carry the version **the buyer actually saw**. A concurrent edit then
  produces `409 CART_VERSION_CONFLICT`, the UI explains it and refreshes — it does **not**
  auto-retry, because re-applying blindly could overwrite an edit made in another tab.

`parseCartMutation` refuses a browser-supplied version on `add` and requires one on the others.

**Totals are recomputed, not trusted.** The API returns a line total, but `summarizeCart`
recomputes every line as unit price × quantity in `bigint` and *flags* a disagreement
(`line-total-mismatch`) instead of silently choosing one. A price that moved mid-session must be
shown to the buyer, not hidden. A malformed or non-positive price yields **no subtotal** rather
than a plausible-looking wrong number, and two currencies are never summed.

**Problems block checkout, visibly.** Unsellable lines, stock below the requested quantity,
out-of-range quantities, mixed currency and more than 50 distinct items each produce a specific
buyer-facing message. `readyForCheckout` is true only when there is at least one line and no
issues.

**Checkout is not faked.** The summary shows the subtotal and explicitly labels delivery and
total "Not calculated yet"; the checkout button is disabled and labelled "Checkout unavailable".
This matches the backend, whose quote response already returns `deliveryFeeMinor: null`,
`totalMinor: null`, `paymentStatus: 'NOT_IMPLEMENTED'`.

## Why checkout is not in this slice

Creating a quote requires a `destinationCityId`, and there is **no public city/serviceability
lookup** — `public/catalog` is the only public controller. Rather than make the buyer paste a
UUID or invent an endpoint, the quote step waits for a proper read-only serviceable-city API.
That is the next slice's dependency, recorded here so it is not forgotten.

## Security

The BFF route adds no authority of its own: it checks same-origin, validates the body, and the
API independently re-checks origin and a session-derived CSRF token. The browser never sees the
CSRF token, the session token or the internal API URL.

A misconfiguration is **not** reported as an attack. During smoke testing, running a production
build with a development cookie name made `webConfig()` throw, and the original code surfaced
that as `ORIGIN_DENIED` — indistinguishable from a real CSRF attempt. The route now returns
`503 CONFIG_INVALID` for configuration failures and reserves `403 ORIGIN_DENIED` for an actual
origin mismatch, because an operator needs to tell those apart.

## Verification

| Gate | Result |
| --- | --- |
| `db:validate` | PASS |
| `typecheck` | PASS |
| unit | **248 tests / 42 files** PASS (was 230/41; +18 new) |
| integration | **148 tests / 26 files** PASS |
| design validator | **10 passed / 0 failed** |
| `build`, `build:vercel` | PASS — `/cart` 108 kB, `/api/cart/items` 103 kB first-load JS |

Runtime smoke test against a production build:

| Scenario | Result |
| --- | --- |
| `/cart`, no session | 200 "Sign in to view your cart" |
| Mutation, no `Origin` | 403 `ORIGIN_DENIED` |
| Mutation, foreign `Origin` | 403 `ORIGIN_DENIED` |
| Mutation, correct origin, no session | 401 `SIGN_IN_REQUIRED` |
| Non-UUID / traversal `variantId` | 400 `VARIANT_ID_INVALID` |
| Quantity 101 | 400 `QUANTITY_INVALID` |
| `PATCH`/`DELETE` without version | 400 `VERSION_INVALID` |
| Malformed JSON | 400 `BODY_INVALID` |
| Valid add, API unreachable | 502 `CART_UNAVAILABLE` |

Unit tests additionally cover bigint precision above 2^53, empty carts, server/client total
disagreement, unsellable and under-stocked lines, invalid prices, mixed currencies, the 50-item
cap, and that every issue kind has buyer-facing copy.

## Not in this slice

Quote creation and release, destination selection, delivery pricing, tax, payment, order
placement, saved-for-later and multi-cart. `MARKET_COUNTRY_ID` remains unset in deployed
environments, so the cart stays in its explicit unconfigured state until a market is approved.