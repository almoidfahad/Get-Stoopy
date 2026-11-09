# Serviceable-city response safety

Checkout previously trusted any successful response from the public delivery-city lookup. Missing or malformed list data could crash checkout, and wrong-market or invalid destinations could be offered to the buyer.

The web lookup now checks response structure, requested country identity, currency and truncation field types, valid and unique city IDs, nonblank names/codes, and positive safe-integer store counts. UUIDs are normalized to lowercase for reliable comparison with recovered quotes. Malformed or wrong-market results use the existing unavailable state and retry path rather than a selectable list. If a reserved quote already exists, its recovery remains available even when city data is unavailable; the city selector and new reservation remain blocked and the quote can still be released.

Local verification: 714 unit/component tests, typecheck and isolated production web build passed. Tests cover valid/empty/truncated lists, case normalization, wrong country, malformed entries, duplicate IDs, bad counts, missing fields, network failures and reserved-quote recovery. Chromium at 320, 390 and 1440 CSS pixels used synthetic cart/quote/city data to check malformed and wrong-market recovery, keyboard retry and availability of the existing quote's release control; selected Axe and overflow checks passed. No real identity, cart or delivery service was used.

This validates list structure, not current serviceability for each store in a cart; the backend must still recheck availability before reserving. It does not implement delivery fees, payment or order placement, and does not constitute full accessibility or end-to-end signoff. No Supabase connection, user database change or production deployment was performed.
