# 45 — Admin activation / KYC retention remediation

Status: development remediation; no production enablement.

This slice closes defects found after `docs/44` before moving to fraud/AI/QA/deploy-prep.

## Fixed defects
1. **False purge success on storage failure.** `LocalEncryptedObjectStorage.delete` previously swallowed every filesystem error. It now treats only `ENOENT` as idempotent success and propagates other failures. The worker rolls back the affected deletion request, leaves it `APPROVED`, counts/logs the failure, and continues with other requests. Regression tests simulate `EACCES`, verify no tombstone/PURGED state, then retry successfully.
2. **Privileged session leakage in worker pool.** The retention worker previously used session-level `set_config(..., false)`. All privileged context is now transaction-local (`set_config(..., true)`), and a regression test checks a reused pool connection is not left with `app.is_super=true`.
3. **Silent retention-policy version reuse.** Reusing a `policyVersion` with different day counts/legal basis now returns `RETENTION_POLICY_VERSION_CONFLICT`; identical canonical payloads remain idempotent. Policy insert is guarded by actor and non-empty trimmed version/evidence.
4. **Admin access outliving revoked/expired ADMIN KYC.** `AdminActivation` now records the exact `UserRole` and `AdminScope` it created. KYC revoke, KYC expiry, and activation expiry close the activation, revoke those grants, bump authorization version, and write audit/outbox evidence. Re-invitation runs the expiry tick first so stale ACTIVE rows do not block renewal.
5. **KYC revoke did not immediately restrict linked parties.** Manual `REVOKE` now restricts linked ACTIVE vendor/rider profiles in the same transaction, matching expiry behavior.
6. **Deletion/hold race hardening.** Deletion and legal-hold guards lock the KYC case; deletion requires an elapsed due date, immutable request fields, independent review, and no active linked party. Linked-storage purge additionally blocks active parties and preserves object identity fields.
7. **CI deprecation warnings.** GitHub Actions are pinned to Node-24-based `actions/checkout@v7.0.1` and `actions/setup-node@v7.1.0` commit SHAs; runners are pinned to `ubuntu-24.04`.

## Migrations
- `0064_admin_access_closure`: grant links, closure guard/helper, admin expiry tick.
- `0065_retention_hardening`: deletion/hold/storage/policy guards and retention tick integration.

## Verification
- Unit: storage delete failure propagation, retention policy fingerprint/due helpers.
- Integration: admin KYC revoke closes grants; policy version conflict; legal hold blocks purge; storage failure leaves request retryable; successful retry purges; pooled connection does not retain superuser context.

## Boundary
Live payments, live payouts, cross-border, AI execution and production deployment remain disabled and separately authorized. Retention day values remain owner-approved policy data, not statutory defaults.
