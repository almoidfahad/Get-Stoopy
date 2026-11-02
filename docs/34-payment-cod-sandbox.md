# 34 — Order boundary, sandbox payment intents and COD eligibility

Status: **Implemented and verified in the isolated development/test database only (2026-11-02).** This slice adds an immutable order boundary from consumed checkout quotes, vendor/store suborder snapshots, a sandbox/manual payment-intent adapter, signed idempotent webhook verification, and fail-closed country COD policy. **No live payment gateway, real money collection, refund, payout, production credential or deployment exists.**

## 1. Scope

Implemented:

- `Order`: one order per consumed checkout quote, buyer-scoped command idempotency, immutable amount/currency/destination snapshot.
- `VendorSuborder` and `OrderItem`: immutable vendor/store split and line snapshots copied from quote groups/items.
- Atomic order creation: quote reservations are consumed in the same transaction; deferred triggers require all reservations consumed and quote state `CONSUMED`.
- `PaymentIntent`: sandbox/manual only, exact order amount/currency, merchant reference, one active intent per order, explicit terminal states.
- `PaymentWebhookEvent`: redacted, append-only, deduplicated webhook evidence with applied/rejected/ignored-out-of-order outcomes.
- Sandbox HMAC webhook contract with timestamp replay window and constant-time signature comparison.
- `CodPolicy`: country-scoped, disabled by default, maximum order amount, versioned privileged updates.
- Provider capability registry: live SSLCOMMERZ/aamarPay/shurjoPay adapters are present only as disabled capability shells.

Not implemented here:

- Live provider checkout, provider lookup/refund/dispute APIs, Bangla QR, payouts, settlements, rider COD custody/deposit ledgers.
- Delivery fees, taxes, discounts, recipient address privacy, service-area geometry.
- Vendor accept/reject, dispatch, OTP delivery proof, returns/refunds.
- Automatic restock/cancellation after a failed online payment; order cancellation/restock is a later slice.

## 2. Migrations

Applied only to `getstoopy_foundation_test`:

- `0023_quote_consumed_state`: additive `CheckoutQuoteState.CONSUMED` enum value. It is committed separately because PostgreSQL cannot use a new enum value in the same transaction that adds it.
- `0024_order_payment_cod_foundation`:
  - enums for order payment method/status, suborder status, payment provider/environment/intent status and webhook status;
  - tables `Order`, `VendorSuborder`, `OrderItem`, `PaymentIntent`, `PaymentWebhookEvent`, `CodPolicy`;
  - RLS policies, checks, unique keys, partial unique active payment intent per order;
  - order/suborder/item/payment/COD guards;
  - deferred order total/reservation consistency;
  - extended quote lifecycle synchronization for `CONSUMED`.

`scripts/db-grants.sql` was re-run. Runtime role has SELECT-only owner/vendor projections; privileged role has bounded writes. Order items, suborders and webhook events are insert-only; orders/payment intents/webhook events/COD policies cannot be deleted. No applied migration was edited.

## 3. Order boundary

- Input: reserved, unexpired quote owned by the buyer, expected quote version, command key, payment method `SANDBOX_MANUAL` or `COD`.
- Amount is exactly the quote product subtotal. `pricingScope` is `PRODUCT_SUBTOTAL_ONLY`; `deliveryFeeMinor` and `totalMinor` remain `null` because delivery pricing is not implemented.
- Order creation copies quote groups/items into immutable suborders/items and consumes every linked inventory reservation.
- Deferred trigger `gs_order_consistent` enforces at commit:
  - sum(suborder subtotals) = sum(order item line totals) = order amount;
  - every quote reservation is `CONSUMED`;
  - quote state is `CONSUMED`.
- Buyer command key is idempotent; same key with different payload is rejected.
- Foreign buyers receive 404.

## 4. Sandbox payment adapter

- `SANDBOX_MANUAL` is the only enabled provider. It returns `mode: TEST_ONLY`, `redirectUrl: null` and manual webhook instructions. It never contacts a network.
- Live provider shells expose all capabilities as `false`; attempting live checkout/verification throws a typed capability error.
- `PAYMENTS_LIVE_ENABLED=true` is rejected by configuration. `PAYMENTS_SANDBOX_ENABLED=true` requires `PAYMENT_SANDBOX_WEBHOOK_SECRET` and is forbidden when `NODE_ENV=production`.
- Payment intent amount/currency must match the order exactly. One active intent (`CREATED|PENDING|UNKNOWN`) per order is enforced by a partial unique index.
- Intent states: `CREATED|PENDING|UNKNOWN -> VERIFIED|FAILED|CANCELLED|EXPIRED`; terminal states cannot regress.

### Webhook contract

Endpoint: `POST /api/v1/payments/webhooks/sandbox`

Headers:

- `x-gs-timestamp`: Unix seconds, must be within the replay window.
- `x-gs-signature`: hex HMAC-SHA256 of `timestamp + "." + rawBody` using `PAYMENT_SANDBOX_WEBHOOK_SECRET`.

Body fields:

```json
{
  "eventId": "evt-unique-id",
  "merchantReference": "PI-...",
  "providerReference": "optional-sandbox-reference",
  "status": "SUCCEEDED | FAILED | UNKNOWN",
  "amountMinor": "1000",
  "currency": "BDT"
}
```

Verification order:

1. Require sandbox enabled and valid HMAC/timestamp; otherwise 401.
2. Deduplicate by `SANDBOX_MANUAL:eventId`; same event with different payload is a conflict.
3. Lock the payment intent by merchant reference.
4. Compare exact minor-unit amount and ISO currency; mismatches are persisted as `REJECTED`.
5. Ignore late callbacks after terminal intent states as `IGNORED_OUT_OF_ORDER`.
6. Apply `SUCCEEDED -> VERIFIED`, `FAILED -> FAILED`, `UNKNOWN -> UNKNOWN`; update order payment status only for verified/failed.
7. Persist redacted webhook evidence, audit and outbox event in the same transaction.

The browser return page is not payment proof. This sandbox contract is a test harness, not a claim about any live provider's signature algorithm.

## 5. COD eligibility

- `CodPolicy` is country-scoped and disabled by default.
- COD order creation fails closed unless a policy is enabled and the order amount is within `maxOrderMinor`.
- Policy writes require `finance:cod:manage`, recent step-up, and geographic scope over the country.
- Policy updates are versioned; stale versions are rejected.
- COD orders snapshot the policy version/maximum in `codEligibility` and enter `AWAITING_COD`.
- COD is not rider income. No COD custody, deposit, reconciliation or settlement ledger is created in this slice.

## 6. HTTP surface

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/v1/payments/capabilities` | Public | capability registry; live disabled |
| POST | `/api/v1/orders` | Session + CSRF | create order from reserved quote |
| GET | `/api/v1/orders/:orderId` | Session | buyer-only order snapshot |
| POST | `/api/v1/orders/:orderId/payment-intents` | Session + CSRF | sandbox intent creation |
| GET | `/api/v1/payment-intents/:intentId` | Session | owner-only intent state |
| POST | `/api/v1/payments/webhooks/sandbox` | HMAC | public provider callback, no browser CSRF |
| PUT | `/api/v1/admin/cod-policy` | Session + CSRF + permission + step-up + scope | country COD policy |

## 7. Events and audit

Outbox events include:

- `commerce.order.created`
- `payment.intent.created`
- `payment.intent.verified`
- `payment.intent.failed`
- `payment.intent.unknown`
- `checkout.quote.consumed` from reservation lifecycle synchronization

Audit records order creation, intent creation, webhook outcomes and COD policy changes. Webhook payloads are redacted to event/merchant/reference/status/amount/currency; no raw secrets or provider credentials are stored.

## 8. Verification

Executed against the isolated test database and Redis DB 15:

- `npm run db:validate`: PASS
- `npm run db:generate` + `npm run typecheck`: PASS
- `npm run build:api`: PASS
- `npm run build:worker`: PASS
- `npm test`: **117 tests / 21 files PASS**
- `npm run test:integration`: **84 tests / 16 files PASS**
- `python tools/validate_design_artifacts.py`: **10 passed / 0 failed**
- Migrations `0023` and `0024` applied to `getstoopy_foundation_test` only; grants re-run PASS.

New integration coverage (`tests/integration/payments.test.ts`, 4 tests):

1. Disabled live capabilities; immutable order creation consumes quote reservations and blocks foreign reads/snapshot edits.
2. Signed sandbox webhook verification: wrong secret, amount mismatch, currency mismatch, unknown, success, replay, late failure, owner-only intent reads, runtime write denial.
3. COD fail-closed default, scoped step-up policy administration, version conflict, maximum enforcement, COD order snapshot, no online intent for COD.
4. Unsigned/stale webhook rejection and append-only webhook evidence.

## 9. Known limits / next slice

- Failed online payments do not yet automatically cancel/restock orders; cancellation/restock and refund boundaries are pending.
- Live provider adapters require merchant contracts, exact signature/lookup/refund specifications, sandbox credentials and explicit authorization before any live flag.
- Delivery pricing, recipient privacy, dispatch/OTP, rider earnings/COD ledgers, vendor settlement and payouts remain pending.
- No production deployment, paid resource or real payment collection was performed.
