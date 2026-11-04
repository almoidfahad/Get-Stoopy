# Progress, decisions and review blockers

Last updated: 2026-11-03.

## Actual progress

- Repository/workspace inspected: no application or Git repository found.
- Six current reference images inspected and inventoried; hashes recorded.
- Public conversation recovered: 460 visible messages; all 209 user messages and 251 assistant replies reviewed. Unavailable artifacts disclosed.
- Normalized master and Bengali instruction saved; atomic requirement register generated.
- Architecture, logical data model/dictionary/ERD, permission/geographic policy, API contract, threat model, finance/delivery, KYC, payment readiness, AI/privacy and roadmap prepared for review.
- Documentation artifacts pass 10/10 document/contract checks; see `16-validation-report.md`. No application tests have run.
- **Phase-2 first foundation slice now exists:** TypeScript core/auth/config/observability packages, brand tokens, Prisma foundation schema/migration, Docker/CI templates and 58 passing unit tests. No running marketplace backend, live integration, paid resource or production deployment exists. See `17-phase2-foundation.md`.
- **Phase 1 architecture approved by owner on 2026-11-01 for development only, including the proposed Keycloak identity model. Phase 2 started. Paid resources, live payment collection and production deployment remain unauthorized. Phases 3–11 not started.**
- **2026-11-02 foundation audit:** executable schema has 23 Prisma models vs 113 logical design entities; commerce/finance/KYC/delivery domains are not implemented. Dependency-ordered plan recorded in `22-foundation-audit-and-plan.md`.
- **2026-11-02 first hardening slice:** outbox visibility lease + stale-worker fencing implemented (`0008_outbox_visibility_lease`). Applied only to isolated local test DB. Local verification: 79 unit tests / 11 files PASS; 34 integration tests / 6 files PASS; typecheck and Prisma validation PASS. See `23-outbox-visibility-lease.md`.
- **2026-11-02 second hardening slice:** terminal inbox dead-letter persistence implemented (`0009_inbox_dead_letter`). Applied only to isolated local test DB. Local verification: 82 unit tests / 12 files PASS; 38 integration tests / 7 files PASS; typecheck and Prisma validation PASS. See `24-inbox-dead-letter.md`.
- **2026-11-02 third hardening slice:** storage magic-byte validation + KYC quarantine/review implemented (`0010_storage_review`). Applied only to isolated local test DB. Local verification: 84 unit tests / 13 files PASS; 39 integration tests / 7 files PASS; typecheck and Prisma validation PASS. See `25-storage-quarantine-review.md`.
- **2026-11-02 fourth hardening slice:** immutable double-entry ledger persistence primitives implemented (`0011_ledger_primitives`). Applied only to isolated local test DB. Local verification: 88 unit tests / 14 files PASS; 45 integration tests / 8 files PASS; typecheck and Prisma validation PASS. See `26-ledger-primitives.md`.
- **2026-11-02 fifth hardening slice:** KYC case foundation and review state machine implemented (`0012_kyc_case_foundation`, `0013_kyc_approval_hardening`). Applied only to isolated local test DB. Local verification: 92 unit tests / 15 files PASS; 52 integration tests / 9 files PASS; typecheck, Prisma validation, API/worker builds and design-artifact validation PASS. See `27-kyc-case-foundation.md`.

## Decisions retained from the user

| Decision | Status |
|---|---|
| Get Stoopy; Shop Smart. Live Better.; approved red/white/black design | Retained; exact vector asset/rights pending |
| One modular backend/database, role portals, API-first | Retained |
| Bangladesh first; Mymensingh City and Purbadhala pilot discussion | Retained; exact active polygons/stores pending |
| Remote buyer/recipient separation | Retained; supersedes buyer-GPS matching |
| Vendor manual ready; sequential 30-second rider offers | Retained |
| Fixed admin-configured road-distance pay; no traffic/wait bonus | Retained; actual rates/cutoff pending |
| Sunday automatic payout default + manual/verified bank option | Retained; supported rail/contract pending |
| COD custody independent of earnings | Retained; explicit offset policy pending |
| Vendor/rider/admin KYC; privileged TOTP | Retained |
| Consented first-party personalization; no covert communications access | Retained |
| AI cannot execute sensitive financial/permission/KYC actions | Retained |
| No paid resources/live collection/production without approval | Standing constraint |

## Proposed choices needing architecture review

| ID | Proposal | Alternative / consequence |
|---|---|---|
| D01 | Next.js BFF + NestJS modular monolith + worker | Well-structured Next backend is permitted; Nest adds explicit domain/guard structure and another deployable |
| D02 | Keycloak identity + opaque revocable BFF sessions | Maintained database-session auth framework if owner rejects identity-service operations; no JWT-only shortcut |
| D03 | PostgreSQL/PostGIS + Prisma with reviewed spatial adapter | Pin a compatible release after Phase-2 compatibility spike; Prisma 8 extension is new, not assumed production-proven |
| D04 | Google Routes/Matrix candidate | Another road-routing provider can be selected; no straight-line substitute for required road pay/dispatch |
| D05 | Private S3-compatible storage + KMS | Managed equivalent acceptable after access/retention/encryption review |
| D06 | Double-entry immutable journals; role ledger views | Avoids competing mutable wallets; requires deferred balance constraints and reconciliation |
| D07 | Earnings route/rate snapshot at final acceptance | Offer-time snapshot is an explicit business alternative; no retroactive changes either way |
| D08 | Destination-scoped local operations; separate financial-scope anchor | Owner must approve cross-zone report visibility and vendor finance anchor |
| D09 | Mobile-first PWA initially | Native wrapper later for supported background/capture controls; honest browser limitations |
| D10 | White/black/red tokens and approved layout | Exact brand asset/color confirmation at visual review; no green theme |

## Business/provider information still needed

1. Approve architecture and identity operating model; provide original repository if one exists outside this workspace.
2. Confirm legal merchant entity, verified contact details, logo/vector rights and actual support hours/policies.
3. Confirm pilot polygons, launch stores, operating hours, delivery/customer fee policy and funded free-delivery campaigns.
4. Set rider distance slabs/min/max, commission defaults/overrides, Sunday cutoff/holiday policy, payout fees/minimum and any disclosed COD offset.
5. Confirm vendor settlement hold/eligibility, first-year-free scope, plan prices/volume limits and renewal consent.
6. Approve KYC document/retention policy with qualified local review; identify only authorized verification channels.
7. Provide provider contracts/sandbox access when ready: payments, QR, MFS/bank payout, OAuth, maps, email/SMS/push/WhatsApp and AI. Missing items remain disabled.
8. Choose cloud/residency/budget/domain/on-call owner before any paid provisioning; production authorization remains separate.

None of these blockers justifies fabricated credentials, payments, KYC results or production data. Development can proceed with secure interfaces and clearly labelled test fixtures after architecture approval, within the approved no-paid-resource boundary.

## Change log

| Date | Change | Validation boundary |
|---|---|---|
| 2026-11-01 | Initial source recovery and Phase-1 design package | Document/contract checks only; no application tests |
| 2026-11-02 | Foundation audit + outbox visibility lease/fencing | Isolated test DB migration; unit/integration/typecheck/Prisma validation PASS; no production/existing-data migration |
| 2026-11-02 | Terminal inbox dead-letter hardening | Isolated test DB migration; unit/integration/typecheck/Prisma validation PASS; operator replay/resolve still pending |
| 2026-11-02 | Storage magic-byte validation + KYC quarantine/review | Isolated test DB migration; unit/integration/typecheck/Prisma validation PASS; production AV/KMS/object store still pending |
| 2026-11-02 | Immutable double-entry ledger primitives | Isolated test DB migration; unit/integration/typecheck/Prisma validation PASS; domain finance commands still pending |
| 2026-11-02 | KYC case foundation + review state machine | Isolated test DB migrations; unit/integration/typecheck/build/doc validation PASS; vendor/rider/admin activation and checklist policy still pending |
| 2026-11-02 | Vendor/rider party profiles + membership resolution + KYC-gated activation | Isolated test DB migrations 0014/0015; unit 97/16 and integration 58/10 PASS; catalog/checkout/dispatch and admin activation still pending |
| 2026-11-02 | Store + draft product/variant catalog foundation | Isolated test DB migration 0016; unit 101/17 and integration 62/11 PASS; public catalog, publication/moderation, cart/checkout and inventory still pending |
| 2026-11-02 | Product moderation/publication gate + public catalog read foundation | Isolated test DB migration 0017; unit 101/17 and integration 66/12 PASS; category/images, inventory, cart/checkout and store geometry still pending |
| 2026-11-02 | Category taxonomy + quarantined/reviewed product image foundation | Isolated test DB migrations 0018/0019; unit 104/18 and integration 70/13 PASS; inventory, cart/checkout and store geometry still pending |
| 2026-11-02 | Inventory balances + append-only movements + stock reservation/expiry foundation | Isolated test DB migrations 0020/0021; unit 108/19 and integration 75/14 PASS; cart/checkout, payments and store geometry still pending |
| 2026-11-02 | Authenticated cart + atomic checkout quote orchestration + vendor/store split snapshots | Isolated test DB migration 0022; unit 113/20 and integration 80/15 PASS; orders, payments/COD, delivery fees and store geometry still pending |
| 2026-11-02 | Immutable order boundary + sandbox payment intents + signed webhook verification + fail-closed COD policy | Isolated test DB migrations 0023/0024; unit 117/21 and integration 84/16 PASS; live payments, refunds, delivery fees, dispatch and settlement ledgers still pending |
| 2026-11-02 | Vendor suborder readiness: accept/reject, start preparation, manual ready, append-only history and store-scoped membership | Isolated test DB migrations 0025/0026; unit 121/22 and integration 88/17 PASS; dispatch/OTP, cancellation/restock, refunds, delivery fees and settlement ledgers still pending |
| 2026-11-02 | Store pickup geometry/hours/service-area approval + rider consent/shift/location/zone-grant eligibility | Isolated test DB migrations 0027/0028; unit 128/24 and integration 92/18 PASS; atomic dispatch offers, road-route provider, OTP, earnings/COD and settlement ledgers still pending |
| 2026-11-02 | Atomic dispatch: destination snapshot, 30-second offers, single active assignment, road-route adapter boundary and DB-time expiry/escalation | Isolated test DB migrations 0029/0030; unit 132/25 and integration 95/19 PASS; live paid routing, OTP proof, cancellation/restock/refund, earnings/COD and settlement ledgers still pending |
| 2026-11-02 | Delivery pickup confirmation, recipient OTP proof and completion gating | Isolated test DB migrations 0031-0034; unit 136/26 and integration 98/19 PASS; live OTP channel, COD accounting, cancellation/restock/refund, earnings/COD and settlement ledgers still pending |
| 2026-11-02 | Node 26 CI prerequisites + dispatch clock precision | Both CI jobs pin Node 26.13.0/npm 10.8.2; generate Prisma before typecheck and build packages before integration; engines Node 26.x. Approved additive migration 0035 aligns DB time to timestamp(3), with one LATERAL instant for exact 30-second TTL. Isolated test DB only; unit 136/26, integration 100/20, typecheck and Prisma validation PASS. No live provider or production change. |
| 2026-11-02 | PostGIS 3.4 CI operator compatibility | GitHub CI exposed ambiguous unqualified geometry inequality in the dispatch run guard. Additive migration 0036 uses schema-qualified PostGIS equality without changing snapshot/auth guards; regression tests cover search-path/operator resolution. Isolated test DB only; final unit 136/26, integration 102/21, typecheck and Prisma validation PASS. |
| 2026-11-03 | Pre-dispatch cancellation, exact-once restock and refund-review boundary | Additive migrations 0037/0038/0039; buyer whole-order cancellation before preparation/dispatch, terminal consumed reservations preserved, linked RESTOCK movements, verified-prepaid refund requests and scoped step-up approve/reject. Refund execution and money movement remain disabled. Isolated test DB only; unit 140/27 and integration 109/21 PASS, typecheck/Prisma/design validation PASS. Partial cancellation, returns, provider refunds and refund ledgers still pending. |
| 2026-11-03 | Encrypted vendor payout destination verification | Additive migrations 0044–0046; independent proof review, keyed fingerprints, active KYC, retirement and development 24-hour cooldown. No transfer. Unit 147/29 and integration 118/22 PASS; all five gates and CI green (`3f74408`). |
| 2026-11-03 | Vendor settlement calculation + maker–checker payable reservation | Additive migrations 0047–0049; per-suborder policy snapshots, integer floor rounding, hold/COD/refund/destination gates, independent terminal review and balanced payable journal. No provider execution or PAID state. Isolated test DB only; unit 150/30 and integration 120/22 PASS. Also made outbox claim ordering deterministic and isolated the crash-recovery fixture from same-millisecond rows. Live payout, refund/adjustment reconciliation and commercial policy sign-off remain pending. |
| 2026-11-03 | Full TEST_ONLY sandbox finance operations | Additive migrations 0050–0054; refund/adjustment journals, exact statement reconciliation, payout reservation/submission/UNKNOWN retry/terminal completion. Live payout and production sandbox remain fail-closed. Unit 155/32 and integration 121/22 PASS. No real money or provider network call. |
| 2026-11-03 | Admin activation + KYC retention automation | Additive migrations 0056–0063; scoped/TOTP-gated admin activation, encrypted KYC review/retention, worker expiry/purge boundary and OpenAPI updates. Pushed as `1e315aa`; GitHub CI run 41621814084 SUCCESS. |
| 2026-11-03 | Admin/KYC retention hardening before next slice | Additive migrations 0064–0065; exact admin grant closure, canonical retention policy fingerprints, deletion/hold/storage guards, transaction-local worker RLS and per-request rollback. Unit 161/34 and integration 124/23 PASS locally; committed as `e32d318`. |
| 2026-11-03 | Vercel web-only build + full-build CI gate | Root `vercel.json`, `build:vercel` script and CI `npm run build` gate fix monorepo Prisma/TS build failure. Pushed as `c72a0f2`; GitHub CI run 41659286766 SUCCESS and both Vercel build checks succeeded. Existing Git automation unexpectedly promoted production; owner approved immediate pause of both projects. See docs 46–47. |
| 2026-11-03 | Vercel preview-only guard | Disable automatic Git deployments and production auto-aliasing; add fail-closed ignored-build-step guard that permits only `VERCEL_ENV=preview`. Guarded commit `2d01ccf`; GitHub CI run 41674294287 SUCCESS. Projects initially paused because unpausing also restored promoted production aliases. No live money/AI enablement. |
| 2026-11-03 | Vercel preview-only recovery | Owner approved deleting only the two unapproved auto-promoted production deployments, then unpausing. Production domains and deleted deployment URLs verified HTTP 404. Manual preview deployments for `2d01ccf` READY on both projects; GitHub Vercel statuses success. Automatic Git deployments and production auto-aliasing remain disabled. No production promotion or live money/AI enablement. |
| 2026-11-04 | Supabase development connection readiness (read-only) | Owner asked to connect Supabase before the next slice. Connector credential valid, but `list_projects` is empty and both owner-supplied references (`xiyfzjjgkmtoxchfexyi`, `ribdhdxgqmirvnymkkoh`) return 403; blocker is connector account/organization authorization. Added read-only `db:preflight:supabase` (server-enforced read-only session, TLS verification on, credential redaction, fail-closed host/production guards) plus 9 unit tests and docs 48. No Supabase project, schema, Auth or data change; no migration; Keycloak/Prisma/RLS boundaries unchanged. Third-party `supabase/agent-skills` not installed without approval. Pasted publishable key never used or stored. |
| 2026-11-04 | Supabase endpoint reachability measured | Owner supplied shared-pooler details (region `ap-northeast-2`). Credential-free DNS/TCP probe: pooler 6543 and 5432 reachable over IPv4; direct `db.<ref>.supabase.co` is IPv6-only and `ENETUNREACH` from this network. Session-mode pooler on 5432 is therefore the migration-capable endpoint; 6543 (transaction mode) stays a preflight blocker. Preflight now derives project ref and region from the pooler role and reports the remedy; 10 unit tests. Connector still 403 with empty project list, so no Supabase query, migration or config change was made. Seoul region latency/residency needs owner sign-off. |
| 2026-11-04 | Fraud-risk signals + independent manual review (foundation) | Additive migrations 0066 with corrections 0067/0068: `RiskCase`/`RiskSignal`/`RiskCaseReview`, RLS-forced privileged-only access, append-only evidence, commit-time evidence-bound score check, independent reviewer + required review record, terminal freezing, audit + idempotent outbox. Pure `risk-v1` policy never enforces automatically and a weak VPN-only signal cannot queue a customer. Unit 7 and integration 8 new tests. No HTTP surface, no signal producers, no AI, no enforcement, no money movement. See docs 49. |
