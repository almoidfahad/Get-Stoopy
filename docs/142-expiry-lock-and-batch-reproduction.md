# Checkout expiry batching and lock-order reproduction

The previously identified expiry risks have now been reproduced against the isolated PostgreSQL integration database, without changing hosted data:

1. Create a two-item reserved quote, wait until both reservations are due, and call `gs_expire_inventory_reservations(1)`. The transaction fails at commit with `checkout_quote_reservation_not_active`; the quote and both reservations remain reserved. The worker catches transaction errors and reports zero for the tick. Repeating the same undersized batch can leave stock held indefinitely.
2. Hold the quote row, start expiry until it has locked the first inventory row and is blocked by the quote synchronization trigger, then have the quote-holder request that inventory row. PostgreSQL reports deadlock `40P01`. This test uses the actual expiry function and simulates the release path's quote-then-inventory lock order with SQL; it does not claim a live HTTP release was exercised.

The original diagnostic rolled back both deadlock transactions and then expired both reservations together. It deliberately asserted the original failure behavior. Migration `0073` subsequently replaced it with positive regression tests; see `143-quote-expiry-atomicity.md` for the fix, testing, and remaining rollout limits.

A fix needs a consistent quote-before-inventory locking strategy across expiry, release and order consumption, atomic handling of all reservations in a quote even when the configured batch is smaller than its item count, and continued support for standalone reservations. It must also address overlapping worker batches, deterministic inventory ordering, bounded work, fairness and staggered reservation expiry times; a simple larger batch does not establish correctness. Any migration needs isolated verification and a deployment/rollback plan before touching hosted data.
