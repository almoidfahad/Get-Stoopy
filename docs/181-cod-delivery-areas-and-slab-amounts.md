# Owner-provided COD delivery locations and customer fee amounts

The owner wants customers to be able to place COD orders in the following specific areas, with customer delivery charges by near/medium/far tier. These are **customer charges**, not rider earnings. This document preserves the supplied names and grouped ward labels as provided; it does not establish exact ward membership, legal boundaries, geocodes or current serviceability. The same name can appear more than once in the supplied groups. Exact spelling, location ambiguity and boundaries need confirmation before operational use.

## Mymensingh City: supplied locations

| Supplied ward grouping | Familiar place names (not individual ward assignments) |
| --- | --- |
| ১–৫ | গাঙ্গিনারপাড়, টাউন হল, নতুন বাজার, সানকিপাড়া, গোহাইলকান্দি |
| ৬–১০ | আকুয়া, কাচিঝুলি, কোর্ট এলাকা, কলেজ রোড, জিলা স্কুল রোড |
| ১১–১৫ | চরপাড়া, মাসকান্দা, কাঠগোলা, রেলওয়ে স্টেশন এলাকা |
| ১৬–২১ | ময়মনসিংহ মেডিকেল কলেজ এলাকা, বাইপাস ও আশপাশ |
| ২২–২৭ | বয়রা, সুতিয়াখালী, বেলতলী, দিঘারকান্দা, ফকিরকান্দা, আকুয়া |

Customer delivery amounts: near **৳20**, medium **৳30**, far **৳40**.

## Purbadhala Sadar: supplied locations

পূর্বধলা স্টেশন রোড; পূর্বধলা বাজার; মঙ্গলবাড়িয়া; পূর্বধলা কেন্দ্রীয় শহিদ মিনার; পূর্বধলা গার্লস হাই স্কুল রোড; রাজপাড়া রোড; পূর্বধলা সরকারি কলেজ রোড; পূর্বধলা জগৎমণি সরকারি পাইলট উচ্চ বিদ্যালয়; কুমারকালী বাজার; কলেজ মোড়, পূর্বধলা; মহিলা কলেজ রোড; আমতলা; জামতলা।

Customer delivery amounts: near **৳20**, medium **৳25**, far **৳30**. The owner explicitly states that no Purbadhala location is to exceed **৳30 under any circumstances** and all these locations should support COD. A future implementation must not charge a customer more than ৳30 in total delivery charges for an order to Purbadhala, including multi-store orders. How to select and allocate that capped fee across multiple deliveries is unresolved; until then no multi-store customer total should be derived from these amounts.

## Follow-up requirement: multiple stores and map

The owner subsequently requested COD ordering with products collected from **multiple stores** in the same order, a map showing distance, and selected that multiple riders may be used. Following a reference to a Foodpanda-like rider model, the owner confirmed a **3 km maximum**, with 0–1 km near, over 1–2 km medium and over 2–3 km far. When multiple riders are used, each delivery distance is considered separately; the owner selected that the overall customer charge for a multi-delivery order remains to be decided. This supersedes the earlier tentative selection of a single full route as the charge basis. The Purbadhala maximum customer delivery charge of ৳30 remains mandatory. Customer collection and fee allocation between deliveries require a reviewed design. The existing dispatch and delivery implementation uses one assignment per suborder and the COD accounting guard blocks unsafe multi-store dispatch (`docs/179`); it does not implement consolidated multi-pickup fulfillment. The current Google Routes adapter exposes a distance matrix, not map geometry, is disabled in production, and could incur provider charges or disclose addresses if enabled. None of these user requirements has yet been deployed.

## Unwired amount lookup; decisions still needed

`packages/core/src/cod-delivery-fee-draft.ts` is a small unexported **draft lookup and distance classifier**, with exact BDT paisa values for the six supplied combinations. The classifier accepts only an explicit nonnegative integer road distance in meters: 0–1,000 near, 1,001–2,000 medium, 2,001–3,000 far; beyond 3,000 is rejected. It does not fetch or verify a route, infer a service area from an address, select a rider, or default unknown inputs. The Purbadhala tiers individually never exceed 3,000 paisa. It is not connected to quote, checkout, dispatch, fees, payment or order creation, and does not implement the total-order cap. A separate unwired arithmetic check in `docs/184-cod-order-delivery-cap-draft.md` tests the total of explicitly supplied store-group delivery fees against that cap; it does not select fees, verify completeness or enforce the cap on live orders. Unit tests cover all six amounts, distance edges and invalid inputs. Do not treat the returned draft amount as an authoritative quote or proof of coverage.

Before a real COD order is enabled, the road-distance origin/destination and travel mode, route provider, and operational service boundaries must be specified and verified. Named localities/wards do not define polygons or reliably disambiguate addresses. Multi-store orders need an explicit rule for selecting and allocating the customer fee while respecting Purbadhala's ৳30 total cap, as well as collection allocation. Tax/other charges also need explicit treatment; no zero or other rates are assumed. An authoritative server-side implementation must validate destination and store serviceability, compute and snapshot the selected policy/fee, bind recipient and cart/quote/order, preserve idempotency and inventory, enforce currency and total, and handle cancellation/partial delivery/COD custody. Existing guards and the order test-only gate must not be removed until the entire path and isolated production infrastructure are independently verified.

No hosted database or live website was changed. Live COD remains unavailable; accepting a subtotal-only order would misstate its final amount. The supplied locality list itself does not authorize importing data into the shared Supabase project or imply all locations currently have active service coverage.
