# Owner decisions required to unblock the pilot (ক)

Status: **PARTIALLY APPROVED — 2026-11-04.** Sections 2–8 were approved by the owner for
**development use only** and are implemented in `docs/57` / `packages/core/src/pilot-policy.ts`.
Sections 1, 9 and 10 remain open: they need an external account, contract or budget that an
agent cannot create.

Approval record (owner answers, 2026-11-04):

| Section | Decision |
| --- | --- |
| 2 Region | **Seoul approved for development only** — no real customer/KYC data; production region undecided |
| 3–8 Business defaults | **All approved as proposed**, development configuration; live flags stay `false` |
| 1 Supabase access | Owner chose **CLI device login** rather than the connector |
| 9–10 Contracts, cloud, budget, domain | **Still open** — owner action required |

Nothing below authorizes live money movement. The values are loaded as a frozen, versioned
**draft** policy (`scope: 'development'`, `activationState: 'draft'`), and a guard rejects any
override that tries to change that.

This is the decision sheet for the blocked items. It separates three kinds of work:

- **A — Agent can implement** once a value is approved (code/config/migration/tests).
- **B — Owner must decide** (business policy, risk appetite, residency).
- **C — Owner must obtain externally** (contracts, accounts, budget). An agent cannot complete
  these; no document or code can substitute for a signed provider agreement.

---

## 1. Supabase connection — blocker

| Item | Kind | State |
| --- | --- | --- |
| Supabase connector enabled for this conversation | C | **off** — `list_connector_tools` returns `disabled` |
| Management API can see project `xiyfzjjgkmtoxchfexyi` | A (after C) | blocked; earlier attempts returned `403`, empty project list |
| Read-only preflight (`db:preflight:supabase`) | A | ready to run; needs `SUPABASE_DEV_DATABASE_URL` on the **session pooler, port 5432** |

Order is fixed: enable connector → verify project/health read-only → run preflight → report →
**only then** ask approval for any migration. No new Supabase project will be created.

---

## 2. Region / data residency

| Item | Kind | Proposal |
| --- | --- | --- |
| Supabase region | B | `ap-northeast-2` (Seoul) — the existing project's region |
| Measured reachability | done | pooler `6543` and `5432` reachable over IPv4; direct `db.<ref>.supabase.co` is IPv6-only and unreachable from this network |
| Latency expectation | B | Seoul ↔ Dhaka adds roughly 70–120 ms round trip versus a nearer region. Acceptable for a development database; **not** a production latency claim |
| Residency | B | Customer/KYC data would sit in South Korea, not Bangladesh. Needs an explicit owner decision, and legal review before any real customer data |

**Recommendation:** approve Seoul **for development only**, with no real customer or KYC data
until residency is legally reviewed. Production region stays undecided.

---

## 3. Pilot service area (polygons)

| Item | Kind | Proposal |
| --- | --- | --- |
| Pilot geometry | B | Start with **one city, 2–3 zones**, drawn as explicit polygons |
| Suggested starting point | B | Dhaka north: Uttara (zones 1–2), Mirpur (zone 10) — dense, short trips, easier rider supply |
| Source of truth | A | `BoundaryVersion` + `StoreServiceArea`; versioned, reviewed, never inferred from text |
| What the agent needs | B | Either the owner supplies GeoJSON, or approves the suggested zones so the agent can draft polygons for review |

**Recommendation:** approve a **single-city, 2-zone** pilot; agent drafts polygons, owner reviews
before activation. Cross-border and nationwide stay disabled.

---

## 4. Rider distance rate slabs

Model already supports `RiderRateRule` + `RiderRateSlab` (`lowerMeters`, `upperMeters`, `amountMinor`)
with effective dates and per-assignment snapshots.

| Slab | Distance | Proposed rider pay |
| --- | --- | --- |
| 1 | 0 – 2,000 m | BDT 40 |
| 2 | 2,001 – 4,000 m | BDT 60 |
| 3 | 4,001 – 6,000 m | BDT 80 |
| 4 | 6,001 – 10,000 m | BDT 110 |
| 5 | over 10,000 m | BDT 110 + 12 per extra km |

| Item | Kind | Note |
| --- | --- | --- |
| Slab values | B | Proposals only; must be checked against real rider cost and competitor rates |
| Customer delivery fee | B | Separate decision — docs 06 warns these must never be conflated. Its worked example shows delivery margin can be negative |
| Snapshot/invariance behaviour | A | Already implemented and tested |

**Recommendation:** load these as a **draft, inactive** rate rule in development so the flow can be
tested end to end, and keep activation blocked until the owner approves real numbers.

---

## 5. Payout cutoff and holiday calendar

| Item | Kind | Proposal |
| --- | --- | --- |
| Payout day | B | **Sunday**, `Asia/Dhaka` (already the documented default) |
| Earning cutoff | B | Saturday **23:59:59 Asia/Dhaka**; store the exact UTC instant plus the local period label |
| Processing hour | B | Sunday **10:00 Asia/Dhaka** |
| Holiday / provider outage | B | **Next business day**, with the schedule reason recorded. Never claim instant payout |
| Business-day calendar | A + C | Agent can implement the calendar table and logic; the **official Bangladesh holiday list must come from an authoritative source** and be owner-verified each year |
| Manual withdrawal window | B | Allow manual requests, subject to the same destination/risk/balance/COD checks |

**Recommendation:** accept the cutoff/processing/holiday rule above for development. Real payout
execution stays disabled until a provider contract exists.

---

## 6. COD offset

| Item | Kind | Proposal |
| --- | --- | --- |
| Default | B | **OFF** — collect COD deposits independently; never silently net COD against earnings |
| If enabled later | B | Requires a disclosed, approved policy, a rider-visible COD due figure, and a balanced transfer journal |
| Current invariant | done | COD custody is never presented as spendable balance |

**Recommendation:** keep COD offset **disabled**. This is the conservative option and matches the
existing ledger tests.

---

## 7. Commission and hold period

| Item | Kind | Proposal |
| --- | --- | --- |
| Commission rate | B | **10%** of eligible product sales (matches the docs 06 worked example) |
| Delivery in commission base | done | **Excluded** by default |
| Earned when | B | **Delivery completion**; pre-completion cancellation earns no normal commission |
| Settlement hold | B | **7 days** after delivery completion, to cover returns/refunds |
| Vendor settlement days | B | Configurable; propose **Sunday**, aligned with the rider cycle. No invented Wednesday/Saturday schedule |
| COD-funded settlement gate | B | Require **verified company deposit** before that order's money becomes settleable |
| First-year vendor relief | B + C | Requested historically, but activation date, eligibility and what "free" covers need owner definition; never auto-charge after a trial |

**Recommendation:** 10% / 7-day hold / completion-earned / deposit-gated, all as development
configuration. Nothing pays out while `PAYOUTS_LIVE_ENABLED=false`.

---

## 8. KYC retention

| Item | Kind | Proposal |
| --- | --- | --- |
| Approved KYC documents | B | Retain **365 days after relationship end**, then purge |
| Rejected applications | B | Retain **90 days**, then purge |
| Audit metadata (no document bytes) | B | Retain **7 years** |
| Legal hold | done | Overrides purge; already implemented |
| Flag | done | `KYC_RETENTION_ENABLED=false` until approved |

**Important:** these are **proposals, not legal advice.** Bangladesh Bank / BFIU record-keeping
obligations for a marketplace that collects COD must be confirmed by a qualified adviser before
real KYC data is retained. The agent will not assert a legal requirement it has not verified.

**Recommendation:** approve the numbers as development defaults, keep the flag off for real data
until legal review.

---

## 9. Provider contracts — owner action, cannot be delegated

| Provider | Needed for | State |
| --- | --- | --- |
| SSLCommerz / aamarpay / shurjoPay | Live card/MFS collection | **No contract.** Sandbox-only adapters; live flags `false` |
| Bank / MFS disbursement partner | Real vendor/rider payout | **No contract.** Payout execution disabled |
| Central Banga QR via acquirer | QR collection | **Unverified.** No official circular or acquirer permission confirmed; stays `false` |
| Google Maps Routes | Road-distance offers | **No billing account.** `ROAD_ROUTING_ENABLED=false` |
| SMS / email / push vendor | OTP and notifications | **No contract.** OTP channel is `disabled`/`test` only |

An agent cannot sign these. Until each exists, the corresponding adapter stays disabled and the
docs record it as a blocker — never as a fake integration.

---

## 10. Cloud, budget, domain — owner action

| Item | Kind | Proposal |
| --- | --- | --- |
| Development hosting | C | Current Vercel preview + Supabase free/dev tier is enough for development |
| Production hosting | B + C | Not authorized. Production URLs deliberately return **404** |
| Domain | C | Owner must purchase/point a domain; none is configured |
| Monthly budget ceiling | B | Owner must set a number before any paid resource is created |
| Object storage / KMS | C | Needs a real provider and key-management decision before real KYC uploads |

**Recommendation:** stay entirely on free/dev tiers until the feature backlog and QA are done.
No paid resource has been created.

---

## What "complete" means for (ক)

(ক) cannot be closed by the agent alone. It closes when:

1. The owner enables the Supabase connector, and read-only preflight passes. *(A after C)*
2. The owner accepts or edits the region decision. *(B)*
3. The owner accepts or edits each business value in sections 3–8, which the agent then
   implements as versioned, tested configuration. *(B then A)*
4. The owner obtains the contracts/accounts/budget in sections 9–10 — or explicitly agrees to
   keep those features disabled and proceed without them. *(C)*

Items 1–3 are achievable in one review round. Item 4 is real-world work outside this workspace.