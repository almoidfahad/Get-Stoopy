# REST API, event and realtime architecture

**Status:** versioned contract proposal; no API server exists. Machine-readable draft: `../contracts/openapi.yaml` (also JSON). OpenAPI validation checks a document, not endpoint behavior.

## Contract rules

- Base path `/api/v1`; JSON UTF-8; REST resource nouns and explicit command subresources for business transitions. No client-selected database table or arbitrary SQL filter.
- Browser uses same-origin BFF/session cookie. CSRF token and Origin validation on cookie-authenticated mutations. Provider callbacks have a separate adapter verification contract, not the customer cookie.
- Server derives actor, role, vendor membership, country and geographic scope. Request `adminScopeId` is a selection within existing grants, never an expansion. Ignore/reject unknown privileged fields.
- `Idempotency-Key` required for checkout, order transitions, rider acceptance, pickup/delivery, financial commands, payout requests, uploads and other replay-sensitive writes. Key scope = actor + operation; identical replay returns original result, different payload returns 409. Financial dedupe persists with linked records, not only a short Redis TTL.
- Optimistic `version` / `If-Match` for mutable inventory, rules, profile and order commands; database locks still enforce invariants.
- Cursor pagination default 20/max 100; `limit`, opaque `cursor`, validated sort and filters; response `items`, `nextCursor`. No unlimited export through list endpoints.
- Money: `{amountMinor: integer, currency: ISO4217}`; display formatting is presentation only. Distance integer meters; timestamps UTC RFC3339; country timezone supplied separately.
- Stable errors: `{code, message, requestId, details?, retryAfterSeconds?}`. 401 unauthenticated, 403 no permission/scope, 404 hidden/nonexistent resource under approved disclosure policy, 409 state/version/idempotency conflict, 422 domain validation, 429 rate limited. Do not expose SQL, stack traces, KYC numbers or tokens.
- OpenAPI lists permission/scope metadata and planned phases. Public endpoint does not imply all underlying records are public.

## Representative resource map

| Area | Endpoints / command families | Guard and scope |
|---|---|---|
| Session | authorize/callback, logout, sessions/devices, verification, linking, step-up | OIDC state/PKCE/nonce; provider issuer+subject; session/CSRF checks |
| Customer | profile, address book, privacy/consents, wishlist, cart | Own customer account; no buyer-city access to other accounts |
| Catalog | categories, products, variants, availability, search | Public only approved country/zone catalog; owner/moderator writes |
| Checkout | recipient validation, quote, order creation, payment intent | Recipient destination country/zone; server prices/inventory/risk |
| Customer orders | list/detail, tracking, cancellation, return, support | Buyer ownership; signed tracking minimized/expiring; support scope |
| Vendor | onboarding/KYC, stores, products/stock, suborders, prep/ready | Vendor membership + store; current vendor KYC; own suborders only |
| Rider | onboarding/KYC, vehicle, shift, location, offers, accept/reject | Own rider, active KYC/shift/consent, valid zone/capacity |
| Delivery | assignment, pickup, transit, OTP issue/verify, failure | Active assignment or authorized dispatch scope; separate recipient proof |
| Finance | wallet/ledger, COD deposit, payout destinations/requests, vendor settlement | Owner or explicit financial grant; maker–checker + step-up |
| Admin | geography, admin invites/scopes, KYC, rates/commission, orders, finance, fraud, audit, reports/export | Explicit permission ∩ assigned scope ∩ assurance; no self-scope grants |
| AI | scoped assistant, reports, approvals | Caller∩agent scope; allowlisted read tools; no prohibited execution |
| Platform | notification preferences, capabilities/flags, health | Public capability metadata contains no secrets; sensitive flags admin-only |

## Key command contracts

### Checkout

`POST /checkout/quotes` takes cart version, recipient address/contact, delivery mode and optional buyer-location evidence with consent. Response contains per-vendor/store group availability, item snapshots, price breakdown, delivery/ETA, policy/quote versions, hash and expiry. A quote is not an order or stock guarantee after expiry.

`POST /orders` takes quote ID/hash, idempotency key, payment method and consent references. Revalidate destination, vendor eligibility, stock, quote expiry and fraud status. Return authoritative order references and next action. Never accept client total/commission/rider pay. Prepaid fulfillment waits for server-verified payment. A pending provider result is not a paid order.

### Vendor fulfillment

`POST /vendor/suborders/{id}/accept`, `/reject`, `/preparation-time`, `/ready` require ownership, allowed current state and version. Ready is a manual command with actor/time; preparation countdown cannot invoke it. Reject/cancel triggers the parent partial-state/refund workflow, not deletion.

### Dispatch

Eligible rider receives only authorized offer metadata. `POST /rider/offers/{id}/accept` uses database time, token/ownership/expiry and locks; `409 OFFER_EXPIRED` or `ALREADY_ASSIGNED` cannot be repaired client-side. Socket/push events carry IDs/version, not secret assignment authority. `GET /rider/offers` reconciles missed events.

Recipient OTP issuance goes to the verified recipient contact through a rate-limited channel. The rider submits the code but cannot choose the destination phone or read the hash. Buyer access alone does not prove they are the recipient. Exceptions require separate approval, evidence and audit.

### Finance

`POST /rider/cod-deposits` submits evidence; it does not post verified funds. An authorized finance command verifies trusted bank/merchant/office evidence and posts the balanced deposit once. `POST /rider/payouts` creates a request/reservation only after eligibility checks. Approved execution is a worker/provider operation, never an AI or frontend “success” toggle.

Ledger read responses show opening balance, immutable entries, reversals, pending/reserved/paid amounts, COD due and withdrawable calculation. No `PATCH /ledger` or generic “set balance” endpoint exists.

## Event architecture

Transactional outbox records are committed with business changes. Workers use inbox receipts and domain idempotency; at-least-once delivery is expected, exactly-once business effects are enforced by constraints. Envelope:

```json
{
  "schemaVersion": 1,
  "eventKey": "opaque-unique-id",
  "eventType": "delivery.completed",
  "occurredAt": "2026-11-01T00:00:00Z",
  "countryId": "opaque-country-id",
  "scopeRefs": ["opaque-zone-id"],
  "aggregateType": "Delivery",
  "aggregateId": "opaque-delivery-id",
  "aggregateVersion": 7,
  "correlationId": "request-id",
  "causationId": "previous-event-id",
  "data": {"status": "COMPLETED"}
}
```

The example is illustrative, not a production record. Do not put raw NID, OTP, credentials or full bank data in events. Consumers re-read through guarded services when needed. Events include `order.created`, `payment.verified`, `vendor.suborder.ready`, `delivery.offer.expired`, `delivery.assigned`, `delivery.completed`, `cod.deposit.verified`, `payout.status.changed`, `kyc.status.changed`, `scope.revoked`, `inventory.changed`.

Socket rooms: `user:{id}`, `vendor-store:{id}`, `rider:{id}`, `delivery:{id}`, `admin-scope:{grantId}`. Join authorization runs server-side on connect and sensitive subscription; revoke rooms when scope/session changes. Customer location views use assignment-specific expiring tokens. Clients fetch state after reconnect; stale events cannot regress state.

## API security/performance gates

Contract lint; generated types; request/response validation; negative RBAC/ABAC tests; concurrent idempotency tests; webhook replay; OTP/TOTP/session tests; pagination/filter bounds; query-plan budgets; rate-limit tests; no sensitive cache keys. No OpenAPI “Try it out” request in this review package reaches a backend or provider. Production CORS is an explicit allowlist; no wildcard credentialed access. Public API versioning is additive; breaking changes require a new version/migration plan.
