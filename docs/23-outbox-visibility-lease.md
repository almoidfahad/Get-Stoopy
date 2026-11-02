# Outbox visibility lease and stale-worker fencing

Status: **implemented and locally integration-tested on an isolated PostgreSQL/Redis test fixture.** This hardens the existing outbox publisher; it does not implement marketplace domain events or production operations.

## Problem

The previous publisher claimed rows with `FOR UPDATE SKIP LOCKED`, incremented `attempts`, committed, and then called Redis/BullMQ. The row lock did not cover the enqueue window. If two publishers polled concurrently, or a publisher crashed/restarted, the same outbox row could be claimed again before the first enqueue finished. A stale worker could also overwrite the final state of a row that a newer worker had already published.

## Change

Migration `0008_outbox_visibility_lease` adds two nullable columns to `OutboxEvent`:

- `leaseToken UUID`: fencing token for the current claim.
- `leaseUntil TIMESTAMP(3)`: visibility deadline for the current claim.

A check constraint requires the pair to be both null or both non-null. A partial index supports expired/active lease lookup for pending rows. Existing rows remain valid with both columns null. The migration is additive; it does not delete or rewrite existing outbox rows.

Publisher semantics:

1. Claim due, unpublished, non-failed rows whose lease is null or expired.
2. Atomically increment `attempts`, assign a new `leaseToken`, and set `leaseUntil = now() + leaseMs`.
3. Enqueue to BullMQ with `jobId = eventKey`.
4. Mark published only if the same `leaseToken` is still present and `leaseUntil > now()`.
5. On enqueue failure, release the lease and apply bounded exponential backoff only if the same lease is still current.
6. If a stale worker finalizes after lease expiry/reclaim, the update matches zero rows and is counted as `fenced`; it cannot overwrite the newer state.
7. Rows that exhausted `maxAttempts` and became due again are dead-lettered with `OUTBOX_ATTEMPTS_EXHAUSTED` instead of leasing forever.

Delivery remains **at-least-once**. BullMQ job-id dedupe and the transactional inbox reduce duplicate effects, but domain handlers must still be idempotent. This slice does not claim exactly-once business execution.

## Configuration

Worker environment:

```text
OUTBOX_LEASE_MS=30000
```

Allowed range: 1000–300000 ms. Default: 30000 ms. Choose a lease longer than the expected Redis enqueue latency under load, but short enough for acceptable crash recovery. `OUTBOX_BATCH_SIZE`, `OUTBOX_MAX_ATTEMPTS`, `OUTBOX_POLL_MS` remain bounded and validated.

## Safety and rollout boundary

- Migration was applied only to the isolated local test database `getstoopy_foundation_test`.
- No development or production database was migrated in this step.
- Before applying to any existing non-test database, review lock/rollback behavior and obtain explicit confirmation. The additive columns are nullable, but the check constraint/index creation still takes DDL locks.
- Rollback plan: stop workers, deploy the previous publisher only after confirming no active leases are required, then drop the partial index, check constraint and two columns in a reviewed down migration. Do not drop columns while new workers are running.
- Raw Redis/driver exception text is not persisted in `lastError`; only stable error codes are stored.

## Verification actually run

| Check | Result | Boundary |
|---|---|---|
| `npm run db:generate` | PASS | Prisma client generated |
| `npm run db:migrate` | PASS | `0008` applied to isolated test DB only |
| `npm run db:validate` | PASS | Prisma schema valid |
| `npm run typecheck` | PASS | packages, API, worker, web |
| `npm test` | **79 tests / 11 files PASS** | includes outbox option validation |
| `npm run test:integration` | **34 tests / 6 files PASS** | real PostgreSQL/PostGIS + Redis; includes lease/concurrency/crash/fencing/retry/dead-letter tests |

Integration tests cover:

- only one concurrent publisher claims a due row;
- active lease blocks reclaim;
- simulated crash after claim recovers after lease expiry;
- stale publisher cannot mark published after a newer lease published;
- stale enqueue failure cannot overwrite a newer successful publish or leak connection secrets;
- failed enqueue releases lease with backoff and dead-letters after max attempts;
- final-attempt crash is dead-lettered after lease expiry.

## Still pending

- Dead-letter operator UI/API, alerting, replay policy and retention.
- Production Redis TLS/ACL/persistence/monitoring and multi-region failure behavior.
- Full domain handlers and domain-level idempotency for orders, payments, KYC, delivery and finance.
- Load/soak testing to tune lease duration and batch size under realistic pilot traffic.
