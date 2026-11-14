# Cross-delivery OTP verification rate-limit consistency

The delivery OTP API limits each rider user to ten new verification attempts per rolling minute. Previously it locked the individual delivery and challenge but counted attempts across the rider's deliveries without a shared lock. Requests on distinct deliveries could both see the last available slot and exceed the cap.

The API now acquires a transaction-scoped, rider-user-keyed advisory lock after authorizing and locking the delivery/challenge and checking for an exact attempt replay. It holds that lock through the count and insert until commit or rollback. The window uses the database wall clock read after acquiring the lock, and new attempt timestamps use that same time rather than the transaction-start default. Exact replays do not consume a slot, while a changed payload with the same key still conflicts. No schema migration is required.

The integration test builds two real sequential deliveries for one rider, leaves one slot in the window, and forces concurrent attempts on different delivery rows to wait behind an independent advisory-lock holder. Once released, only one can create an attempt; the other receives `OTP_RATE_LIMIT`. It also checks replay and conflicting reuse at the limit. This is tested on a disposable PostgreSQL instance, not hosted infrastructure.

## Remaining boundaries

This lock protects participating API writers, not direct privileged database writers. It is a per-user, not per-device or global, cap; other abuse controls are still needed. The existing attempt table lacks an actor/time index, so throughput should be measured and a separately reviewed index migration considered before production scale. The recipient issue cap still counts across delivery locks without shared serialization. Production OTP remains disabled: the only channel is an in-process test sink, and challenge commit followed by channel send is not durable delivery. No real provider, hosted data changes, or deployment are included.
