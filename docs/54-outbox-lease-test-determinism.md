# Outbox lease test determinism (CI flake root cause)

Status: **fixed and regression-tested.** No production behaviour changed.

## Symptom

GitHub Actions run `41773024233` failed one integration test while the same suite passed locally:

```
tests/integration/outbox-lease.test.ts > releases a failed enqueue with backoff and dead-letters after max attempts
AssertionError: expected +0 to be 1
```

`second.failed` was `0` instead of `1`.

## Root cause

The suite configured `leaseMs: 1000`. `publishOutboxBatch` claims a row, then awaits
`queue.add(...)`. On a loaded CI runner that await can outlive the 1-second lease.
`releaseFailedLease` only writes when the caller still holds a live lease:

```sql
WHERE id = $1 AND "leaseToken" = $2 AND "leaseUntil" > now()
```

So the stale worker was correctly **fenced** and wrote nothing, and the batch reported
`fenced: 1, failed: 0`. The test asserted `failed: 1`. The fencing invariant was right; the
fixture's lease was simply shorter than the work it was timing.

Reproduced deterministically before changing anything, by delaying the failing enqueue:

| enqueue delay | result |
| --- | --- |
| 0 ms | `claimed 1, failed 1, fenced 0` |
| 1200 ms (lease 1000 ms) | `claimed 1, failed 0, fenced 1` |

## Fix

1. Suite lease raised to `30_000` ms, matching the vitest `testTimeout`. A lease can no longer
   expire mid-test by accident; only the explicit `expireLease()` helper expires one, which is
   what the crash/fencing tests intend.
2. Added a regression test that pins the actual production invariant instead of hiding it:
   with the enforced minimum lease (`1000` ms) and an enqueue that deliberately takes `1300` ms
   and then throws, the batch must report `fenced: 1, failed: 0`, the row must keep
   `failedAt`/`publishedAt`/`lastError` null, must not leak the Redis URL from the exception text,
   and must remain claimable so a later publisher publishes it successfully.

## Verification

- `tests/integration/outbox-lease.test.ts`: **7 tests**, run repeatedly, stable.
- Full integration suite and all other gates re-run before push.

## Boundary

Test-fixture and documentation change only. `packages/events/src/outbox.ts` was not modified:
lease fencing, backoff, dead-lettering and secret-redaction behaviour are unchanged.

## Follow-up incident (2026-11-04, commit `00da0bb`)

CI run `41809021119` failed once in
`fences a failing enqueue whose own lease expired mid-attempt…` with
`expected +0 to be 1` on `expect(r.claimed).toBe(1)`. A re-run of the same commit
passed, and the suite passed locally both alone (3×) and in full (2×), so the
failure was intermittent rather than a deterministic regression.

The investigation ruled out the obvious explanations rather than assuming one:

- integration files already run with `fileParallelism: false`, so suites do not
  publish concurrently;
- no `setInterval`/background publisher exists in `apps/api`, and no worker is
  started by the suites;
- `OutboxEvent` has no insert trigger that could pre-fail a row, and `attempts`
  and `availableAt` default to `0` and `now()`;
- the neighbouring stale-lease tests all `await` their in-flight publishers, so
  there is no stray publisher holding a gate.

What the failure actually exposed is a **diagnosability defect in the test**: it
asserts on a global batch counter with `batchSize: 1`, which is only meaningful if
the fixture row is the only claimable row. `claimed = 0` could not distinguish
"row not yet due", "row already leased", and "a leftover row from another suite
competed for the batch".

The fix asserts that precondition explicitly before publishing:

```sql
SELECT id FROM "OutboxEvent"
WHERE "publishedAt" IS NULL AND "failedAt" IS NULL
  AND "availableAt" <= now() AND ("leaseUntil" IS NULL OR "leaseUntil" <= now())
```

and requires the result to be exactly `[fixtureRowId]`. No production code changed
and no invariant was relaxed: if interference recurs, the failure now names the
competing row instead of reporting an ambiguous counter. The fencing assertions
(`fenced = 1`, `failed = 0`, no error text, later recovery) are unchanged.

Recorded honestly as **root cause not yet proven**. If it recurs, the precondition
failure will identify the mechanism, and this note should be updated rather than
the assertion loosened.
