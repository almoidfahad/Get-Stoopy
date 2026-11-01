# GET STOOPY

## ENTERPRISE MULTI-VENDOR E-COMMERCE MARKETPLACE

### MASTER AGENTIC DEVELOPMENT INSTRUCTIONS

**Brand Name:** Get Stoopy  
**Tagline:** Shop Smart. Live Better  
**Business Model:** Multi-Vendor E-Commerce Marketplace  
**Initial Market:** Bangladesh  
**Expansion Markets:** United States → Worldwide  
**Project Type:** Enterprise-Grade, Secure, AI-Enabled, Multi-Country Marketplace

## 1. YOUR ROLE AS AN AUTONOMOUS DEVELOPMENT AGENT

Act as a complete senior software engineering team consisting of:

- Principal Software Architect
- Senior Frontend Developer
- Senior Backend Developer
- Database Architect
- UI/UX Designer
- DevOps Engineer
- Cybersecurity Engineer
- Payment Integration Engineer
- AI/ML Engineer
- QA Automation Engineer
- Performance Optimization Engineer

Your responsibility is to plan, architect, develop, test, document, and prepare the complete Get Stoopy marketplace for production.

Do not create a simple demo website.

Build a scalable, maintainable, secure, production-oriented enterprise application.

Work independently through clearly defined development phases.

Do not skip architecture, security, testing, database design, or documentation.

Do not claim that a feature is complete unless it has been implemented and tested.

## 2. BRAND IDENTITY AND DESIGN SYSTEM

Use the approved Get Stoopy homepage design as the primary visual reference.

Brand identity:

- Primary: Premium Get Stoopy Red
- Secondary: Black / Deep Charcoal
- Background: White
- Supporting: Light Gray
- Highlight: Subtle Champagne Gold where appropriate

Design rules:

- Maintain the approved homepage layout.
- Use red only for the existing red brand accents, buttons, promotional highlights, active states, and selected icons.
- Keep ordinary backgrounds white.
- Keep navigation and footer dark where shown in the approved design.
- Do not replace the approved brand identity with a green theme.
- Use consistent typography, spacing, shadows, borders, and button styles.
- Make all pages responsive for mobile, tablet, laptop, and desktop.
- Use accessible colors and keyboard navigation.
- Avoid excessive animations, unnecessary gradients, and heavy visual effects.

Brand tagline:

"Shop Smart. Live Better."

Create a reusable design system with centralized theme tokens.

## 3. SYSTEM ARCHITECTURE

Build one centralized marketplace backend and database.

Do not create separate databases for Customer, Vendor, Rider, or Admin.

Use separate role-based portals connected to the same authorized backend.

Required portals:

1. Customer Website
2. Customer Account Dashboard
3. Vendor Dashboard
4. Rider Dashboard
5. Local Admin Dashboard
6. City Admin Dashboard
7. Regional Admin Dashboard
8. Country Admin Dashboard
9. Super Admin Dashboard

Architecture requirements:

- Modular monolith initially.
- API-first design.
- Event-driven background processing where appropriate.
- Clearly separated business modules.
- Shared authentication and authorization services.
- Centralized audit logging.
- Country-specific configurations.
- Future microservice extraction should remain possible.

Do not introduce unnecessary microservices during the first development stage.

## 4. RECOMMENDED TECHNOLOGY STACK

Use the following stack unless a documented technical reason justifies a better alternative.

Frontend:

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui

Backend:

- Node.js
- NestJS or a well-structured Next.js backend architecture
- REST API with documented OpenAPI specifications

Database:

- PostgreSQL
- Prisma ORM
- PostGIS for geographic operations

Realtime:

- Redis
- Socket.IO

Background Processing:

- BullMQ

Authentication:

- Secure session-based authentication
- Auth.js or a suitable established identity provider

Storage:

- Private cloud object storage
- Encrypted document storage

Maps:

- Google Maps Platform or a suitable mapping provider

Testing:

- Vitest or Jest
- Playwright
- API integration tests
- Security testing

Infrastructure:

- Docker
- CI/CD
- Managed PostgreSQL
- Cloud monitoring
- WAF
- Encrypted backups

Pin dependency versions and maintain a dependency lockfile.

## 5. GEOGRAPHICAL HIERARCHY

Create a configurable geographic hierarchy:

Global → Country → Division / Region → District → City / Upazila → Service Zone → Neighborhood

Super Admin can create and manage all geographical areas.

Each Admin receives an assigned geographic scope.

An Admin must never access data outside their assigned scope.

Enforce geographic permissions on the backend and database query layer.

Example:

A Mymensingh City Admin cannot access Dhaka City financial records.

A Zone Admin cannot manage another Zone.

Super Admin has global access.

Use PostGIS polygon-based service-area validation.

## 6. CUSTOMER WEBSITE

Create the complete Get Stoopy shopping experience.

Required pages:

- Homepage
- Product Listing
- Product Details
- Category Pages
- Search Results
- Deals and Offers
- Wishlist
- Shopping Cart
- Checkout
- Order Tracking
- Customer Account
- Order History
- Return and Refund Requests
- Customer Support
- Privacy Policy
- Terms and Conditions

Homepage sections:

1. Brand Header
2. Search Bar
3. Navigation Menu
4. Hero Banner
5. Shop by Category
6. Promotional Banners
7. Trending Products
8. Recommended Products
9. Featured Vendors
10. Best Sellers
11. New Arrivals
12. Trust and Security Section
13. Newsletter
14. Footer

Product cards must support:

- Product image
- Product title
- Current price
- Original price
- Discount
- Rating
- Wishlist
- Add to Cart
- Stock availability

All product information must come from the database.

Do not hardcode production product listings.

## 7. CUSTOMER AUTHENTICATION

Create Login, Registration, Password Recovery, and Email Verification.

Supported authentication:

- Email and Password
- Google
- Facebook
- LinkedIn
- X/Twitter

Use secure OAuth/OIDC integrations where supported.

Requirements:

- Email verification
- Password hashing using Argon2id
- Secure session management
- Refresh-token rotation where applicable
- Account linking protection
- Login rate limiting
- Suspicious-login detection
- Password recovery
- Optional customer MFA

Never store plaintext passwords.

Social sign-in must be configured using legitimate provider credentials and approved OAuth applications.

## 8. KYC VERIFICATION SYSTEM

Create a dedicated KYC module.

Vendor KYC:

- National ID
- Profile photograph
- Trade License
- Store information
- Business information
- Verified bank or MFS account

Rider KYC:

- National ID
- Profile photograph
- Address
- Emergency contact
- Driving License when applicable
- Vehicle information when applicable

Admin KYC:

- Identity verification
- Super Admin approval
- Secure administrative account provisioning

KYC statuses:

- Pending
- Under Review
- Verified
- Rejected
- More Information Required
- Expired

Support self-service document upload and authorized office-assisted document upload.

Use encrypted private storage, restricted access, short-lived signed URLs, reviewer audit logs, and retention policies.

Use only authorized identity-verification services and lawful verification channels.

Do not scrape government identity databases.

A Vendor cannot sell until approved.

A Rider cannot accept deliveries until approved.

## 9. GOOGLE AUTHENTICATOR AND ADMIN SECURITY

Make Google Authenticator-compatible TOTP mandatory for:

- Super Admin
- Country Admin
- Regional Admin
- City Admin
- Zone Admin
- Other privileged administrative accounts

Authentication flow:

1. Email and Password
2. TOTP Verification
3. Session Risk Evaluation
4. Dashboard Access

First-time setup:

- Generate TOTP secret securely.
- Display enrollment QR code.
- Verify initial six-digit code.
- Generate recovery codes.
- Store secrets encrypted.

Additional protections:

- Email challenge for new or suspicious devices.
- Session expiration.
- Device management.
- Session revocation.
- Login history.
- Security notifications.
- Step-up authentication for sensitive actions.

Admin accounts must be created or invited by authorized administrators.

No public Admin registration.

Never allow an AI agent to bypass authentication or authorization.

## 10. CUSTOMER LOCATION AND REMOTE ORDERING

Provide two checkout options:

1. Deliver to Myself
2. Deliver to Someone Else

The Buyer and Recipient must be separate entities.

A Buyer in Dhaka must be able to order a product for a Recipient in Mymensingh if that destination is supported.

The Recipient's delivery address determines:

- Available Vendors
- Service Zone
- Delivery Fee
- Rider Eligibility
- Delivery ETA

Buyer GPS must not be required to match Recipient location.

Use buyer IP, device, GPS, and VPN indicators only as risk signals where lawful and appropriate.

Do not claim VPN detection is perfect.

Use phone verification, risk scoring, and additional verification when needed.

Initially disable cross-border ordering, but design the architecture to support future expansion.

## 11. MULTI-VENDOR ORDER MANAGEMENT

Support multiple vendors in a single customer checkout.

Create:

- One Parent Order
- Separate Vendor Suborders

Each Vendor can see only their own suborder.

Order workflow:

Customer Order → Vendor Pending → Vendor Accept / Reject → Preparation Time Set → Ready for Pickup → Rider Assignment → Pickup → In Transit → Delivered → Completed

Vendor must manually confirm Ready for Pickup.

Do not automatically mark orders ready when preparation time expires.

If a Vendor rejects an order, execute the configured refund or cancellation workflow.

Support partial cancellation and partial refund where applicable.

Use database transactions and idempotency to prevent duplicate orders and financial operations.

## 12. RIDER DASHBOARD

Create a mobile-first Rider Dashboard.

Features:

- Rider Profile
- KYC Status
- Start Shift
- End Shift
- Online / Offline Status
- GPS Location
- Delivery Offers
- Order Acceptance
- Pickup Navigation
- Customer Navigation
- Pickup Confirmation
- Delivery Confirmation
- Recipient OTP
- Delivery History
- Earnings
- COD Ledger
- Wallet
- Payout History
- Support

GPS tracking should operate only during an active shift or active delivery, subject to clear consent and privacy controls.

Use zone-based rider eligibility.

## 13. SMART RIDER DISPATCH

When Vendor confirms Ready for Pickup:

1. Find eligible online Riders in the correct service zone.
2. Calculate road-route distance from Rider to Vendor.
3. Sort eligible Riders by the configured dispatch priority.
4. Offer the delivery to the nearest eligible Rider.
5. Give the Rider 30 seconds to accept.
6. If rejected or timed out, offer it to the next eligible Rider.
7. Continue until accepted or escalation is required.

Use atomic assignment and database locking to prevent two Riders from receiving the same final assignment.

Do not rely only on straight-line GPS distance when road-route distance is required.

Use Redis and realtime events where appropriate.

## 14. RIDER DISTANCE-BASED EARNINGS

Create an Admin-controlled fixed-distance payment system.

Do not calculate extra Rider earnings from traffic, waiting time, or unrelated time spent outside delivery work.

Super Admin must configure:

- Distance slabs
- Rider payment per slab
- Minimum delivery payment
- Optional maximum payment
- Country
- City
- Service Zone
- Effective date
- Active / Inactive status

Example configuration only:

0–2 km = configurable amount

2–4 km = configurable amount

4–6 km = configurable amount

These are examples, not final business rates.

Calculate eligible delivery distance using the configured routing method.

Snapshot the applicable rate when the delivery is assigned or otherwise according to the approved pricing policy.

Do not silently change historical earnings when Admin updates future rates.

Only successful completed deliveries generate normal Rider earnings.

## 15. RIDER WALLET AND SUNDAY PAYOUT

Create a dedicated Rider Earnings Ledger.

Each successful delivery creates an earnings credit.

Maintain separate balances for:

- Delivery Earnings
- COD Cash Collected
- COD Amount Due to Company
- Verified COD Deposits
- Approved Deductions
- Pending Payout
- Paid Payout
- Withdrawable Balance

Default payout schedule:

Every Sunday.

Support:

1. Automatic Payout
2. Manual Withdrawal Request

Automatic payout should be the default enabled option, subject to a verified and supported payout destination.

Provide a separate bank-account withdrawal option.

Do not assume a Rider can receive a bank payout without providing verified bank details.

If a Rider has COD outstanding, show the adjustment transparently.

The Rider must be able to see a complete transaction history and the calculation of their withdrawable amount.

Use immutable financial ledger entries.

Do not reset a balance to zero by deleting or overwriting transactions.

## 16. COD MANAGEMENT

Support:

- Cash collected from Customer
- Cash deposited at Company Office
- Bank Deposit
- Approved Merchant MFS Deposit

Admin verifies deposits.

Maintain a complete COD reconciliation history.

Do not automatically consider an unverified deposit as paid.

## 17. PAYMENT GATEWAY

Bangladesh payment integration must support a provider adapter architecture.

Evaluate:

- SSLCOMMERZ
- amarPay
- shurjoPay

Do not assume all providers support marketplace split settlement or centralized dynamic Bangla QR.

Verify actual provider contracts, APIs, merchant eligibility, and regulatory requirements before implementing the collection and settlement flow.

Payment options:

- Online Payment
- Bangla QR, if supported by the selected acquiring provider
- Cash on Delivery

Payment requirements:

- Server-side verification
- Signed webhook verification
- Idempotency
- Payment reconciliation
- Refunds
- Chargebacks
- Failed-payment handling
- Transaction history

Never treat a screenshot as proof of payment.

For international expansion, use suitable country-specific payment providers.

Do not hardcode Stripe or any other provider as universally available.

## 18. VENDOR COMMISSION AND SETTLEMENT

Create configurable marketplace commission rules.

Commission can be configured by:

- Country
- City
- Zone
- Vendor
- Product Category
- Order Type

Support percentage-based and fixed commission rules.

Calculate commission according to the configured successful-order policy.

Default commission basis should be product subtotal, excluding delivery fee unless explicitly configured otherwise.

Vendor Dashboard must display:

- Gross Sales
- Marketplace Commission
- Refunds
- Adjustments
- Net Payable
- Pending Settlement
- Completed Settlement
- Settlement History

Vendor settlement must use verified payout destinations and authorized approval workflows.

## 19. AI PERSONALIZATION ENGINE

Create a privacy-respecting product recommendation engine.

Use permitted first-party marketplace signals:

- Product Searches
- Product Views
- Wishlist
- Cart Activity
- Purchase History
- Product Comparisons
- Category Preferences
- Explicit User Preferences

Show:

- Recommended for You
- Frequently Viewed Products
- Similar Products
- Frequently Bought Together
- Recently Viewed
- Trending in Your Area
- Personalized Deals

Use consent-based preference storage.

Allow customers to view, manage, and clear personalization data.

Do not secretly listen to phone calls or record WhatsApp, IMO, Viber, Facebook, or other applications.

Do not attempt to access private communications or microphone data from other apps.

If voice-based product search is offered, it must be an explicit user-initiated feature with microphone permission.

Use first-party website activity and authorized data sources only.

## 20. FRAUD DETECTION ENGINE

Create a configurable fraud-risk engine.

Risk signals may include:

- Repeated COD refusals
- Duplicate order patterns
- Suspicious order velocity
- Coupon abuse
- Duplicate payment indicators
- Repeated OTP failures
- Unusual account behavior
- Device and network risk indicators

Risk actions:

- Allow
- Require Verification
- Hold for Manual Review
- Reject Confirmed Fraud

Suspicious orders should be held for review rather than automatically rejected solely because of VPN usage or IP location.

Maintain:

- Risk Score
- Risk Reasons
- Evidence
- Reviewer
- Decision
- Audit History

Use rate limiting and CAPTCHA or equivalent bot protection where appropriate.

## 21. SUPER ADMIN DASHBOARD

Create a premium, fully responsive Super Admin Dashboard.

Modules:

- Global Overview
- Country Management
- Region Management
- City Management
- Zone Management
- Admin Management
- Vendor Management
- Rider Management
- Customer Management
- Orders
- Products
- Categories
- Commission Rules
- Rider Rate Configuration
- Rider Payouts
- Vendor Settlements
- COD Reconciliation
- Payment Management
- KYC Review
- Fraud Management
- AI Configuration
- Marketing
- Coupons
- Notifications
- Reports
- Audit Logs
- Security Settings
- System Health

Super Admin can manage the complete platform.

Sensitive financial, access-control, and KYC actions require appropriate authorization and audit records.

## 22. LOCAL ADMIN DASHBOARD

Create a geographically restricted Admin Dashboard.

Features:

- Regional Overview
- Local Orders
- Customers
- Vendors
- Riders
- Product Monitoring
- Complaints
- Returns
- Local Delivery Operations
- Local Reports
- Local Analytics

An Admin cannot change their own geographic scope.

Only an authorized higher-level Admin can modify assignments.

## 23. VENDOR DASHBOARD

Features:

- Store Overview
- Product Management
- Inventory
- Product Variants
- Orders
- Accept / Reject
- Preparation Time
- Ready for Pickup
- Sales Analytics
- Commission
- Earnings
- Settlement
- Customer Reviews
- Return Requests
- Store Profile
- KYC
- Support

A Vendor must only access their own business records.

## 24. CUSTOMER DASHBOARD

Features:

- My Profile
- Saved Addresses
- Wishlist
- Cart
- My Orders
- Remote Orders
- Order Tracking
- Returns
- Refunds
- Notifications
- Recently Viewed
- Personalized Recommendations
- Support
- Privacy and Personalization Controls

## 25. ADMIN DATA SECURITY

Implement defense in depth.

Requirements:

- Server-side RBAC
- Geographic ABAC
- MFA
- Session Revocation
- Secure Cookies
- CSRF Protection
- CSP
- TLS
- Rate Limiting
- Input Validation
- SQL Injection Protection
- XSS Protection
- Secure File Upload
- Encryption at Rest
- Encryption in Transit
- Audit Logs
- WAF
- Dependency Scanning
- Security Monitoring
- Encrypted Backups

Admin screenshot protection:

- Use Android FLAG_SECURE in supported native Android applications.
- Detect supported screen-capture events on iOS and mask sensitive content where possible.
- Use dynamic visible watermarks in web dashboards.
- Restrict clipboard and bulk export where practical.
- Never claim that a browser can universally prevent screenshots or external-camera capture.

Create an Emergency Security Lock that authorized Super Admins can use to revoke active privileged sessions and trigger alerts.

Do not expose sensitive database credentials or secret keys to frontend code.

## 26. AI ADMIN ASSISTANT

Create an AI assistant with role-based permissions.

It may:

- Summarize reports
- Analyze sales
- Recommend inventory actions
- Detect unusual patterns
- Draft product descriptions
- Answer routine operational questions

It must not independently execute sensitive operations such as:

- Money transfers
- Vendor payouts
- Rider payouts
- Refund approvals
- Admin permission changes
- KYC approvals
- Financial ledger modifications

Require authorized human approval for sensitive actions.

Log AI tool usage and decisions.

## 27. INTERNATIONAL EXPANSION

Start with Bangladesh.

Prepare country-level configurations for:

- USA
- Future International Markets

Each country must support its own:

- Currency
- Payment Providers
- Tax Rules
- Languages
- Admin Structure
- Service Zones
- KYC Policies
- Delivery Rules
- Settlement Rules
- Legal Configuration

Use country-specific merchant and legal arrangements.

Do not enable international cross-border checkout until the relevant operational and legal requirements are satisfied.

## 28. DATABASE DESIGN

Design normalized database models for at least:

- User
- Role
- Permission
- Session
- AdminScope
- Country
- Region
- District
- City
- ServiceZone
- Address
- Vendor
- VendorKYC
- Rider
- RiderKYC
- Customer
- Product
- ProductVariant
- Category
- Inventory
- Cart
- CartItem
- Order
- VendorSuborder
- OrderItem
- Delivery
- RiderAssignment
- RiderLocation
- Payment
- Refund
- CommissionRule
- VendorLedger
- RiderLedger
- CODLedger
- Payout
- Settlement
- KYCReview
- FraudCase
- Notification
- ProductInteraction
- AuditLog

Use foreign keys, indexes, constraints, transaction boundaries, and suitable data-retention rules.

Use immutable ledger entries for financial transactions.

Prepare an ERD before implementing the complete database.

## 29. PERFORMANCE AND RELIABILITY

The website must be designed for speed and reliability.

Requirements:

- Server-side rendering where appropriate
- Optimized images
- Responsive image sizes
- Lazy loading
- Code splitting
- Database indexing
- Query optimization
- Pagination
- Caching
- CDN
- Background jobs
- Error monitoring
- Structured logging
- Graceful error handling

Avoid unnecessary client-side JavaScript.

Do not load every product or every order at once.

Use pagination and efficient APIs.

Do not claim zero latency or zero bugs.

Define measurable performance budgets and test them.

## 30. DEVELOPMENT PHASES

Execute development in the following order.

### PHASE 1 — Discovery and Architecture

- Requirements review
- Architecture diagram
- ERD
- Role and permission matrix
- Geographic model
- API specification
- Security threat model

### PHASE 2 — Foundation

- Repository setup
- Design system
- Database
- Authentication
- Authorization
- Logging
- Infrastructure configuration

### PHASE 3 — Customer Website

- Homepage
- Search
- Categories
- Products
- Cart
- Checkout
- Customer Account

### PHASE 4 — Vendor System

- Vendor registration
- KYC
- Store management
- Product management
- Order processing
- Settlements

### PHASE 5 — Rider System

- Rider registration
- KYC
- GPS
- Dispatch
- Delivery workflow
- Earnings ledger
- COD
- Sunday payout

### PHASE 6 — Admin Systems

- Super Admin
- Country Admin
- Regional Admin
- City Admin
- Zone Admin

### PHASE 7 — Payments and Finance

- Gateway adapters
- COD
- Commission
- Refunds
- Settlements
- Payout reconciliation

### PHASE 8 — Security and Fraud

- MFA
- KYC controls
- Fraud engine
- Audit logging
- Security monitoring

### PHASE 9 — AI Features

- Recommendations
- Search assistance
- Analytics
- Admin assistant

### PHASE 10 — Quality Assurance

- Unit tests
- Integration tests
- End-to-end tests
- Permission tests
- Payment tests
- Security tests
- Performance tests

### PHASE 11 — Deployment Preparation

- Production configuration
- CI/CD
- Monitoring
- Backups
- Disaster recovery
- Documentation
- Deployment checklist

## 31. AGENTIC EXECUTION RULES

Follow these rules throughout development:

1. Inspect the existing repository before modifying it.
2. Preserve existing working features.
3. Never overwrite user data without approval.
4. Never expose production secrets.
5. Use environment variables for credentials.
6. Generate migrations instead of manually changing production databases.
7. Run tests after meaningful changes.
8. Fix errors before moving to the next phase.
9. Maintain a development progress document.
10. Keep an architecture decision record.
11. Document incomplete integrations.
12. Do not fabricate successful payment transactions.
13. Do not use mock data as real production data.
14. Clearly label demo data.
15. Never deploy to production without explicit authorization.
16. Ask for approval before creating paid cloud resources, registering paid services, or enabling real payment collection.
17. Do not disable security controls to make tests pass.
18. Keep the application accessible and maintainable.
19. Use feature flags for unfinished or country-specific features.
20. Do not mark a phase complete until its acceptance tests pass.

If a required API credential or provider agreement is missing, create a secure integration interface and document what is needed. Do not invent credentials or pretend the integration is live.

## 32. REQUIRED DELIVERABLES

Produce:

1. Complete Source Code
2. Frontend Application
3. Backend Application
4. Database Schema
5. Database Migrations
6. ERD Diagram
7. Architecture Diagram
8. API Documentation
9. Role and Permission Matrix
10. Security Documentation
11. Payment Integration Documentation
12. KYC Workflow Documentation
13. Rider Earnings and Payout Documentation
14. Admin User Guide
15. Vendor User Guide
16. Rider User Guide
17. Environment Variable Template
18. Docker Configuration
19. CI/CD Configuration
20. Automated Test Suite
21. Deployment Guide
22. Backup and Recovery Guide
23. Production Readiness Checklist

## 24. FINAL ACCEPTANCE CRITERIA

> Source numbering retained: the supplied master script labels this section 24 after section 32. It is treated as the final acceptance section, not a replacement for section 24.

The project is not complete until:

- Customers can register, log in, browse, search, and place orders.
- Multiple vendors can receive their respective suborders.
- Vendors can accept, prepare, and mark orders ready.
- Eligible riders can receive and complete deliveries.
- Recipient OTP verification works.
- Rider earnings are calculated using Admin-configured distance slabs.
- COD and earnings are independently reconciled.
- Sunday payout scheduling works under verified payout conditions.
- Vendor commission and settlement calculations work.
- KYC review and authorization work.
- Admin TOTP authentication works.
- Geographic access restrictions are tested at the API level.
- Customer remote ordering works.
- Fraud review workflows work.
- Sensitive actions are audited.
- Payment webhooks are verified and idempotent.
- The responsive design matches the approved Get Stoopy brand.
- Automated tests pass.
- Production deployment requirements are documented.

**END OF MASTER DEVELOPMENT INSTRUCTIONS**

## Bengali instruction accompanying the script (retained wording)

আচ্ছা স্ক্রিনশটে এর ফিচারগুলা এড করা নেই, এই জিনিসটারে তুমি এড করে দিবে যে যে ফিচারগুলো উল্লেখ করা আছে, একটা ইনফরমেশনও যেন মিছ আউট না হয় তাহলে কিন্তু অনেক বড় লস হয়ে যাবে, তুমি প্রত্যেকটা ইনফরমেশন রিট করে এবং তোমাকে আমার চ্যাট ডিভিডির কনভারসেশনও দিয়েছি সেগুলো ফলো করবে এবং স্ক্রিপ্টটা দিয়েছি সেটাও ফলো করবে ইনফরমেশনও যেন মিস না যায়। আর সিকিউরিটির বিষয়টা তো সব সময় মাথায় রাখতে হবে তোমার আর কন্টাকনোলজি দিয়ে করবে সেটাও বলা আছে।

## Fidelity note

This is a normalized reconstruction from the supplied task context, checked against the recovered conversation; the original master attachment/message was not independently archived, so byte-for-byte fidelity is not certified. The original section numbering is retained, including the final acceptance section labelled 24 after section 32. Reference-image statistics, prices and claims are inventoried separately; they are not approved production configuration.
