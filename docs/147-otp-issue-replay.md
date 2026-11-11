# Delivery OTP issue replay after proof

Previously, retrying the same OTP issue command after the recipient's code had been verified returned `OTP_NOT_ALLOWED`: the delivery status check ran before the idempotency lookup. A delayed client retry could therefore report a conflict even though its original command succeeded.

The assigned rider's existing issue command is now read under the delivery lock before checking whether a **new** challenge is allowed. An exact replay returns the existing challenge ID, current status, expiry and sequence with `duplicate: true`, including after verification and completion. It does not send another code or create another challenge, event or outbox record. An unrecognized command still fails after pickup has advanced, and the rider ownership check still applies before replay. No schema change is required.

The integration scenario covers replay after verification and completion, rejection of a different rider and a new command, no repeated test-channel delivery, and a single challenge/event/outbox record. Typechecking and CI results should be read from the associated commit and checks.

## Boundaries

This is an idempotency fix, not a production notification implementation. Only an in-process test channel exists; production OTP is disabled by configuration. The current flow commits a challenge before calling the channel, so a send failure or process crash can leave an issued challenge without a delivered code; replay cannot resend it. A real provider requires a carefully designed durable delivery/retry protocol, with encrypted short-lived secret handling and an explicit policy for ambiguous provider outcomes, before enabling live OTP. Cross-delivery recipient and rider rate-limit counts are not serialized across distinct delivery locks and need separate concurrency hardening. No live data, migration or deployment is included.
