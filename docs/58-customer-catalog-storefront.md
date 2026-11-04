# Customer storefront: public catalog browse and product detail

Status: **implemented and verified.** First Phase 3 slice. Read-only — no cart, checkout or
payment is enabled.

## What was added

| Route | Purpose |
| --- | --- |
| `/shop` | Published-product listing with search, category filter and cursor pagination |
| `/shop/[id]` | Product detail: images, variants, per-variant price and stock, store, description |
| `/api/catalog/products/[id]/images/[imageId]` | Same-origin proxy for approved public images |

`/` and the header navigation now link into the catalog.

The pages are server components reading the existing `public/catalog` API, so there is no new
backend surface and no client-side API credentials. Search and filtering use a plain `GET` form
and links, so the catalog works without JavaScript and every state is a shareable URL.

## Honesty rules built into the UI

**No demo data.** The market is an explicit `MARKET_COUNTRY_ID`. If it is unset, the storefront
renders "Market not configured" instead of inventing a country or seeding fake products. If the
API is unreachable it renders "Catalog unavailable". Neither state fabricates a product.

**No misleading prices.** `summarizeVariantPrices` only lets *orderable* variants (in stock and
`availableToPromise > 0`) set the advertised "from" price, so a cheap out-of-stock variant cannot
bait a buyer. A product with nothing orderable shows "Out of stock", never `0.00`. A malformed
price is skipped or shown as "Price unavailable", never coerced to zero.

**Correct money.** Prices arrive as strings of minor units (Postgres bigint). They are parsed as
`bigint` and formatted by passing an exact decimal *string* to `Intl.NumberFormat`, which:

- keeps precision above 2^53 minor units (verified: `900719925474099335` → `BDT 9,007,199,254,740,993.35`),
- takes the decimal count from the currency, so JPY `1000` is `¥1,000`, not `¥10.00`,
- keeps symbol placement correct in suffix locales (`1.000,35 BDT`) and Bangla (`১,০০০.৩৫৳`).

Intl separates a currency code from the amount with U+00A0 so the figure never wraps alone. That
is the desired output; tests normalise it rather than asserting an invisible codepoint.

**No dead buttons.** Ordering is not enabled, so the detail page says so plainly instead of
showing an "Add to cart" button that cannot work.

## Image proxy security

The browser never learns the internal API URL. The proxy:

- builds the upstream path only from UUID-validated `id`/`imageId` plus the configured country —
  never from a caller-supplied URL, so it is not an SSRF or open-redirect primitive,
- forwards no session cookie for a public asset,
- allowlists `image/jpeg`, `png`, `webp`, `avif` and answers `415` otherwise,
- sets `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and a
  `default-src 'none'; sandbox` CSP on the response.

Query validation (`buildShopQuery`) mirrors the API's own limits — `q` ≤ 120 chars, `limit` 1–50,
UUID category/cursor — and drops anything else, so a hand-edited URL degrades to a clean
unfiltered listing rather than a 400.

## Accessibility and identity

Approved palette only (red accent, charcoal header/footer, white/light-gray surfaces; no green).
Responsive 2/3/4-column grid, `role="search"`, `aria-label` on navigation and cards, `aria-current`
on the active category, `sr-only` labels, visible focus outlines from the existing global style,
and `alt` text falling back to the product title.

## Verification

| Gate | Result |
| --- | --- |
| `db:validate` | PASS |
| `typecheck` | PASS |
| unit | **230 tests / 41 files** PASS (was 211/40; +19 new) |
| integration | **148 tests / 26 files** PASS |
| design validator | **10 passed / 0 failed** |
| `build`, `build:vercel` | PASS — `/shop` and `/shop/[id]` emitted at 106 kB first-load JS |

Runtime smoke test against a production build (`next start`), not just a compile:

| Scenario | Result |
| --- | --- |
| `MARKET_COUNTRY_ID` unset | `/shop` → 200 "Market not configured" |
| Market set, API unreachable | `/shop` → 200 "Catalog unavailable"; detail → "Product unavailable" |
| Non-UUID product id | 404 |
| Image proxy, upstream down | 502 |
| Image proxy, path-traversal id | 404, no upstream call |
| Internal API URL in rendered HTML | absent |

## Not in this slice

Cart, checkout, ordering, reviews, wishlist and personalised ranking. The listing is the API's
existing newest-first cursor order; no ranking or AI is implied. `MARKET_COUNTRY_ID` is still
unset in every deployed environment, so the storefront stays in its explicit unconfigured state
until a real market row is approved.