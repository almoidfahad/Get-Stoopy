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
