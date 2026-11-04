# Ledger journal sealing and line-insert balance guard

Status: **implemented and integration-tested against the isolated local test database.**
This is a database hardening slice for the immutable double-entry ledger. It does not add a
payment, payout, refund, settlement or production capability, and it moves no money.

## Gap closed

Migration `0011` already blocked `UPDATE`/`DELETE` on `LedgerJournal` and `LedgerLine`, and it
checked journal balance at commit when the journal header was inserted. However, a privileged
writer could still insert *new* lines into an already committed journal in a later transaction.
That would mutate historical financial evidence even though existing rows could not be edited.

## Change

Additive migration `0070_ledger_journal_sealing`:

- `LedgerJournal.postingTxid` stores the server-assigned posting transaction id.
- A before-insert trigger ignores any client-supplied `postingTxid` and binds the journal to
  `pg_current_xact_id()`.
- A before-insert trigger on `LedgerLine` allows a line only while its journal is being posted in
  the **same transaction**. Once the journal commits, later line inserts fail with
  `ledger_journal_sealed`.
- A deferred constraint trigger on `LedgerLine` re-checks that the journal has at least two lines
  and net-zero debit/credit at commit, so extra lines added during posting cannot unbalance it.
- Existing journals are sealed by the migration: they receive the migration transaction id, so
  future line inserts into them fail closed. Existing financial rows are not rewritten.

The existing append-only triggers, RLS policies, runtime-role denial and privileged SELECT/INSERT
-only grants remain in force. Corrections must still be new linked reversal journals, never edits
or late additions to a committed journal.

## Verification

`tests/integration/ledger.test.ts` adds three tests:

1. A committed journal rejects later single or balanced-pair line inserts.
2. Extra unbalanced lines added during the posting transaction roll back at commit.
3. A forged client-supplied `postingTxid` is ignored; the journal is bound server-side and sealed
   after commit.

Local gates against the isolated test database passed before commit:

- `db:validate`, `typecheck`, full build and `build:vercel`: PASS
- unit: **187/38** PASS
- integration: **147/26** PASS, including the 11 ledger tests (after 0071)
- design validator: **10/0** PASS

Implementation commit `761a43b` passed GitHub Actions run `41768397273` (validate 1m28s, integration 4m3s). The CI evidence is recorded in `docs/15-progress-and-decisions.md`.

## Follow-up correction: wraparound-safe seal (0071)

`0070` used `pg_current_xact_id()`, a **32-bit** transaction id. PostgreSQL reuses 32-bit xids
after roughly 2^32 transactions, so a far-future transaction could eventually be handed the same
xid as a long-committed journal, satisfy the seal comparison, and re-open that historical journal
to late line inserts.

Migration `0071_ledger_seal_wraparound_safe` switches the column default and both seal functions
to `txid_current()`, the **epoch-qualified 64-bit** id (`epoch << 32 | xid`), which is never
reused. Already-stored values are not rewritten: inside epoch 0 both functions return the same
number, and once the epoch advances a 64-bit value can never collide with an older 32-bit value,
so existing journals stay sealed. Two further integration tests assert that the stored seal
equals `txid_current()` and that neither the functions nor the column default reference
`pg_current_xact_id`.

## Boundary

- Applied only to isolated local test database `getstoopy_foundation_test`.
- No development/production database migration, live payment, payout, refund execution or real
  money movement was performed.
- Before applying to any existing non-test database, review DDL lock/trigger behavior and obtain
  explicit confirmation. The migration is additive but takes a brief table lock to add the column
  and triggers.
