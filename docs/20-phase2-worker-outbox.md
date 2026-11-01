# Phase 2 — Worker, outbox and inbox foundation

Status: **IN PROGRESS — worker/outbox/inbox slice implemented and integration-tested locally.** This is not the full marketplace event system and not production readiness.

## Implemented

- `packages/events`: validated version-1 domain event envelope, PostgreSQL outbox claim/publish helpers, bounded exponential retry/backoff, and transactional inbox deduplication.
- `apps/worker`: BullMQ worker process with Redis connection, outbox polling, graceful shutdown, structured redacted logging and handler registration.
- Migration `0005_outbox_worker`: adds `availableAt`, `lastError`, `failedAt` and a pending-outbox index.
- Outbox rows are claimed with `FOR UPDATE SKIP LOCKED`; envelope/row mismatch is rejected before publish.
- Inbox receipts are inserted in the same transaction as the handler; duplicate events are skipped and failed handlers roll back the receipt so retry is possible.
- CI integration job now includes Redis as well as PostGIS.

## Verification actually run

| Check | Result | Boundary |
|---|---|---|
| `npm run typecheck` | PASS | packages, API, worker, web |
| `npm test` | **68 tests / 9 files PASS** | unit tests including event envelope/outbox retry |
| `npm run test:integration` | **23 tests / 3 files PASS** | real PostgreSQL/PostGIS, RLS, NestJS API, Redis/BullMQ outbox/inbox |
| Prisma migrations | PASS | `0001`–`0005` applied to local dev and test databases |
| Local worker smoke | PASS | worker consumed a local test event and wrote an inbox receipt |

## Still not proven

- Production Redis topology, persistence, TLS, ACLs, monitoring and dead-letter operations.
- Full domain handlers for orders, payments, delivery, KYC, finance and notifications.
- Exactly-once business effects beyond the tested inbox/outbox foundation; consumers must still implement domain idempotency.
- Socket.IO realtime gateway, private object storage, maps, payments, payouts and AI.

## Local development

Run Redis and PostgreSQL/PostGIS, apply migrations, then use `npm run dev:worker`. The worker uses `DATABASE_URL`, `REDIS_URL`, `WORKER_QUEUE`, `WORKER_CONCURRENCY`, `OUTBOX_POLL_MS`, `OUTBOX_BATCH_SIZE` and `OUTBOX_MAX_ATTEMPTS` from the ignored local `.env`.
