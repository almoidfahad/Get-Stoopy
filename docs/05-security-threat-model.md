# Security threat model and verification plan

**Status:** proposed controls; none claimed implemented or penetration-tested. Review date: 2026-11-01.

## Assets and trust boundaries

Assets: identity credentials/TOTP/recovery codes, privileged sessions, NID/passport/trade/driving documents, bank/MFS destinations, buyer/recipient PII, rider live location, order/inventory integrity, provider credentials, immutable journals, payout instructions, audit evidence, consent/preferences and backup keys.

Boundaries: browser→BFF; BFF→API; identity redirect; API→DB/Redis/object store; provider callbacks; admin→KYC; worker→payment/payout; AI→tools; export→download; logs/telemetry; public CDN→private storage. A frontend role label, uploaded document, GPS coordinate, payment screenshot, QR scan or AI output is never proof of authorization/payment/identity by itself.

## Threat register

| ID / priority | Threat and attack path | Required prevention/detection | Acceptance evidence |
|---|---|---|---|
| T01 Critical | Vendor/customer/admin IDOR via guessed IDs, search, export or socket room | Server RBAC + ownership + geographic ABAC; scoped repository/RLS; field projection; room authorization | Cross-tenant/cross-city API, socket, export and aggregate tests |
| T02 Critical | Admin credential theft or public admin registration | Invitation/provisioning only; verified identity; mandatory TOTP; new-device challenge; risk evaluation; session/device revocation | Admin cannot reach dashboard with password only; enrollment/recovery/revocation tests |
| T03 Critical | OAuth account takeover by matching unverified email or altered callback | OIDC code+PKCE, state/nonce, exact redirect allowlist, issuer/subject identity; no automatic email-only merge; proof-based linking | Forged state, wrong issuer, duplicate email and unverified provider-email tests |
| T04 Critical | Duplicate order/assignment/earning/payout under retries or concurrency | DB transactions, unique business keys, row locks, version checks, balanced append-only journals, outbox/inbox | Parallel requests and worker replay produce one financial effect |
| T05 Critical | Fake provider callback, replay, amount/currency substitution or success-page spoof | Provider-specific authenticity verification + server transaction query; exact merchant/order/amount/currency; unique event key | Tampered/replayed/out-of-order callbacks never mark paid twice |
| T06 Critical | Payout destination substitution / insider transfer fraud | Verified ownership, masked details, step-up, change cooldown, maker–checker, destination snapshot, provider idempotency | Same maker/checker rejected; changed destination holds payout |
| T07 Critical | KYC document leak via public bucket, long-lived URL, logs or other reviewer | Private encrypted quarantine/active buckets, short-lived signed access, no indexing, scoped reviewer assignment, read audit, retention job | Unauthorized direct/signed URL and cross-scope reviewer tests; expiry/scanning evidence |
| T08 High | SQL injection / unsafe raw PostGIS query / RLS context leakage in pool | Parameterized SQL, allowlisted sort/filter, least-privileged runtime, SET LOCAL context, no BYPASSRLS | Injection fixtures and pooled concurrent-scope tests |
| T09 High | XSS/CSRF/clickjacking on admin or storefront | Contextual escaping, sanitization, CSP nonce, no dangerous HTML, Secure/HttpOnly/SameSite cookies, origin checks + CSRF tokens, frame policy | Script payload and cross-origin mutation tests; security-header scan |
| T10 High | Upload malware, SVG script, decompression bomb, content-type spoof | Size/page/dimension limits, magic-byte validation, reject active formats, antivirus quarantine, image re-encode, metadata stripping | Malformed/oversized/mislabelled files rejected before review |
| T11 High | Refresh/session replay, fixation, stale permissions | Opaque high-entropy token hashed at rest; rotate on login/privilege change; provider refresh rotation; authorization version; idle/absolute expiry | Stolen old token and revoked-session API/socket rejection |
| T12 High | TOTP brute force/replay/reset abuse | Encrypted provider secrets, rate limits, short time window, consumed-step protection, single-use hashed recovery codes, step-up for reset | Replayed code and repeated failure lockout tests; no secret in logs |
| T13 High | COD deposit falsification, double allocation or deleting weekly debt | Separate custody ledger; verified office/bank/merchant MFS evidence; allocation caps; immutable reversal; reconciliation | Unverified screenshot never reduces due; duplicate deposit rejected |
| T14 High | Rate/commission tampering or retrospective repricing | Server-only effective versions, scope precedence, snapshots, future edits, overlap checks, approval/audit | Boundary distances/time zones and historical-rate invariance tests |
| T15 High | Fake order/coupon/bot/OTP abuse | Risk rules, velocity controls, verified phone where needed, CAPTCHA adaptively, stock/coupon limits, manual review/appeal | VPN-only signal holds/verifies rather than blanket rejection; confirmed fraud evidence required |
| T16 High | Buyer/recipient GPS confusion and location spoofing | Recipient address authoritative for service; separate buyer risk; accuracy/freshness checks; no perfect VPN/GPS claim | Remote-order positive test and mocked/stale location risk test |
| T17 High | Live rider location exposed after shift or to unrelated customer | Consent + active shift/delivery gate, assignment-scoped room/token, expiry, stop tracking on end, short raw retention | Offline rider cannot upload; unrelated/old token cannot subscribe |
| T18 Critical | AI prompt injection causes payout, KYC approval or data exfiltration | Separate agent identity; caller∩agent scope; read-only allowlist; untrusted retrieval content; no sensitive tools; exact-action human approval | Injected instructions cannot call prohibited tool or widen report scope |
| T19 High | Personalization becomes covert surveillance | First-party consent only; no call/microphone/other-app collection; explicit voice/search/share; view/clear/opt-out/sync controls | Denied consent stops events; deletion propagates to profiles/caches |
| T20 High | Bulk insider export or screenshot leakage | Data minimization/masking, export permission+approval, watermark/session trace, clipboard restrictions on sensitive fields, native controls where supported | Export audit/approval; watermark verified; documented browser limitations |
| T21 Critical | Compromised admin persists after incident | Emergency Security Lock revokes privileged sessions/tokens/rooms, pauses privileged jobs, bumps auth version, alerts security | Revocation propagation test and break-glass recovery drill |
| T22 High | Dependency/CI/secret compromise | Exact pins+lockfile, scan/SBOM, protected CI identity, secret manager, reviewed infra changes, artifact signing, least privilege | No frontend secrets; dependency and IaC gates enforced |
| T23 High | Backup loss, ransomware, destructive migration | Encrypted immutable/offline copies, separate backup credentials, PITR, migration backup gate, restore drills, ledger reconciliation | Documented measured RPO/RTO and restore integrity report |
| T24 High | Country/feature flag accidentally enables cross-border/live payments | Default false, environment separation, capability+legal gates, two-person activation, audit | BD-only checkout; US/cross-border/live provider negative tests |
| T25 Medium | Enumeration, scraping, business intelligence leak | Generic auth/recovery responses, rate limits, pagination, bot protection, public/private DTO split, scoped totals | No account-existence or hidden-scope count leakage |

## Authentication and sessions

Proposed browser flow: same-origin BFF → identity Authorization Code + PKCE → validated callback → encrypted server token envelope → opaque session cookie. API resolves session and current authorization on every request. Cookie: `__Host-` prefix where appropriate, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain; explicit CSRF/Origin protection for mutations. No tokens in localStorage, URLs, analytics or error reports.

Admin: password + Google Authenticator-compatible TOTP every login; initial QR enrollment and initial code verification; recovery codes shown once; new/suspicious device email challenge; session risk evaluation; KYC/provisioning approval before access. Historical “Gmail every login” is implemented as risk-based email challenge per final master, not sending a code to every login regardless of risk. Sensitive operations require recent TOTP step-up bound to exact action. Customer MFA optional; ordinary customer shopping does not require NID KYC.

Argon2id parameters must be explicitly configured and benchmarked, not accepted blindly from an identity-provider default. Start with a tested memory-hard profile around 64 MiB, tuned to infrastructure; record final parameters and login latency. Use a breached-password check where lawful, generic errors, per-account/IP limits and a recovery flow that does not bypass MFA. Identity provider owns secrets; application stores references/assurance, never plaintext passwords or TOTP seeds.

Proposed privileged idle timeout 15 minutes, absolute 8 hours; customer idle 7 days/absolute 30 days, configurable after risk review. These are policy proposals, not existing settings. Session/device list, login history, security notifications and revocation are required. Emergency lock must invalidate API and socket access even if an identity refresh token remains temporarily usable.

## Authorization and database defense

Use deny-by-default RBAC plus geographic ABAC and owner checks. RLS policies cover core scoped tables; runtime role cannot bypass. Transaction-local verified context avoids pooled-session leakage. Security-definer routines, if any, require review and fixed search paths. Foreign keys and composite constraints prevent mismatched vendor/store/order/zone references. Do not rely on Prisma middleware alone. Audit logs and financial ledgers deny runtime UPDATE/DELETE; migration/deployment roles are separate.

## Data protection and privacy

TLS everywhere; KMS envelope encryption for documents, payout details, identity-phone fields and provider credentials; key access separated from object access and audited. Product images may use CDN; KYC never. Signed KYC access proposed TTL 60 seconds, one object/reviewer/purpose, no-store and referrer protection; URL issuance itself audited. Download proxy may be preferable to a reusable signed URL.

Collect only policy-required documents. Vendor company/individual and rider bicycle/motorvehicle requirements differ. Retention periods require Bangladesh counsel/provider review before real collection; do not assert that a historical chat's cited “2026 privacy law” is verified. Lawful financial-record holds override deletion only for required records; explain exceptions. Proposed raw rider-location retention ≤30 days and personalization events ≤180 days are review targets, not legal advice. Minimize telemetry and redact recipient/KYC data.

Office-assisted uploads record subject consent, uploader, reviewer and source. No biometric templates by default. Government verification only through explicit authorized channels; public portals are not assumed APIs. Never scrape NID data. Manual review is labelled manual, not “government verified.”

## Screenshot/recording limitation

A website cannot universally prevent OS screenshots, screen recording, developer tools access or another camera. Disabling right-click is not data security. Use visible dynamic watermarks (admin ID, session reference, scope, time), minimize/mask data, approve exports, audit reads and revoke sessions. Native Android FLAG_SECURE and supported iOS capture detection/masking apply only if a native wrapper is later approved. Do not claim invisible watermarks reliably identify every photograph or that audio recording can be blocked by CSS/JavaScript.

## Payments, fraud and AI

Payment adapter must declare authentication method and capabilities. Signed webhook where offered; if a provider uses hash/IPN plus validation rather than a signed event, implement its documented verification and server query—never label an unsigned callback “signed.” SSLCOMMERZ's public v4 docs require transaction/amount/currency validation through its Order Validation API. [2](https://developer.sslcommerz.com/doc/v4/) aamarPay recommends transaction search from the success endpoint. [3](https://aamarpay.readme.io/reference/search-transaction) Provider-specific contracts still control marketplace settlement.

AI can summarize, draft, recommend, answer scoped status and create low-risk alerts. It cannot transfer money, approve refunds/payouts/KYC, mutate ledger or grant roles. Human approval uses normal domain authorization and an exact payload hash; “AI suggested it” is never authority. Retrieval content is untrusted, tool results minimized, and all calls/denials logged. No access to private communications; user-initiated voice search and explicit product-link sharing are the allowed alternatives.

## Release gates

No production launch until: negative permission tests, admin MFA/recovery/lock drills, KYC access/retention tests, concurrency/ledger/payout tests, provider callback/reconciliation tests, dependency/secret scans, upload tests, independent security review, backup restore drill, monitoring/alert drill and documented risk acceptance. WAF/TLS/CSP are controls, not a guarantee against compromise. Paid tooling and external penetration testing require owner approval.
