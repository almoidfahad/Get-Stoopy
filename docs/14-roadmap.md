# Development roadmap and acceptance gates

**Status:** Phase 1 approved for development 2026-11-01. Phase 2 in progress with locally tested foundation slices; Phases 3–11 not started. This is not a running marketplace and not production readiness. Current evidence is tracked in `15-progress-and-decisions.md` and `17`–`26` implementation logs.

## Execution rules

Follow the master order. Security, schema constraints, audit, accessibility and tests are introduced with each feature, not postponed to a final “security phase.” A phase may have a reviewable vertical slice before later integrations, but cannot be marked complete until its acceptance gates pass. Missing external credentials produce disabled adapters and documented blockers, never fake live behavior. No production deployment without separate explicit authorization.

| Phase | Deliverables | Exit gate / evidence | Current status |
|---|---|---|---|
| 1 — Discovery & architecture | Source review; normalized master; architecture; logical ERD/dictionary; RBAC/geography; OpenAPI; threat model; finance/KYC/provider policies; roadmap/ADRs | Owner reviews critical decisions and unresolved gates; document/model/contract validation passes; no implementation implied | **Approved for development 2026-11-01** |
| 2 — Foundation | Monorepo; pinned dependencies; design tokens; Docker/CI; PostgreSQL/PostGIS migrations; identity/session/MFA; RBAC/ABAC/RLS; audit/outbox; private storage interface | Migration/rollback and constraint tests; auth/linking/MFA/recovery tests; cross-scope negative tests; accessible shell; CI green | **In progress — local slices tested; production gates pending** |
| 3 — Customer website | Approved homepage; locale; catalog/search/categories/products; cart/wishlist; recipient-first quote/checkout; account/orders/tracking/returns/support | Responsive visual comparison; real DB catalog; remote-order and stock/price tests; no unsupported claims; payment sandbox only when approved | Not started |
| 4 — Vendor | Application/KYC; stores/staff; products/variants/images/stock; accept/reject/prep/manual ready; returns; commission/settlement views; plans | Vendor isolation; KYC/expiry gates; manual-ready test; multi-vendor split; settlement view reconciles; no cross-store leakage | Not started |
| 5 — Rider | KYC/vehicle; shift/consent/location; zones; road-distance offers; 30-second expiry; atomic assignment; pickup/OTP; earnings/COD; Sunday payout interface | Concurrent/expired offer tests; route/rate snapshots; OTP limits; independent COD/earnings; payout reserve/idempotency; mobile/PWA limits documented | Not started |
| 6 — Admin systems | Super/Country/Regional/City/Zone/Local shells; KYC/finance/fraud/geography/security/operations; reports/exports; AI-safe approval surfaces | Every role/scope negative test; no self-scope grant; maker–checker; export/read audit; scoped aggregates/sockets; emergency lock drill | Not started |
| 7 — Payments & finance | Provider adapters; verified callbacks; COD reconciliation; commission/refund/chargeback; vendor settlement; rider payout reconciliation; QR only if approved | Sandbox callback/tamper/replay/refund tests; balanced journals; provider/bank reconciliation; verified destinations; no duplicate money effects; live remains off | Not started |
| 8 — Security & fraud | Harden MFA/KYC/session controls; risk engine/manual review; audit monitoring; upload/export defenses; independent review | Threat-model test coverage; security scans/review; revocation/restore/alert drills; risk acceptance for residual issues | Not started |
| 9 — AI | Consented personalization; search/shopping assistance; vendor drafts/forecasts; rider guidance; scoped admin summaries; human approvals | Consent/delete tests; groundedness/evaluation set; prompt-injection/tool-denial tests; budgets; core works with AI off | Not started |
| 10 — QA | Unit/integration/E2E/API/security/accessibility/performance; realistic pilot load; failure/recovery tests | All required acceptance scenarios pass; defects triaged; measured budgets; no disabled security to pass; evidence linked to requirements | Not started |
| 11 — Deployment preparation | Env template; Docker/CI; deployment/backup/runbooks; user guides; monitoring/WAF; production checklist; handover | Staging rehearsal and restore drill; contracts/credentials/security/legal gates documented; owner authorizes production separately | Not started |

## Critical path

`Approved architecture → foundation/auth/scope → catalog + recipient checkout → vendor split/ready → rider assignment/OTP → immutable earnings/COD → verified payment/payout adapters → scoped admin operations → security/fraud hardening → AI → full QA → deployment rehearsal`

Finance invariants and permission tests begin in Phase 2. Earlier phases may use explicitly labelled test adapters; they cannot claim a real provider integration. The first end-to-end vertical slice should cover a remote gift, two vendors, one rider per suborder, recipient OTP, COD custody and immutable earnings before optional loyalty/AI expansion.

## Final acceptance mapping

| ID | Required outcome | Planned evidence |
|---|---|---|
| ACC-F01 | Register/login/browse/search/order | API + Playwright customer flows, verification/session tests |
| ACC-F02 | Multi-vendor parent/suborder split | DB transaction and vendor-isolation tests |
| ACC-F03 | Vendor accept/prepare/manual ready | State-machine/API/E2E tests; timer cannot auto-ready |
| ACC-F04 | Eligible rider receives/completes delivery | KYC/zone/shift/capacity and concurrent-offer tests |
| ACC-F05 | Recipient OTP | Rate-limit/replay/expiry/wrong-recipient tests |
| ACC-F06 | Admin distance-slab earnings | Boundary/effective-date/snapshot/invariance tests |
| ACC-F07 | Independent COD/earnings reconciliation | Journal, partial/duplicate deposit and allocation tests |
| ACC-F08 | Sunday payout under verified conditions | Asia/Dhaka schedule, destination, reserve, retry/unknown-result tests |
| ACC-F09 | Vendor commission/settlement | Default exclusion of delivery, rounding, partial refund and double-settlement tests |
| ACC-F10 | KYC review/authorization | Document access, self-approval denial, expiry/renewal tests |
| ACC-F11 | Admin TOTP | Enrollment/login/recovery/step-up/revocation tests |
| ACC-F12 | API geographic isolation | SQL/API/report/export/cache/socket negative tests |
| ACC-F13 | Remote ordering | Different buyer/recipient location positive test; destination controls |
| ACC-F14 | Fraud review/audit | Hold/review/appeal and sensitive-read/write audit tests |
| ACC-F15 | Verified/idempotent callbacks | Provider-specific authenticity, server validation, replay/tamper tests |
| ACC-F16 | Approved responsive brand | Desktop/tablet/mobile visual review and accessibility tests |
| ACC-F17 | Automated tests pass | CI report linked to exact commit; no application report exists yet |
| ACC-F18 | Production requirements documented | Runbooks/checklist/restore evidence; deployment still separately approved |

## Deferred by explicit gate, not forgotten

Cross-border checkout, US activation, live payments, central Bangla QR, real disbursement, native wrapper, batching, courier hybrid, loyalty/cashback/referrals and paid AI/maps/notification services remain disabled until their commercial/legal/security prerequisites are satisfied. First-year vendor relief and configurable plans remain in the model; exact prices/volume terms need owner approval.

## Estimate policy

No calendar-day promise is made before repository/provider decisions and pilot load are approved. After Phase 1 approval, estimate each phase from reviewed tasks and update progress with actual evidence. A large feature list is not a reason to skip tests or silently reduce scope.
