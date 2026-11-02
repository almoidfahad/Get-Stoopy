# Inbox terminal-failure dead-letter hardening

Status: **implemented and locally integration-tested on an isolated PostgreSQL/Redis test fixture.** This is the second foundation-hardening slice after outbox visibility leasing. It does not implement an operator replay/resolve UI or full marketplace event handlers.

## Problem

The previous worker logged BullMQ failures but did not persist terminal inbox failures in PostgreSQL. Invalid envelopes and unknown event types were retried like transient handler failures, and raw handler/driver exception text could reach BullMQ `failedReason`/logs. Redis failed-job retention alone is not a durable operational dead-letter store.

## Change

Migration `0009_inbox_dead_letter` adds `InboxDeadLetter`:

- `consumer`, optional `eventKey`/`eventType`, `payloadHash`, `payload`, stable `errorCode`, `attempts`, `firstFailedAt`, `lastFailedAt`.
- Unique `(consumer, payloadHash)` so repeated terminal failures of the same payload update one row instead of creating duplicates.
- Check constraint `attempts >= 1`; index `(consumer, lastFailedAt)`.
- No DELETE grant is issued. Runtime role receives SELECT/INSERT/UPDATE for worker dead-letter writes; privileged role receives SELECT/INSERT/UPDATE through the standard grant script.

Worker behavior:

1. Invalid envelope -> `UnrecoverableError('INBOX_ENVELOPE_INVALID')`; no BullMQ retry.
2. Unknown event type -> `UnrecoverableError('INBOX_HANDLER_NOT_REGISTERED')`; no BullMQ retry.
3. Handler failure -> stable `INBOX_HANDLER_FAILED`; BullMQ retries according to job attempts.
4. Only terminal failures are written to `InboxDeadLetter`: unrecoverable errors or the final failed attempt.
5. Successful retries do not create dead-letter rows.
6. Raw handler/driver exception text is not propagated to BullMQ `failedReason` or structured logs.
7. Dead-letter payloads larger than 16 KiB are stored as `{ truncated: true, payloadHash }` rather than unbounded JSON.

Stable error codes:

```text
INBOX_ENVELOPE_INVALID
INBOX_HANDLER_NOT_REGISTERED
INBOX_HANDLER_FAILED
```

## Safety and rollout boundary

- Migration was applied only to isolated local test database `getstoopy_foundation_test`.
- No development or production database was migrated in this step.
- The table is additive; existing inbox/outbox rows are not rewritten.
- Before applying to any existing non-test database, review DDL lock/rollback behavior and obtain explicit confirmation.
- Rollback plan: stop workers, deploy the previous worker, then drop `InboxDeadLetter` in a reviewed down migration. Do not drop the table while new workers are running.
- Operator replay/resolve is intentionally not implemented yet. Replay must later require authorization, step-up for sensitive events, audit, idempotency and a reviewed state transition; it must not blindly requeue dead-letter payloads.

## Verification actually run

| Check | Result | Boundary |
|---|---|---|
| `npm run db:generate` | PASS | Prisma client generated |
| `npm run db:migrate` | PASS | `0009` applied to isolated test DB only |
| grant script | PASS | runtime/privileged grants reapplied to isolated test DB |
| `npm run db:validate` | PASS | Prisma schema valid |
| `npm run typecheck` | PASS | packages, API, worker, web |
| `npm test` | **82 tests / 12 files PASS** | includes dead-letter recorder validation/truncation tests |
| `npm run test:integration` | **38 tests / 7 files PASS** | real PostgreSQL/PostGIS + Redis/BullMQ worker dead-letter tests |

Integration tests cover:

- invalid envelope is dead-lettered without retry;
- unknown event type is dead-lettered without retry and writes no inbox receipt;
- handler failure retries and is dead-lettered only after the final attempt;
- raw connection-secret exception text is not stored in the dead-letter row or BullMQ failed reason;
- a retry that eventually succeeds writes an inbox receipt and no dead-letter row.

## Still pending

- Operator dead-letter list/review/replay/resolve API and UI, with RBAC, geographic scope, step-up and audit.
- Alerting/metrics for dead-letter growth and write failures.
- Retention/legal-hold policy for dead-letter payloads.
- Full domain handlers and domain-level idempotency for orders, payments, KYC, delivery and finance.
- Production Redis topology, TLS/ACL/persistence/monitoring and disaster recovery.
