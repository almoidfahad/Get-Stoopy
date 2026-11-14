# Shared-recipient OTP issue limit consistency

One order may split into multiple store suborders and deliveries that share its immutable `DeliveryRecipient`. The OTP issue flow has a five-challenge-per-hour limit for that recipient record, but delivery-row locks alone do not serialize issue requests on separate deliveries. Two riders could both observe the final available slot and exceed the cap.

The API now holds a transaction-scoped advisory lock keyed by that recipient record, after delivery ownership and exact-replay checks and before reading the database wall clock, cooldown and rate count. It holds the lock through challenge creation and commit/rollback. Existing delivery locks, per-delivery limits, cooldown and exact replay behavior remain in place. No migration is included.

The integration scenario creates a real two-store order, two suborders, separate riders and two picked-up deliveries sharing one recipient. Four expired fixture challenges are seeded across those deliveries within the hour. A separate database session holds the recipient lock while both HTTP requests wait, then releases it; the test checks that only one new challenge and one outbox event are created, the other request receives `OTP_RECIPIENT_RATE_LIMIT`, and an exact replay does not send another code.

## Boundaries

The cap is per **order recipient record**, not per phone number or person across orders. Direct privileged database inserts do not participate in the API advisory lock. This work does not resolve the post-commit channel-send failure window: only the in-process test channel exists, and live OTP is disabled. Production provider integration, abuse policies across orders, data retention and end-to-end operations still need design and review. No hosted data, migration or deployment is changed.
