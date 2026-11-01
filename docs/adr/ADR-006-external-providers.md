# ADR-006: Capability-gated provider adapters

Status: ACCEPTED for development — owner approval 2026-11-01. Production/provider gates remain. Date: 2026-11-01.

Context: SSLCOMMERZ/aamarPay/shurjoPay, Bangla QR, MFS/bank payouts, OAuth, maps and notifications require real contracts and credentials. A logo or sandbox example is not production eligibility.

Decision: Adapters declare supported operations and country/environment. Live flags default false. Provider-specific authenticity verification plus server transaction validation, exact amount/currency/order match, dedupe and reconciliation are mandatory. Central QR/split settlement/disbursement remain disabled until legal/acquirer approval. Google Routes/Matrix is a candidate, not a provisioned service. Mapbox/OSRM/Turf/FCM remain alternatives requiring ADR/cost review.

Consequences: Missing integrations are visible blockers, not fake success. Public provider docs may be old/incomplete; merchant-specific confirmation controls. No public sandbox secrets in source. Paid resources require owner approval; production requires separate authorization.

Alternatives: Direct provider SDK calls throughout domain code are rejected because they couple money logic to vendor payloads and weaken testability.

Review gate: Approve adapter boundary and provider priority; supply contracts/credentials only when ready. Nothing is connected or paid for.
