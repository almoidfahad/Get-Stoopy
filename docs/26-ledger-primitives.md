# Immutable double-entry ledger persistence primitives

Status: **implemented and locally integration-tested on an isolated PostgreSQL test fixture.** This is a finance foundation slice, not a payment, settlement, payout, COD reconciliation or vendor/rider earnings product.

## Problem

Before this slice, finance existed only as pure helpers (`assertBalanced`, money allocation/commission). There was no persistent immutable journal, no database-enforced balance constraint, no business-event idempotency for money effects, and no ledger-specific privilege boundary.

## Change

Migration `0011_ledger_primitives` adds:

- `LedgerAccount`: typed chart-of-accounts primitive (`ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`) with ISO-style currency code.
- `LedgerJournal`: immutable journal header with unique `businessEventKey`, payload hash, currency, description, actor, occurrence time and optional linked reversal.
- `LedgerLine`: immutable positive `BIGINT` debit/credit line with deterministic line number.

Database invariants:

1. Line amount must be positive; line number must be positive and unique per journal.
2. Line currency must match journal and account currency.
3. A deferred constraint trigger requires each journal to have at least two lines and net zero debit/credit at commit.
4. Journal and line UPDATE/DELETE are blocked by append-only triggers.
5. Runtime database role has no direct ledger grants. Privileged role has SELECT/INSERT only, subject to RLS requiring explicit super context.
6. Unique `businessEventKey` prevents duplicate money effects. The helper returns the existing journal for an identical payload and rejects a different payload under the same key.

Package `@getstoopy/ledger` provides:

- `validateJournalInput`
- `journalPayloadHash`
- `createLedgerAccount`
- `postJournal`

`postJournal` must run inside a caller-controlled transaction using the privileged database role and explicit `app.is_super=true`. It does not open its own transaction, so domain commands can later combine ledger writes with domain state and outbox events atomically.

## Safety and rollout boundary

- Migration was applied only to isolated local test database `getstoopy_foundation_test`.
- No development or production database was migrated in this step.
- No real money, payment provider, payout, settlement or COD operation was executed.
- The slice is additive; existing tables/rows are not rewritten.
- Before applying to any existing non-test database, review DDL lock/trigger behavior and obtain explicit confirmation.
- Rollback plan: stop finance writers, deploy previous code, then drop ledger triggers/functions/tables/types in a reviewed down migration. Do not drop ledger tables while new code is running.
- Corrections must be new linked reversal journals; historical journals/lines must not be edited or deleted.

## Verification actually run

| Check | Result | Boundary |
|---|---|---|
| `npm install` | PASS | workspace lockfile updated for `@getstoopy/ledger` |
| `npm run db:generate` | PASS | Prisma client generated |
| `npm run db:migrate` | PASS | `0011` applied to isolated test DB only |
| grant script | PASS | isolated test DB only |
| `npm run db:validate` | PASS | Prisma schema valid |
| `npm run typecheck` | PASS | packages, API, worker, web |
| `npm test` | **88 tests / 14 files PASS** | includes ledger validation/hash unit tests |
| `npm run test:integration` | **45 tests / 8 files PASS** | includes real PostgreSQL ledger constraint/idempotency/privilege tests |

Integration tests cover:

- balanced journal posting and identical-payload deduplication;
- same business event key with different payload is rejected;
- unbalanced helper input is rejected;
- raw SQL unbalanced journal is rejected by the database at commit;
- ledger UPDATE/DELETE and runtime direct access are denied;
- account/journal currency mismatch is rejected.

## Still pending

- Domain finance commands: verified payment capture, COD custody/deposit, rider earnings, vendor commission/settlement, payout reserve/paid states.
- Account provisioning policy, country/currency configuration, financial geographic scope and maker-checker controls.
- Balance projections/snapshots, reconciliation reports, provider/bank evidence and reversal workflows.
- Sunday payout scheduler, verified destinations, unknown-result handling and provider idempotency.
- Production audit/monitoring, performance budgets and restore drills.
