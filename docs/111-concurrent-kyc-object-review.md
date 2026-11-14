# Concurrent KYC object review

The private storage object's KYC and payout-proof review previously read the quarantined state without locking it. Simultaneous reviewers could both see `QUARANTINED`, then approve and reject in sequence while both requests and both audit entries reported success. The privileged review transaction now locks the object row before checking purpose, owner and state. The winner records the decision and audit in the same transaction; the waiter observes the committed state and receives `OBJECT_NOT_QUARANTINED`. Existing permission, step-up, self-review, reason, and quarantine checks remain. No schema change is needed.

Local unit tests cover lock ordering and ineligible objects; a separate isolated PostgreSQL integration regression overlaps opposing reviewer requests while holding the object lock, then checks a single success, final metadata and one matching decision audit. This must pass CI before claiming database integration verification. Local full suite: 605 tests, typecheck and API build passed.

This only serializes decisions made through this storage review path for one object. It does not address other privileged workflows, object file/database atomicity, durable multi-instance storage, existing historical audit inconsistencies, or production readiness. There was no Supabase connection, deployment or user database access.
