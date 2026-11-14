# Cart and quote integrity / recovery

A cart line with an inconsistent server total no longer displays that amount; the subtotal is also withheld and checkout remains blocked. Invalid item currencies are flagged and block a new checkout rather than throwing while formatting or guessing a currency. Stock-only issues still leave valid prices visible. The API continues to own price, stock and cart version validation.

A quote with price, subtotal or currency discrepancies no longer displays a trusted subtotal; affected line amounts are hidden. A reserved quote with an invalid expiry is shown as unknown rather than a zero-second countdown; it remains releasable. Unknown server states do not claim stock is free. Synchronous in-flight guards prevent repeated reserve/release clicks in the same panel, while the existing idempotency and version checks remain authoritative for retries and other tabs. These changes do not implement a complete order, delivery charge, tax or payment flow.

Tests cover malformed currencies, discrepancies, invalid expiry, unknown state and duplicate clicks with mocked services. The user-facing data states still need authenticated live-backend, real-device and assistive-technology testing. No database, payment or production deployment was changed.
