# Serviceability contributor review separation

`proposedByUserId` is immutable and records the first proposer, not necessarily the vendor member who last amended a pickup point or resubmitted a rejected service area. The API previously checked only that initial proposer and the vendor owner before allowing an authorized reviewer to decide. A vendor manager who also had review privileges could therefore review their own subsequent change.

The review paths now also reject any user with a recorded proposal audit for the same pickup point or service area. This is deliberately stricter than checking only the latest amendment: all recorded contributors are ineligible to review that record, even after their vendor membership is revoked or another person edits it. The original proposer and owner checks remain as fallbacks. The checks run inside the existing locked review transactions. Existing resource audit indexes support the lookup. Duplicate service-area requests do not write proposal audits and therefore do not make an otherwise independent user a contributor.

An integration regression creates an authorized manager/reviewer, amends an existing pickup point, resubmits a rejected area and revokes the membership. Both self-reviews must return 403 without a state change; an independent reviewer can still approve. No schema change is required.

## Limits

The API relies on proposal audit records and does not add a database-level contributor guard. Before the change documented in `139`, rejected service-area resubmissions were not audited, so their actors cannot reliably be recovered from those records. Existing historical unaudited resubmissions require separate investigation or re-proposal before relying on this rule. Direct privileged database writers can bypass the API rule. This was tested against disposable infrastructure only; no hosted data or production configuration was changed.
