# AI, personalization, communication and optional feature scope

**Status:** retained requirements and proposed safeguards; no AI provider, tracking, microphone access or messaging integration is enabled.

## First-party personalization

Collect only consented first-party events: product views, searches, wishlist/cart actions, purchases, explicit category interests and feedback. Guest personalization uses a first-party identifier with clear controls; authenticated cross-device sync is opt-in. Provide “Why am I seeing this?”, interest management, frequency limits, exclude category, clear history, opt out and delete/export propagation. No prechecked consent. With consent withdrawn, stop new collection and invalidate derived profiles/caches.

Homepage sections can include recently viewed, related products, saved-item price/stock alerts, reorder suggestions, trending in the selected service area and personalized deals. Cold-start uses non-personalized popular/new items. Filter by destination availability, stock, age/category policy and budget; never recommend an unavailable cross-border product as deliverable. Vendor reports use aggregates with privacy thresholds, not raw customer browsing histories.

Historical device-local interest inference is retained only as a consented, explainable first-party feature. Do not claim to read other apps, private messages, calls or ambient audio. Voice search starts only after a visible user action and browser permission; show recording state, transcript/edit/stop/delete controls and send only the intended query to the configured provider. Product sharing uses explicit share-sheet/copy-link action; it does not grant access to Facebook/WhatsApp/IMO/Viber/X conversations.

## Role-specific assistants

| Role | Allowed assistance | Sensitive boundary |
|---|---|---|
| Customer | Natural-language product search, filters/comparison, product Q&A grounded in catalog, complaint intake, own order status, reorder suggestions | No hidden purchases, price changes or access to another order |
| Vendor | Draft descriptions/alt text, image suggestions, inventory/low-stock alerts, demand/sales forecast, pricing recommendations, performance summary | Human publishes/changes price; no payout/refund/KYC execution |
| Rider | Road navigation, voice guidance, delivery priority, own earnings explanation, approved customer communication templates, SOS workflow | No covert recording, arbitrary location sharing or assignment override |
| Local/City/Regional/Country Admin | Scoped operational summaries, anomaly alerts, vendor/rider performance, compliance reminders, forecast/report drafts | Same scope as underlying data; no global cache/report leakage |
| Super Admin | Global summaries, fraud/compliance investigation assistance, policy/campaign drafts | Still cannot bypass maker–checker, ledger immutability or role-grant controls |

AI service initially lives inside the modular monolith as an application module plus worker jobs. The earlier separate AI microservice proposal is superseded by the master's modular-monolith requirement. Extract later only for measured isolation/scale need.

## Tool and approval design

Agent has its own workload identity. Effective scope = caller grants ∩ agent grants ∩ country/feature policy. Tools are typed, allowlisted, read-only by default, timeout/budget-limited and grounded in scoped services. Retrieved product descriptions, tickets and documents are untrusted data, not instructions. Redact PII before model calls where possible; provider retention/training terms require approval. Log prompt/output hashes, minimized summaries, tool calls, denials, cost and model version.

Prohibited tools: transfer/payout, refund approval, KYC approval, role/scope grant, ledger edit/delete, payment destination change. AI may create a draft proposal with exact payload hash. A human with normal permission reviews and approves through the domain command, with step-up/maker–checker where required. Approval expires and cannot be reused for a changed payload. No “approve all future actions” shortcut.

## Notifications and safety

Email, SMS, in-app and push adapters are planned; WhatsApp is outbound only through an approved business API and consent/template policy. Separate service/security messages from marketing preferences. No private-chat ingestion. Notification content minimizes recipient/KYC data and locks sensitive details behind authentication.

Rider SOS is an explicit button with confirmation where safe, current consented location, emergency contact/support routing and audit. It does not imply automatic police/ambulance dispatch or continuous off-shift tracking. Show actual available response channel; no fabricated “help is on the way.”

## Optional historical features retained

- Loyalty points, cashback, referrals and membership tiers: feature-flagged, append-only award/reversal/expiry, anti-abuse and financial liability accounting.
- Verified reviews, product comparison, vendor reliability indicators, transparent pricing and dispute/refund tracking.
- Bengali/English first; locale/country-configurable additional languages. Currency display does not imply multicurrency settlement.
- Vendor Free/Basic/Plus/Pro plans, first-year free introductory offer, volume limits and renewal history; exact commercial terms pending approval.
- Manual/hybrid courier adapter, batching/multi-pickup optimization and native mobile wrapper: later flags, not silently enabled.
- PWA install/offline shell and explicit foreground location; browser background GPS is unreliable. Native capture restrictions require a supported native app and still cannot stop another camera.

## Evaluation gates

Test consent withdrawal/deletion, guest→login merge, cross-scope retrieval, unavailable-product recommendations, prompt injection, prohibited tool denial, exact-action approval, hallucinated order/payment status, budget limits and provider outage. Measure recommendation relevance and assistant groundedness without claiming perfect predictions. Ordinary catalog/checkout must work with AI disabled.
