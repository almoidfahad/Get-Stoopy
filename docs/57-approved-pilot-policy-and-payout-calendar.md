# Owner-approved pilot policy and payout calendar

Status: **implemented for development, inactive for money movement.**
Decision recorded 2026-11-04 from the owner's answers to `docs/56`.

## What the owner approved

| Decision | Approved value |
| --- | --- |
| Supabase region | `ap-northeast-2` (Seoul), **development only**. No real customer/KYC data; production region undecided |
| Commission | 10% (`1000` bps), delivery excluded, earned on delivery completion |
| Settlement hold | 7 days after completion |
| COD-funded settlement | Requires verified company deposit |
| Payout schedule | Sunday 10:00 `Asia/Dhaka`; earning cutoff the preceding Saturday at end of local day |
| Holiday / outage | Defer to the next business day, reason recorded |
| COD automatic offset | **Off** |
| KYC retention | approved 365 days, rejected 90 days, audit metadata 7 years — development defaults pending legal review |
| Rider slabs | 0–2 km BDT 40, 2–4 km 60, 4–6 km 80, 6–10 km 110, then +12 per started km |
| Pilot area | Dhaka / Uttara, 2 zones — geometry still needs owner-reviewed GeoJSON |

Still **not** approved and therefore unchanged: customer delivery fee, live payments, real
disbursement, Bangla QR, production hosting, any paid resource. Provider contracts and budget
remain owner actions that no code can substitute for.

## Implementation

### `packages/core/src/pilot-policy.ts`

`BD_PILOT_POLICY` is a single frozen, versioned source for the approved numbers
(`PILOT_POLICY_VERSION = bd-pilot-2026-11-04.1`). It carries `scope: 'development'` and
`activationState: 'draft'` so it cannot be mistaken for a live configuration, and
`assertPilotPolicy` rejects an override that would flip either, enable COD offset, include
delivery in the commission base, or introduce a slab gap.

Versioning is not cosmetic: settlement and assignment amounts are snapshotted with the policy
version, so a later rate change cannot retroactively reinterpret an existing order.

`pilotRiderPayMinor` makes the slab boundaries half-open — a distance exactly on a boundary
belongs to the higher slab — so there is no gap and no double count, and pay is monotonic in
distance. Beyond 10 km each *started* kilometre adds BDT 12.

The holiday list ships **empty on purpose**. An invented holiday calendar would silently defer
real payouts; the list must be owner-verified against an authoritative Bangladesh source each
year before it is populated.

### `packages/core/src/payout-calendar.ts`

`nextPayoutRun(asOf)` returns the next run strictly after `asOf`, with:

- `scheduledAtUtc` — when the run is attempted
- `cutoffUtc` — earnings at or before this instant belong to the run
- `periodDate` / `processingDate` — original versus actual local date
- `reason` — `scheduled`, `holiday`, `weekend`, or `holiday_and_weekend`
- `deferredDays`, `policyVersion`

Two invariants drove the design:

1. **Deferral moves processing, never the cutoff.** If a holiday pushed the cutoff too, the set
   of earnings being paid for would silently change. The cutoff stays anchored to the original
   period's Saturday.
2. **All arithmetic is on local calendar dates, then converted to a UTC instant.** Adding
   `7 × 24h` to a UTC timestamp is not equivalent in a zone whose offset can change, so it is
   never done. Conversion uses the platform IANA database through `Intl`, not a hardcoded
   `+06:00`.

Bangladesh's weekend is Friday and Saturday, so a deferred Sunday can legitimately land on the
following Sunday after a long holiday block; that case is covered. Deferral is bounded at 62
days and throws rather than looping forever if every day is marked a holiday.

## Verification

| Gate | Result |
| --- | --- |
| `db:validate` | PASS |
| `typecheck` | PASS |
| unit | **211 tests / 40 files** PASS (was 187/38; +24 new) |
| integration | **148 tests / 26 files** PASS |
| design validator | **10 passed / 0 failed** |

New tests cover the approved values, freeze/immutability, rejected unsafe overrides, slab
boundaries and monotonicity, the documented BDT 1000 → 900/100 settlement example, the exact
7-day hold, Dhaka date boundaries, holiday and combined holiday+weekend deferral with an
unchanged cutoff, unbounded-deferral refusal, and a strictly increasing 30-week schedule.

## Environment durability

`scripts/dev-bootstrap.sh` was added because the sandbox was reset twice mid-task, each time
removing the Node toolchain, PostgreSQL/PostGIS, Redis, dependencies and file modes. One
idempotent command now rebuilds all of it from pinned, checksum-verified sources, creates only
the isolated `getstoopy_foundation_test` database, applies migrations and grants, installs the
design-validator dependencies, and writes a gate environment file. It reads credentials from
the uncommitted `.env` and prints no secret values.

GitHub CLI credentials now live in the default `~/.config/gh` location, which survives a
snapshot restore; the previous custom location did not, which is why re-authorization kept
being needed.

## Boundary

No production or Supabase migration was run. No live payment, payout, or money movement.
`PAYOUTS_LIVE_ENABLED`, `PAYMENTS_LIVE_ENABLED`, `BANGLA_QR_ENABLED`, `CROSS_BORDER_ENABLED`
and `AI_ENABLED` all remain `false`.