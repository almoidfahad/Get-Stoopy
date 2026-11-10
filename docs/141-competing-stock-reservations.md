# Competing checkout stock reservations

The checkout integration suite now forces two different buyers with separate carts to compete for one remaining unit. A held inventory row makes the requests overlap; one must receive a reserved quote and the other an `INSUFFICIENT_STOCK` conflict. The test checks one active reservation and quote, bounded inventory, and release returning the unit to stock. It exercises the actual API, PostgreSQL locks, reservation movements and deferred constraints, not payment or order completion.

## Follow-up risk identified by source review

The expiry routine processes individual due reservations up to a batch limit, while deferred quote consistency requires all reservations for a reserved quote to remain active or all to be closed. A batch that reaches only part of a multi-item quote may therefore roll back at commit; separately, expiry locks inventory before the quote synchronization trigger locks the quote, whereas user release locks the quote before inventory. That opposite order may lead to a deadlock under overlap. These are source-level risks, not yet reproduced in this increment. They require deterministic PostgreSQL regressions and a carefully reviewed lock-order/batch fix before relying on expiry in production. The new last-unit test does not address them.

No hosted database or production deployment was changed.
