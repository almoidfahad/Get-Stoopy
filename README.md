# Get Stoopy — Phase-1 architecture review package

**Shop Smart. Live Better.**

Status: **Architecture approved for development 2026-11-01; Phase 2 in progress.** The original review package remains below. Executable foundation slices now include API/BFF/RLS, local Keycloak OIDC, worker/outbox/inbox, privileged TOTP/session controls and private local encrypted storage. Current local verification on **Node 26.13.0 / npm 10.8.2**: **155 unit tests / 32 files PASS** and **121 integration tests / 22 files PASS** against isolated PostgreSQL/PostGIS + Redis. The runtime engine is `26.x`; CI generates Prisma Client before typechecking and builds workspace packages before integration tests. This is still not a running marketplace; no paid resource, live payment collection or production deployment exists. See `docs/17-phase2-foundation.md` through `docs/43-sandbox-finance-operations.md`.

## Source control

Private GitHub repository: <https://github.com/almoidfahad/Get-Stoopy> (`main`). The product name is **Get Stoopy**; GitHub uses the space-free slug `Get-Stoopy`.

## Start here

Open `architecture-review.html` for the self-contained review: executive summary, decisions, critical risks, embedded architecture/ERD diagrams, screenshot references, searchable requirement register and full documents. It uses embedded assets and local filtering; no network is required for the review itself. External citation links need internet.

The companion ZIP contains the same package plus Markdown/CSV/YAML/JSON sources, research extracts, documentation tools and reference images.

## What is included

- Phase-1 review documents, validation report, Phase-2 foundation log and 8 ADRs accepted for development.
- Logical data model: 113 entities, 253 explicit relationships; complete Mermaid ERD, 11 domain ERDs, 13 SVGs and data dictionary. Required VendorLedger/RiderLedger/CODLedger names are mapped to immutable journal views.
- Role/geographic permission policy and 240-row machine-readable role matrix.
- Proposed OpenAPI 3.1 contract: 87 paths, 90 operations, 36 schemas. No live server.
- Security threat model, KYC workflow, finance/delivery policy, payment/provider readiness, AI/privacy scope.
- 916 traceability rows: 802 normalized master/Bengali source lines, 39 historical additions, 75 screenshot inventory rows. Planned verification is marked NOT_RUN.
- Source review: 460 recovered visible messages (209 user / 251 assistant), five current upload hashes, and explicit unavailable-artifact/fidelity limitations.
- Roadmap, progress/decision log and document-only validation report.

## Phase-2 runtime slice

`apps/api` (NestJS) and `apps/web` (Next.js BFF) now exist. Real local PostgreSQL/PostGIS migrations and RLS integration tests pass; see `docs/18-phase2-api-bff-rls.md`. Local Keycloak OIDC login/logout smoke verification passes (`docs/19-phase2-keycloak-live.md`), and the worker/outbox/inbox foundation passes real PostgreSQL + Redis integration tests (`docs/20-phase2-worker-outbox.md`). TOTP/step-up, safe-linking interface, recovery/session controls, emergency revocation and private encrypted storage are implemented and locally integration-tested (`docs/21-phase2-security-storage.md`). The outbox publisher now has a durable visibility lease and stale-worker fencing (`docs/23-outbox-visibility-lease.md`), terminal inbox failures are persisted to a dead-letter table (`docs/24-inbox-dead-letter.md`), KYC uploads require magic-byte validation plus privileged quarantine review (`docs/25-storage-quarantine-review.md`), immutable double-entry ledger persistence primitives exist (`docs/26-ledger-primitives.md`), a user-level KYC case/review state machine with scoped step-up approval and fail-closed eligibility exists (`docs/27-kyc-case-foundation.md`), vendor/rider party profiles now resolve into session authorization context with privileged KYC-gated activation (`docs/28-party-profiles-activation.md`), and a vendor-side draft store/product/variant catalog foundation exists with KYC-gated writes (`docs/29-draft-catalog-foundation.md`). Product moderation/publication is now gated behind independent privileged review/publish, and a fail-closed public catalog read/search foundation exists (`docs/30-product-moderation-public-catalog.md`). A country-scoped category taxonomy and quarantined/reviewed product-image foundation now exist (`docs/31-category-taxonomy-product-images.md`). Vendor suborder readiness now implements accept/reject, start preparation and manual ready with append-only history and store-scoped membership authorization (`docs/35-vendor-suborder-fulfillment-readiness.md`). Store pickup geometry/hours/service-area approval and rider consent/shift/location/zone-grant eligibility now exist as dispatch prerequisites (`docs/36-store-serviceability-rider-eligibility.md`). Atomic 30-second dispatch offers, single active rider assignment, road-route adapter boundary and DB-time expiry/escalation now exist (`docs/37-atomic-dispatch-offer-assignment.md`). Assigned-rider pickup confirmation, recipient OTP proof and completion gating now exist (`docs/38-delivery-pickup-otp-proof.md`). Rider rate snapshots, completion earnings/COD custody journals and verified deposit allocation now exist; payout remains disabled (`docs/40-rider-earnings-cod-ledger.md`). Buyer whole-order pre-dispatch cancellation now restocks consumed reservations exactly once and creates a fail-closed refund-review request for verified prepaid orders; review approval does not execute a refund or move money (`docs/39-cancellation-restock-refund-review.md`). Encrypted vendor payout destinations now require independent proof/finance review, active KYC and a development cooldown; live payout remains disabled (`docs/41-vendor-payout-destinations.md`). Vendor settlement calculation now requires an approved commission/hold policy, verified destination cooldown, completed delivery, verified COD deposits or prepaid status and refund reconciliation; independent approval reserves payable only, never a transfer (`docs/42-vendor-settlement-review.md`). Foundation audit and dependency-ordered commerce plan: `docs/22-foundation-audit-and-plan.md`. Full marketplace modules and production IdP/storage hardening are not yet proven.

## Validation boundary

`python tools/validate_design_artifacts.py` checks documents/contracts only. Current result: 10 passed / 0 failed. This is **not** an application, migration, endpoint, security, payment or performance test. Phase 1 is not complete until the owner reviews/approves the architecture; Phases 2–11 have not started.

## Key proposed choices

Next.js BFF + one NestJS modular monolith + worker; PostgreSQL/PostGIS/Prisma; Keycloak with opaque revocable BFF sessions; scoped repositories + RLS; immutable balanced journals; recipient-first remote ordering; manual vendor ready; sequential 30-second road-distance rider offers; Sunday payout under verified conditions; capability-gated provider adapters; consented first-party personalization and human-approved AI.

## Review before approval

See `docs/15-progress-and-decisions.md` for identity operating model, pilot boundaries, financial cutoff/rates, COD offset, commission/settlement policy, provider contracts, retention and brand assets. Architecture approval permits development only; paid services, real payment collection and production deployment require separate explicit authorization.

## Rebuilding documentation artifacts

These scripts generate documentation, not application code:

```bash
python tools/build_design_artifacts.py
python tools/build_requirements.py
python tools/build_openapi.py
# Optional SVG rendering requires the cached Graphviz WASM package:
node tools/render_diagrams.mjs
python tools/validate_design_artifacts.py
python tools/build_review_package.py
python tools/validate_design_artifacts.py
```

Python documentation dependencies used in this workspace: PyYAML, Pillow, openapi-spec-validator 0.7.2, markdown-it-py, beautifulsoup4. The optional renderer used `@hpcc-js/wasm-graphviz` 1.12.0 in `.cache/diagram-renderer` (not an application dependency). The hand-authored system overview SVG is already included.
