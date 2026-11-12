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

## Unwired amount lookup; decisions still needed

`packages/core/src/cod-delivery-fee-draft.ts` is a small unexported **amount lookup only**, with exact BDT paisa values for the six supplied combinations. It validates explicit area and tier inputs, does not infer either from an address, and does not default unknown values. The Purbadhala tiers individually never exceed 3,000 paisa. It is not connected to quote, checkout, dispatch, fees, payment or order creation, and does not implement the total-order cap. Unit tests cover all six values and invalid inputs. Do not treat the returned draft amount as an authoritative quote or proof of coverage.

Before a real COD order is enabled the owner must specify how near/medium/far is assigned: for example, a named-location mapping or measured distance, the origin, method and exact boundaries. Named localities/wards do not define polygons or reliably disambiguate addresses. Multi-store orders need an explicit rule for selecting and allocating the customer fee while respecting Purbadhala's ৳30 total cap, as well as collection allocation. Tax/other charges also need explicit treatment; no zero or other rates are assumed. An authoritative server-side implementation must validate destination and store serviceability, compute and snapshot the selected policy/fee, bind recipient and cart/quote/order, preserve idempotency and inventory, enforce currency and total, and handle cancellation/partial delivery/COD custody. Existing guards and the order test-only gate must not be removed until the entire path and isolated production infrastructure are independently verified.

No hosted database or live website was changed. Live COD remains unavailable; accepting a subtotal-only order would misstate its final amount. The supplied locality list itself does not authorize importing data into the shared Supabase project or imply all locations currently have active service coverage.
