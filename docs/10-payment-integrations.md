# Payment, QR, payout and integration readiness

**Status:** research and secure interface design only. No merchant account, credential, payment, subscription, cloud resource or live integration exists.

## Non-negotiable capability gate

A payment gateway accepting customer payments does **not** automatically authorize marketplace fund custody, split settlement, rider payouts or vendor disbursement. Obtain the legal entity, acquirer agreement, permitted flow, settlement account ownership, refund/dispute rules, fees, limits, API documentation and sandbox access before enabling any live capability. Never infer eligibility from a logo or an old chat response.

| Capability | Required evidence before live flag | Current state |
|---|---|---|
| SSLCOMMERZ customer checkout | Merchant approval, supported methods, exact validation/refund contract | Adapter designed; not connected |
| aamarPay customer checkout | Merchant approval, signed IPN specification, lookup/refund rules | Adapter designed; not connected |
| shurjoPay customer checkout | Merchant approval, token/verification/refund API contract | Adapter designed; not connected |
| Central Bangla QR | Acquirer-approved marketplace merchant flow, dynamic order QR, reconciliation, refund/dispute terms | Disabled; unverified |
| MFS rider payout | Approved disbursement product, beneficiary verification, limits/fees, callback/reconciliation | Disabled; unverified |
| Bank payout/settlement | Bank contract, file/API format, maker–checker, returns/reversals, statement import | Disabled; unverified |
| Vendor direct QR/acquiring | Contract identifying actual payee and settlement path | Disabled; ledger reconciliation required |
| Google/Facebook/LinkedIn/X OAuth | Approved apps, exact redirect URIs, scopes, provider-specific verification | Not provisioned |
| Apple OAuth (visual reference) | Owner approval + Apple app configuration | Optional; not required by master |
| Google Routes/Matrix | Approved billing project, restricted key, quotas/cost budget, BD route coverage test | Candidate; not provisioned |
| Email/SMS/push/WhatsApp | Approved sender/account, consent/templates, opt-out and cost policy | Not provisioned |
| AI model provider | Data-processing terms, retention policy, budget, scoped tool evaluation | Not provisioned |

## Adapter contract

Each adapter declares capabilities rather than pretending every provider supports every operation: `createCheckout`, `verifyTransaction`, `parseCallback`, `queryStatus`, `refund`, `queryRefund`, `dynamicOrderQR`, `disburse`, `verifyBeneficiary`, `reconcileStatement`. Unsupported operations return a typed capability error and keep the feature disabled.

Server stores provider account, country, merchant reference, encrypted credentials, environment, contract reference and capability version. Checkout creates a unique merchant transaction reference and exact amount/currency before redirect. Callback handler verifies provider authenticity, persists a redacted event, deduplicates, queries/validates provider status and compares merchant/order/amount/currency. Only then posts payment verification and outbox events. Browser return page only displays current server state.

Provider event IDs may be absent: derive a stable dedupe key only after understanding provider semantics; transaction status transitions must not collapse distinct refunds/disputes. Store event hash and provider reference; do not log raw secrets. Out-of-order callbacks cannot regress a verified payment/refund. Unknown results reconcile before retry. Network timeout is not failure or success.

## Provider-specific research notes

**SSLCOMMERZ:** the public v4 documentation says to validate the transaction through the Order Validation API and match stored order, amount, currency and status; IPN/redirect alone is insufficient. It lists validation/query/refund entry points, but the public page reviewed is dated 2019. Current merchant API and refund permissions must be reconfirmed. High gateway risk calls for holding service and verifying the customer. [2](https://developer.sslcommerz.com/doc/v4/)

**aamarPay:** official documentation advertises signed webhook notifications for successfully completed payments and a Search Transaction Details API for additional verification. Obtain the actual signature algorithm, replay window and current sandbox/live endpoints from the merchant contract; do not invent a common HMAC format. Signed-notification support is documented, but split settlement/dynamic QR/payout eligibility is not established. [2](https://aamarpay.readme.io/reference/instant-payment-notification)

**shurjoPay:** official onboarding/developer entry points remain the source for credentials and verification/refund behavior. Public third-party plugin examples are not authoritative evidence of current production API or security. Use TLS verification, short-lived token handling, provider verification and merchant-specific documentation. No claim that a refund or payout API is available until confirmed. Official entry: https://www.shurjopay.com.bd/frontend-developers/frontend-developers-page

Do not copy public sandbox credentials into the repository. Even shared test credentials belong in approved environment configuration; live credentials never appear in docs, screenshots, frontend bundles or source control.

## Bangla QR decision

Preferred historical flow: customer scans a central marketplace order QR; verified payment maps to the exact parent order; backend splits/accounting handles vendor/rider obligations **only if the approved merchant structure permits it**. QR payload must be server-generated for amount/order/expiry where supported. A static personal QR or uploaded screenshot is not proof of payment.

If central collection is not permitted, present an owner-approved alternative: direct vendor acquiring with explicit payee disclosure and separate platform invoicing/reconciliation, or disable QR. Do not silently route customer money through a rider/personal account. Dynamic QR, instant merchant settlement, refund and dispute capabilities require acquirer confirmation. News about a 2026 QR directive was found, but no authoritative circular was verified; it is not used as legal authority.

## Payout and settlement readiness

Rider Sunday automatic payout is the requested business default, not proof of a supported bank rail. If no verified destination or disbursement contract exists, show `PAYOUT_BLOCKED` with reason; preserve earned balance, do not fabricate transfer success. Manual withdrawal and verified bank option use the same financial controls. Provider-specific batch cutoff, holidays, fees, beneficiary names and reversal handling must be documented before activation.

Vendor settlement remains separately configurable and initially maker–checker approved. Reconcile gateway settlement, COD deposits, commission, refunds and bank statements daily. A provider's acceptance of a refund request is not completed refund; track until verified. Preserve chargeback evidence and immutable ledger adjustments.

## Sandbox and live acceptance gates

1. Contract/capability checklist signed by owner and provider; no assumed split/QR/payout support.
2. Sandbox credentials supplied securely; test data labelled `TEST_ONLY`; no real money.
3. Test success/failure/cancel, tampered amount/currency/order, invalid signature, replay, duplicate/out-of-order callback, timeout/unknown, partial/full refund, chargeback and reconciliation.
4. Demonstrate idempotent payout reservation/execution and verified destination change cooldown.
5. Independent security review and owner authorization before live credentials; separate explicit production deployment approval.

No payment screenshot, sample dashboard amount or generated UI state can satisfy these gates.
