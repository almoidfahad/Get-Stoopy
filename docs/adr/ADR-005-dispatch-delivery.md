# ADR-005: Manual ready, sequential road-distance dispatch and OTP

Status: ACCEPTED for development — owner approval 2026-11-01. Production/provider gates remain. Date: 2026-11-01.

Context: User rejected automatic ready and unrelated travel/traffic/waiting bonuses. Delivery needs one atomic rider assignment and remote-recipient support.

Decision: Vendor manually confirms ready. PostGIS filters eligible riders; road-route matrix orders offers. One unexpired offer per delivery, 30-second DB-time expiry, locked acceptance and one active assignment. Store→recipient road distance determines fixed slab pay; rider→store distance only ranks dispatch. Snapshot rule/route at final acceptance by default. Recipient OTP and COD accounting gate completion. Manual fallback uses same eligibility and audited authority. One active delivery per rider initially.

Consequences: Maps cost/latency and no-rider escalation need operational handling. No fake road-distance fallback. Reassignment preserves attempts and immutable earnings history. Traffic-aware ETA does not change pay. PWA background location is limited; native wrapper is a later decision.

Alternatives: Broadcast offers create race/fairness complexity; straight-line distance violates road-distance intent; auto-ready and time bonuses are explicitly rejected.

Review gate: Approve snapshot point, slab boundaries, initial capacity and exception policy. No dispatch implementation exists.
