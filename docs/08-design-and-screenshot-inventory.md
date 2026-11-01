# Approved design and screenshot feature inventory

**Status:** visual requirements, not a claim that screens work. Original uploads remain unchanged; hashes/dimensions are in `../contracts/source-manifest.json`. Sample content is never production data.

## Brand and responsive rules

Retain the supplied Get Stoopy shopping-bag G logo, wordmark and “Shop Smart. Live Better.” identity. Recreate approved composition with semantic responsive components, not one stretched screenshot. Obtain original vector logo/photography rights before production; do not invent trademark registration from the ™ symbol.

- White ordinary page/content backgrounds; light-gray supporting surfaces; black/deep-charcoal top navigation/footer and portal sidebars; red brand accents, primary actions, promotions, selected icons and active navigation; restrained champagne-gold highlights.
- Do not turn the whole application red or reintroduce the rejected green theme. Green may remain a small semantic success/online indicator, not the brand theme. The rider reference's green toggle becomes red active styling while preserving an accessible text state.
- Proposed tokens, to verify against original brand assets: `brand.primary #B30D1B`, hover `#8F0A15`, ink `#15171A`, surface `#FFFFFF`, muted `#F5F6F8`, border `#E2E5E9`, champagne `#C6A56B`. These are implementation proposals, not measured exact screenshot colors. Test contrast; use dark red for small text/links where needed.
- Centralized typography/spacing/radius/shadow/focus tokens; shared buttons, forms, tables, cards, dialogs, toasts, skeletons, empty/error states and chart components. Use shadcn/ui accessibility primitives; Bengali font coverage and English/Bengali line heights tested.
- Desktop reference layout; tablet reflow; mobile drawer/bottom navigation where appropriate, stacked cards, horizontally scrollable tables with labels, sticky primary action only when it does not obscure content. Keyboard focus, labels, errors, reduced motion, screen-reader chart summaries and touch targets are acceptance requirements.
- Restrained chart/hero transitions only; no heavy animation. Recharts is a candidate retained from history; exact dependency/version selected in Phase 2. Product images require alt text and explicit dimensions.

## 1. Homepage — `file_00000000ed6082109834425a8eadf979.png`

| ID | Visible element / exact sample content | Implementation requirement / qualification |
|---|---|---|
| UI-H01 | Top strip: Global Shipping; Secure Payment; 24/7 Support; Welcome to Get Stoopy!; Login / Register; US flag / EN | Configurable announcement and locale; show only verified service/support claims. BD launch does not claim global shipping. |
| UI-H02 | Get Stoopy G bag logo, tagline; product search; red search button; Wishlist (0); Cart (0) | Reusable header; authenticated counts from database; guest cart/wishlist behavior; search suggestions/keyboard support. |
| UI-H03 | Dark navigation: All Categories; Home; Shop; Deals; About Us; Blog; Track Order; Contact | Database categories and accessible dropdowns; CMS/static legal/about pages; tracking route; no dead links. |
| UI-H04 | Hero shopping imagery, Get Stoopy, tagline, Your Trusted Online Store!, Discover a World of Amazing Products with Unbeatable Prices!, Shop Now | Approved composition; manageable banner content; honest superlatives/copy approval; CTA to eligible catalog. |
| UI-H05 | Hero UP TO 70% OFF; Limited Time Offer!; Fast Delivery truck; three carousel dots | Configurable campaign with actual qualifying products, dates and discount basis; keyboard/touch carousel, pause/reduced motion; ETA not a universal promise. |
| UI-H06 | Electronics; Fashion; Home & Living; Beauty & Care; Sports & Fitness; Toys & Games; Health & Wellness; More Categories | Category navigation with icons/images; regulated categories gated; category tree managed by authorized admin. |
| UI-H07 | Smart Shopping Bigger Savings — Up to 50% OFF; watch image; Shop Now | Configurable promotion placement and eligibility; no hardcoded discount. |
| UI-H08 | Free Shipping On All Orders; gift/truck artwork; Shop Now | Retain layout but only display when campaign genuinely covers all shown items; otherwise exact eligibility wording. Rider cost still funded. |
| UI-H09 | Secure & Easy Payment; Visa, Mastercard, PayPal; shield; Shop Now | Show only contracted/enabled payment methods; PayPal is not a BD launch commitment. |
| UI-H10 | Our Collection; Trending Products; View All Products | Server-driven trending/popular section with destination/country filtering; paginated catalog link. |
| UI-H11 | Wireless Earbuds Bluetooth 5.3; −40%; $29.99 / $49.99; 4.8 (12k reviews) | Product card image/title/price/compare price/discount/rating/review count; all sample values replaced by actual catalog data. |
| UI-H12 | Smart Watch Health Tracker; −25%; $59.99 / $79.99; 4.7 (8k reviews) | Product detail/variant selection; no unsupported medical claims; actual reviews. |
| UI-H13 | Running Shoes Ultra Light; −35%; $45.99 / $69.99; 4.8 (10k reviews) | Size/variant stock and truthful compare-at pricing. |
| UI-H14 | Air Fryer Digital 6L; −30%; $69.99 / $99.99; 4.7 (7k reviews) | Variant/specification/stock and delivery eligibility. |
| UI-H15 | Travel Backpack Waterproof; −20%; $39.99 / $49.99; 4.8 (9k reviews) | Product claims require vendor evidence; no fabricated rating. |
| UI-H16 | Each product card: heart, Add to Cart | Persist wishlist after login; cart quantity/stock feedback; accessible button labels; no fake success. |
| UI-H17 | Trust strip: 100% Secure Shopping; 24/7 Customer Support; Easy Return & Refund; Worldwide Shipping | Layout retained; avoid absolute security guarantee; publish actual support hours, return conditions and supported destinations. |
| UI-H18 | Newsletter: Subscribe to Our Newsletter; Get the latest updates, offers, and more.; email field; Subscribe | Consent/double opt-in proposal, validation, unsubscribe, rate limiting; no purchased mailing lists. |
| UI-H19 | Footer logo/tagline; Your Trust Our Priority; Facebook, YouTube, Instagram, LinkedIn, X | Only real approved social links; outbound sharing is explicit, not private-message access. |
| UI-H20 | Quick Links: Home, Shop, About Us, Blog, Contact | Working routes and content management. |
| UI-H21 | Customer Care: FAQs, Shipping Policy, Return Policy, Track Order, Support | Actual policies and support/tracking workflows. |
| UI-H22 | Get in Touch: +1 (555) 123-4567; support@getstoopy.com; 123 Innovation Drive, New York, NY 10001 | Visual placeholders only; replace with verified business contact/address before publication. |
| UI-H23 | We Accept: Visa, Mastercard, PayPal, Stripe | Capability-driven logos; Stripe/international availability not assumed. |
| UI-H24 | © 2025 Get Stoopy; tagline; Privacy Policy; Terms & Conditions; Security; back-to-top | Dynamic/configured legal entity/year; real policies; accessible back-to-top. Historical year not a launch date. |
| UI-H25 | Additional master-required sections not visible in mockup | Deals, recommendations/recently viewed, consent controls, remote-recipient checkout, support/returns and localization added without changing approved visual language. |

## 2. Login / signup — `file_00000000eaf48210a2930dd3061eba38.png`

| ID | Visible element / exact sample content | Implementation requirement / qualification |
|---|---|---|
| UI-L01 | Get Stoopy logo/tagline; Your Trusted Online Store!; Shop Smart, Live Better with Get Stoopy; shopping imagery | Preserve brand composition; responsive form-first mobile layout. |
| UI-L02 | Benefits: Wide Range of Products; Fast & Reliable Delivery; Secure Payment; 24/7 Customer Support | Verified claims only; same configurable policy source as homepage. |
| UI-L03 | Shop with Confidence — Your Safety is Our Priority; Visa/Mastercard/PayPal/Stripe | Do not display unsupported payment logos; security copy avoids absolute guarantees. |
| UI-L04 | English selector | English/Bengali locale; translated validation/security messages. |
| UI-L05 | Login / Sign Up tabs; Welcome Back!; Sign in to your Get Stoopy account | Accessible tabs and distinct registration flow; no public admin registration. |
| UI-L06 | Continue with Google; Continue with Facebook; Continue with Apple | Google/Facebook specified; Apple is an inventoried optional addition. LinkedIn/X from master must also be supported when provider apps are approved. |
| UI-L07 | OR; Email Address; Password; eye icon | Labels/autocomplete, password manager compatibility, explicit show/hide accessible state; Argon2id in identity provider. |
| UI-L08 | Remember me (checked in image); Forgot Password? | Remember-me is a bounded session policy, not unlimited trust; do not precheck by default without review. Secure recovery does not bypass privileged MFA. |
| UI-L09 | Red Login button; Don't have an account? Sign Up | Loading/error/rate-limit states; generic auth errors; role application after customer account creation. |
| UI-L10 | Footer copyright/tagline; Privacy Policy; Terms & Conditions; Support; social icons | Real content/links and verified company details. |
| UI-L11 | Not pictured: verification, TOTP, device challenge, recovery | Add email verification, admin Google Authenticator-compatible enrollment/login, suspicious-device email challenge, recovery codes, session/device management and KYC gates. |
| UI-L12 | Signup fields not shown in login tab | Design name/email/password/confirm, policy consent and optional marketing opt-in; vendor/rider/admin paths branch to appropriate KYC/provisioning, not self-granted roles. |

## 3. Admin dashboard — `file_000000001458821082c41adcad8398e0.png`

| ID | Visible element / exact sample content | Implementation requirement / qualification |
|---|---|---|
| UI-A01 | Logo/tagline; Admin Panel; Rahman Hossain; Online; collapsible dark sidebar | Shared shell for Super/Country/Regional/City/Zone/Local scopes; menu filtered but backend still authoritative. |
| UI-A02 | Global search orders/customers/products; notification badge 5; fullscreen; EN; Admin menu | Scope-filtered search and notifications; locale/session/device controls; fullscreen is optional convenience, not security. |
| UI-A03 | Welcome Back, Rahman Hossain!; Here's what's happening with your store today.; Apr 23, 2025 – Apr 29, 2025 | Real actor/scope label and date-range picker; replace single-store wording for marketplace admin. |
| UI-A04 | Total Orders 3,248 +12.5%; Total Customers 12,580 +8.7%; Total Vendors 845 +10.2%; Total Riders 620 +14.1%; Total Revenue $48,750 +16.8% | Scoped aggregate queries with comparison periods/currency; no sample values or cross-scope totals. |
| UI-A05 | Sales Overview; Last 7 Days; $48,750; +16.8%; Mon $12k, Tue $15k, Wed $14k, Thu $16k, Fri $18k, Sat $20k, Sun $24k | Recharts-style accessible chart; bars sum to $119k, not $48,750—mockup inconsistency must not be reproduced. |
| UI-A06 | Order Status: 3,248; Delivered 62.3%, Pending 18.7%, Processing 11.5%, Cancelled 7.5% | Mutually exclusive current-state aggregation; distinguish payment/delivery/return states. |
| UI-A07 | Regional Overview; View Details; world map; Countries 48, Cities 320, Zones 1,240 | Actual enabled geography only; BD pilot map, not fictional worldwide coverage; drill-down within scope. |
| UI-A08 | Sidebar Dashboard, Orders (24), Customers, Vendors, Riders, Products, Categories, Finance & Payouts, Complaints, Reports, Marketing, Settings, Security, Support | Permission-scoped modules; vendor/rider/KYC/geography/audit/export functions added where absent from mockup. |
| UI-A09 | Recent Orders #GS1001–#GS1005; Johar Smith/$59.99/Delivered/2m; Running Shoes/$45.99/Processing/5m; Ahmed Khan/$39.99/Pending/8m; Wireless Earbuds/$29.99/Delivered/12m; Travel Bag/$49.99/Cancelled/15m | Real paginated table with product/amount/status/time and authorized detail links; inconsistent person/product column treated as mock layout, not data schema. |
| UI-A10 | Top Categories: Electronics 28.5%, Home & Living 24.1%, Sports & Fitness 20.3%, Toys & Games 14.7%, Beauty & Care 12.4%; View Report | Actual category aggregates; define revenue/order basis and period. |
| UI-A11 | System Health: All Systems Operational; Server Uptime 99.9%; Database Healthy; Payment Gateway Healthy; API Response Time 120ms | Live health/metrics only; no fabricated uptime or healthy provider state. Operational status is separate from business permission. |
| UI-A12 | Quick Actions: Manage Products; Manage Customers; View Reports; Manage Settings; Security Logs | Route to authorized modules; privileged actions require step-up; hide/disable unavailable operations with explanation. |
| UI-A13 | Get Stoopy Support 24/7 Online; Contact Support; footer copyright/tagline | Actual support channel/hours; no hardcoded availability claim. |
| UI-A14 | Required extensions not pictured | KYC queues, geographic assignment, rate/commission versions, COD reconciliation, payout maker–checker, fraud review, audit/export approvals, AI assistant, emergency lock and country flags. |

## 4. Vendor dashboard — `file_000000001fd08210b38f6b50c3a01087.png`

| ID | Visible element / exact sample content | Implementation requirement / qualification |
|---|---|---|
| UI-V01 | Logo/tagline; TechMart Store; Vendor; Online; store selector; View Store | Vendor/store membership switcher; public store preview; KYC/subscription status visible. |
| UI-V02 | Search products; notifications 5; fullscreen; EN; Welcome Back, TechMart Store!; Grow your business with Get Stoopy. | Own-store search/notification scope; locale and accessible shell. |
| UI-V03 | Total Orders 245 +12.5%; Total Sales $12,580 +16.8%; Total Earnings $8,420 +14.1%; Store Rating 4.8 | Actual store/vendor metrics; define gross sales vs net earnings; currency from ledger. |
| UI-V04 | Sales Overview; Last 30 Days; $12,580; +16.8%; Mon–Sun bars; final $2.8k | Period-consistent chart; weekday labels in reference do not represent 30 daily points. Use correct dates/buckets and accessible summary. |
| UI-V05 | Order Status: 245; Delivered 68.6%, Processing 18.4%, Pending 13.0% | Current vendor suborder states; partial cancellation/return states added. |
| UI-V06 | Recent Orders: #GS1001 John Smith $59.99 Delivered Apr 29 10:45 AM; #GS1002 Maria Garcia $45.99 Processing Apr 29 09:20 AM; #GS1003 Ahmed Khan $39.99 Pending Apr 29 08:50 AM; #GS1004 Sarah Johnson $29.99 Delivered Apr 28 05:30 PM | Own-store suborders only; minimum recipient data; accept/reject, preparation estimate and manual ready actions. |
| UI-V07 | Sidebar My Products, Inventory, Orders (24), Sales & Earnings, Settlement, Reviews & Ratings, Marketing Tools, Coupons, Return Requests, Profile Settings, Store Settings, Support | All corresponding modules; add KYC, staff/permissions, branch/service areas, subscription and payout destination. |
| UI-V08 | Top Selling Products: Wireless Earbuds Bluetooth 5.3 850 Sold; Smart Watch Health Tracker 720; Running Shoes Ultra Light 580; Travel Backpack Waterproof 420; View All | Actual quantities/period and product links; no seeded production sales. |
| UI-V09 | Earnings Overview; This Month; $8,420; +14.1%; Week 1–4; final $1.2k | Gross/commission/refund/adjustment/net breakdown; pending/available/paid settlement; period totals must reconcile. |
| UI-V10 | Store Performance 92% Store Health; On-Time Delivery, Customer Satisfaction, Product Quality, Response Rate, Store Activity; Improve Your Performance | Define transparent metric formulas; separate vendor-controlled preparation from rider transit; actionable recommendations, not punitive opaque scoring. |
| UI-V11 | Support card and red performance CTA | Real support and performance report routes. |
| UI-V12 | Required extensions not pictured | Product variants/images/moderation, stock reservations/low stock, bulk import validation, first-year plan/trial status, AI drafts, verified destination and settlement history. |

## 5. Rider dashboard — `file_00000000a7508210a16ca15694141f4f.png`

| ID | Visible element / exact sample content | Implementation requirement / qualification |
|---|---|---|
| UI-R01 | Logo/tagline; Rider; Fahim Ahmed; Online; Welcome Back, Fahim Ahmed!; Keep going! You're doing great today. | Real rider identity/KYC status; mobile-first shell; encouragement never obscures safety. |
| UI-R02 | Search orders or customers; notification badge 3; fullscreen; EN; Fahim menu | Own assignments only; no arbitrary customer lookup; locale/session controls. |
| UI-R03 | On Duty toggle (green in reference) | Consent-backed shift start/end; red brand active state; active delivery handled safely before off-duty; location permission explanation. |
| UI-R04 | Completed Deliveries 36 +12.5%; Total Earnings $142.50 +14.8%; Active Deliveries 1 +0.0%; Rating 4.9 | Actual period metrics; one active delivery default; earnings distinct from COD. |
| UI-R05 | Live Delivery; map/route; On the way 2.8 km; ETA 8 min; View Details | Consented assignment-scoped map, road route/freshness, honest ETA; no continuous off-shift tracking. |
| UI-R06 | Pick Up From Pizza House, 123 Main Street; Deliver To John Smith, 456 Park Ave; Navigate with Maps | Actual store/recipient snapshots; minimum contact data; explicit navigation action; sample addresses not real. |
| UI-R07 | My Wallet; $87.50; Withdraw; View History; Last Payout Apr 26, 2025 +$120.00 | Withdrawable earnings, pending/reserved/paid, COD due/deposits, verified destination and Sunday schedule; not a mutable wallet amount. |
| UI-R08 | Quick Actions: Go Online (If Offline), Pause Deliveries, View Map, Contact Support | Shift/new-offer controls; pause does not abandon active delivery; real support. Add explicit SOS with available response channel. |
| UI-R09 | Recent Deliveries: #DS1001 Pizza House→John Smith, Today 10:24 AM, Completed, $12.50; #DS1000 KFC→Maria Garcia, Today 09:50 AM, Completed, $15.00; #DS0999 Grocery Mart→Ahmed Khan, Today 08:20 AM, Delivered, $18.00 | Own history, status distinction and immutable earning snapshots; recipient details minimized after completion. |
| UI-R10 | Rider Performance; This Month; 95% On-Time Delivery; Acceptance Rate 98%, Completion Rate 95%, Customer Rating 4.9, Total Distance 120 km; Great Performance! Keep it up! | Defined formulas/periods; no traffic/wait-time bonus; fairness/appeal for exceptions. |
| UI-R11 | Sidebar Dashboard, Delivery Offers (5), My Deliveries, Earnings Wallet, Payout History, Performance, Ratings & Reviews, Support, Settings, Logout | Offer list is sequential per delivery, not five simultaneous assignments; 30-second server countdown and expired/rejected states. |
| UI-R12 | Required extensions not pictured | KYC/vehicle/expiry, zone grants, location consent/accuracy, pickup confirmation, recipient OTP, COD collection/deposit evidence, payout destination, device/security and PWA limitations. |

## Conflict resolution and visual acceptance

Final master + later explicit corrections win: red/white/black identity, recipient-first remote ordering, manual ready, fixed store→recipient distance pay, no traffic/wait bonus, Sunday automatic payout, mandatory privileged TOTP, consented personalization and no autonomous sensitive AI actions. Historical assistant suggestions do not override these.

Phase 2/3 visual review must compare desktop/tablet/mobile renders with the approved references, verify original logo asset/rights, keyboard/screen-reader behavior, Bengali/English text overflow, real empty/error/loading states and truthful capability-driven copy. No visual approval is claimed by this inventory.
