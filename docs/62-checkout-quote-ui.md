# 62 — Checkout quote UI (reserve stock, no payment)

Slice scope: let a signed-in buyer pick a serviceable delivery city, reserve the
cart's stock as a **quote**, see exactly what the backend knows, and release the
reservation. **No order is placed and no money moves.**

## What was added

| Layer | File | Purpose |
| --- | --- | --- |
| Core | `packages/core/src/checkout-quote.ts` | Quote summary, request parsing, error copy |
| Core | `packages/core/src/browser.ts` | Browser-safe entry (see below) |
| Web | `apps/web/src/lib/serviceability.ts` | Public serviceable-city lookup |
| Web | `apps/web/src/lib/checkout.ts` | Create / read / release a quote |
| Web | `apps/web/src/lib/route-guard.ts` | Shared origin + JSON guards |
| Web | `apps/web/src/app/api/checkout/quotes/route.ts` | `POST` create |
| Web | `apps/web/src/app/api/checkout/quotes/[id]/route.ts` | `GET` read |
| Web | `apps/web/src/app/api/checkout/quotes/[id]/release/route.ts` | `POST` release |
| Web | `apps/web/src/app/checkout/page.tsx` | Checkout screen |
| Web | `apps/web/src/components/checkout-panel.tsx` | City picker, quote panel, release |
| API | `apps/api/src/commerce/commerce.service.ts` | Cart now reports `activeQuoteId` |

The cart page's dead "Checkout unavailable" button became a real
**Continue to checkout** link, enabled only when `summarizeCart` reports the cart
ready. Payment remains a disabled, explicitly labelled control.

## Honesty rules enforced in the UI

The quote API returns `deliveryFeeMinor: null`, `totalMinor: null` and
`paymentStatus: 'NOT_IMPLEMENTED'`. The summary exposes `totalsImplemented` and
`paymentImplemented`, and the screen renders **"Not implemented"** for delivery
and total rather than passing the subtotal off as a grand total. There is no
"Pay" button and no order endpoint is called.

Money stays bigint. The summary independently recomputes every line
(`unit × quantity`), each store subtotal and the quote subtotal, and *flags*
disagreement (`line-total-mismatch`, `group-subtotal-mismatch`,
`subtotal-mismatch`, `currency-mismatch`, `price-invalid`) instead of silently
choosing a number. Mixed currencies are never summed.

## Two real problems found and fixed

**1. A reloaded page stranded reserved stock.** `createQuote` rejects a second
reservation with `CHECKOUT_QUOTE_ALREADY_RESERVED`, but nothing exposed the
existing quote's id, and `cartJson` did not mention quotes. A buyer who reloaded
checkout therefore had no way to find or release the stock they were holding
until it expired.

The first attempt added `quoteId` to the error payload; the integration test
proved it never arrived, because the global exception filter deliberately emits
only `{code, message, requestId}`. That filter is a good security property and was
**not** weakened. Instead the cart resource now carries `activeQuoteId`, the
checkout page loads that quote server-side, and the panel shows it with a release
button. The test asserts the error body still has exactly the three allowed keys.

**2. The client bundle pulled in `node:crypto`.** Importing `@getstoopy/core` from
a client component reached `payment.js` and broke the Next.js build. Rather than
duplicating logic, `packages/core` gained an `exports` map with a `./browser`
entry that re-exports only pure modules. `packages/core/test/browser-entry.test.ts`
walks that entry's transitive imports and fails if any Node builtin or server-only
module creeps in.

## Security posture

- The browser never sees the API URL, the session cookie or the CSRF token;
  `cartFetch` attaches them server-side.
- Mutation routes check `Origin` (403 `ORIGIN_DENIED`), distinguish a broken
  deployment (503 `CONFIG_INVALID`), and the API re-checks session, origin and
  CSRF.
- Idempotency: the browser generates an `attemptId`; the server derives
  `commandKey = web-<attemptId>`, so a client cannot pick an arbitrary idempotency
  namespace and a double click cannot reserve twice.
- The release **reason is fixed server-side** (`QUOTE_RELEASE_REASON`) because it
  is written to the audit log and inventory history; a client-supplied reason is
  ignored.
- Quote ownership is enforced by the API. A non-UUID id is rejected before any
  upstream call.

## Verification

Local gates: `db:validate`, `typecheck`, unit **277 tests / 44 files**,
integration **158 tests / 26 files**, design **10 passed / 0 failed**,
`build` and `build:vercel` (production) all pass.

Runtime smoke against a production build (`next start`, market configured):

| Request | Observed |
| --- | --- |
| `/checkout`, no session | "Sign in to check out" |
| `/checkout`, session cookie, API down | "Checkout unavailable" |
| `POST /api/checkout/quotes`, no Origin | `403 ORIGIN_DENIED` |
| same, foreign Origin | `403 ORIGIN_DENIED` |
| same-origin, malformed destination | `400 DESTINATION_INVALID` |
| same-origin, malformed JSON | `400 BODY_INVALID` |
| same-origin, valid body, no session | `401 SIGN_IN_REQUIRED` |
| same-origin, session cookie, API down | `502 QUOTE_UNAVAILABLE` |
| `GET /api/checkout/quotes/not-a-uuid` | `404 CHECKOUT_QUOTE_NOT_FOUND` |
| release with `version: 0` | `400 VERSION_INVALID` |

## Still not implemented

Order placement, payment, delivery fees, taxes, addresses beyond city, and the
order-confirmation flow. The quote expires and can be released; it never becomes
an order in this slice. No Playwright/E2E coverage exists yet for this screen —
the checks above are unit, integration and HTTP smoke only.

## Follow-up fix and deployment record

A review of the panel found a state bug in the recovery path: `useState(initialQuote)`
only reads its argument on first render, so when a refresh surfaced a quote the tab
had not created, the panel ignored it — defeating the very recovery it was added
for. An effect now adopts a non-null `initialQuote`, while refusing to wipe a quote
the tab is already showing or to move back to an older version of the same quote.
This is client-only logic and is **not** covered by an automated test; it is
recorded here as a known coverage gap alongside the missing E2E suite.

CI run `41830398692` for `5d2f3a0` is **success**. Preview-only deployments of that
commit, both `ready_state: READY` with `target: null`:

| Project | Deployment |
| --- | --- |
| `get-stoopy` | `dpl_CDqgNLS75UiA6FcBB7V8et4mrYEs` |
| `getstoopy` | `dpl_HthUBPpfNfjWeXfTSTq2AGnEaX2x` |

Production aliases `get-stoopy.vercel.app` and `getstoopy.vercel.app` were
re-checked and both return **404**. Preview URLs return `302` to Vercel SSO, so
readiness was confirmed through the deployment API rather than by HTTP status.
