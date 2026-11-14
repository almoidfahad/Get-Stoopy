# Get Stoopy: existing Supabase Free-plan COD integration audit

## 0. Scope and important limits

**Audit only; no production change approved by this report.** Inspected the current working branch `7586689`, repository source/configuration and the connected Supabase project `ugxiwbspmivugtriiehi` (`Get Stoopy`) using metadata-only/read-only queries, without reading customer rows or secret values. The connected project is the one visible to the Supabase connector; please confirm that it is the intended project before any implementation or production changes. The earlier supplied reference `ribdhdxgqmirvnymkkoh` was inaccessible in the previous inspection; this report makes no claim about it. Vercel project/deployment metadata was inspected without changing configuration.

The project is described by the owner as Free; the connector does not report its billing plan or current quota/usage dashboard. Project listing reported `ACTIVE_HEALTHY`, but the separate service-health endpoint returned HTTP 500, so individual service health could not be verified. The observations below are a snapshot, not a guarantee of continuous status. The platform-service schemas `auth`, `storage`, `realtime`, `vault`, `extensions`, and `supabase_migrations` belong to Supabase; their complete internal data, dependencies, all installed-function bodies and operational settings were not exhaustively audited. Public table columns are listed below; relevant Auth/Storage schema inventories are summarized. No live login, impersonation, RLS mutation, delivery, financial transaction, storage upload, recovery or load test was performed. "Code exists" never means "production-ready".

## 1. Executive findings

1. **Production COD is not available.** `apps/api/src/payments/orders.service.ts` blocks COD and sandbox order creation outside test (`ORDER_CREATION_DISABLED`). Checkout UI states that recipient, confirmed total, delivery charge and order placement are unavailable. Do not set `NODE_ENV=test` on real data or remove this gate to simulate readiness.
2. Vercel `getstoopy` reports promoted production deployment `dpl_H8894uXgo5V4ETvgMj9ufibdhKZp`, commit `69743a4`, alias `getstoopy.vercel.app`. This is older than the audit branch. It deploys the web app, not the separate API/worker. The latest observed project configuration contains two production Supabase public variables, but this repo has no Supabase JS client and does not use them for checkout. Their values were not decrypted or validated. A build or environment-variable name is not proof of live connectivity.
3. The hosted `public` schema has **19 editorial-oriented tables and two views**, not the 106 mixed-case Get Stoopy Prisma models. Seven existing Supabase migrations are for editorial identity/content, revisions, rate limits, jobs and email—not this repo's 77 Prisma migrations. Do not apply the repository migration chain blindly, run `db push`, fabricate Prisma migration history, or assume same-named business concepts mean the same data model.
4. The hosted database is shared with an editorial application: its `profiles`, `user_roles`, `categories`, `audit_logs`, Auth trigger and redirect configuration must be preserved. This is a **shared-project integration**, not an empty DB. A separate namespace and least-privilege design may be appropriate but is not automatically isolated: default grants, cross-schema search paths, exposed schemas, functions, roles and existing Auth triggers must be reviewed. No schema is created or selected by this audit.
5. Existing repo code uses **Keycloak/OIDC plus a Nest API and opaque BFF sessions**, Prisma, PostGIS and Redis; the user now requests **Supabase Auth and Storage**. Integrating those is a substantive identity/storage adaptation, not a URL change. Mapping identity, scoped authorizations and session lifecycle requires review and regression tests so the existing editorial app and its users still work.
6. **Financial safety blocker:** current legacy finance writes the entire order amount per delivery; the DB migration `0041` assumes the same. Multiple deliveries could duplicate custody. Application guard refuses unsafe multi-store COD dispatch/offer/accept/pickup/completion and finance writes; existing guards must stay until allocation and ledger/DB invariants are redesigned and verified.
7. **Existing security concern requiring assessment:** hosted `profiles_update_self` checks only `id = auth.uid()` and `authenticated` has table-level UPDATE on `public.profiles`; the table includes `status` and `mfa_enrolled`, and its observed update trigger only touches timestamps. `has_permission` depends on `profiles.status = active`. PostgreSQL metadata also reports effective `authenticated` UPDATE privileges on both columns. Together these create a plausible path to self-modify security-relevant fields, including potentially reactivating a suspended profile with unexpired roles, subject to the actual request path and surrounding controls. Not exploited or verified with an active user. Prioritize a controlled security review; do not silently change this existing app's access policy.
8. `anon`/`authenticated` have broad table grants on many public relations, including `TRUNCATE` in metadata. Row policies govern normal SELECT/INSERT/UPDATE/DELETE, **not TRUNCATE**; actual practical access depends on SQL/session privileges and API exposure. Both public views use `security_invoker=true`. Do not assume RLS enabled makes those grants harmless or that a vulnerability was successfully exploited. Review grants and definer-function execution without disrupting the editorial application.

## 2. Existing hosted database: public tables and columns

Column inventories below are schema metadata, **not actual records**. Types/defaults/nullability were inspected; abbreviated names below omit type/default detail for readability. `id` is UUID unless specified. Every one of these 19 tables reports RLS enabled; none is forced RLS. Owner/bypass roles and SECURITY DEFINER functions may still bypass it.

| Table | Columns | Existing purpose |
|---|---|---|
| `article_media` | article_id, media_id, role, created_at | Editorial article/media association |
| `article_reviews` | id (bigint), article_id, decision, reviewer_id, note, created_at | Editorial review |
| `article_revisions` | id (bigint), article_id, revision_no, title, dek, body_html, slug, status, changed_by, change_reason, changed_fields, note, created_at | Editorial history |
| `articles` | id, slug, title, dek, body_html, status, category_id, author_id, created_by, publish_at, reading_minutes, hero_image_url, hero_image_alt, is_exclusive, ai_assisted, ai_reviewed_by, ai_reviewed_at, deleted_at, created_at, updated_at, search_vector | Editorial content |
| `audit_logs` | id (bigint), occurred_at, actor_id, actor_type, agent_id, action, resource_type, resource_id, outcome, request_id, ip_hash, metadata | Editorial audit log; not proven suitable for COD ledger |
| `authors` | id, user_id, slug, display_name, role_title, bio, is_active, created_at | Editorial authors |
| `breaking_news` | id, headline, href, is_active, started_at, starts_at, ends_at, created_by, created_at | Editorial alerts |
| `categories` | id, slug, name, description, is_active, sort_order, created_at, updated_at | Editorial categories; do not assume product-category compatibility |
| `comments` | id, article_id, author_name, author_email, body, status, ip_hash, moderated_by, moderated_at, created_at | Editorial comments |
| `corrections` | id, article_id, description, correction, is_public, approved_by, approved_at, created_at | Editorial corrections |
| `email_outbox` | id, to_email, subject, body_text, template, status, attempts, max_attempts, last_error, provider, provider_id, job_id, created_at, updated_at, sent_at | Editorial email queue |
| `jobs` | id, kind, payload, status, priority, run_at, attempts, max_attempts, locked_by, locked_until, last_error, created_at, updated_at, finished_at | Editorial job queue |
| `media_assets` | id, storage_path, file_name, mime_type, byte_size, width, height, alt_text, credit, checksum, uploaded_by, deleted_at, created_at | Editorial media metadata, not verified as marketplace storage |
| `newsletter_subscriptions` | id, email, status, source, confirm_token, confirmed_at, unsubscribed_at, created_at | Editorial newsletters |
| `permissions` | key (text), description, created_at | Editorial RBAC capabilities |
| `profiles` | id, email, display_name, avatar_url, bio, status, mfa_enrolled, last_login_at, created_at, updated_at | Existing Auth-linked profile |
| `rate_limit_hits` | bucket, window_start, hits, expires_at | Editorial rate-limit data |
| `role_permissions` | role, permission, created_at | Editorial role-capability association |
| `user_roles` | user_id, role, granted_by, granted_at, expires_at | Editorial role membership |

Views `public_corrections` and `published_articles` expose curated editorial columns and have `security_invoker=true`. Existing `app_role` values are `super_admin, admin, editor, author, analyst`, **not** marketplace vendor/rider/customer roles.

### Primary/foreign keys and indexes

- Composite PKs: `article_media(article_id, media_id)`, `rate_limit_hits(bucket, window_start)`, `role_permissions(role, permission)`, `user_roles(user_id, role)`; `permissions(key)` is a text PK; other tables have their listed `id` PK.
- `profiles.id → auth.users.id`. `user_roles.user_id/granted_by → profiles.id`; `role_permissions.permission → permissions.key`.
- `articles.category_id → categories.id`, `author_id → authors.id`, `created_by/ai_reviewed_by → profiles.id`. `authors.user_id → profiles.id`; breaking-news creator, audit actor and media uploader also reference profiles.
- Article revisions/reviews/comments/corrections reference articles and, where applicable, profiles. `article_media` references both articles and media assets. Existing cascades/restrict/set-null actions are attached; do not alter them without testing the editorial app.
- Unique constraints include article, author and category slugs; `(article_id, revision_no)`; `media_assets.storage_path`; newsletter email. Existing editorial indexes cover status/publish/search, timestamps, owner/actor, job readiness/leases and rate-limit expiry. These do not provide marketplace order/delivery indexes.

### Functions, triggers and RLS

Public functions observed: `audit_article_status_change`, `audit_logs_block_mutation`, `block_mutation`, `capture_article_revision`, `claim_jobs`, `confirm_newsletter_subscription`, `consume_rate_limit`, `current_user_roles`, `enforce_article_status_permission`, `finish_job`, `handle_new_auth_user`, `has_permission`, `is_super_admin`, `is_trusted_service`, `issue_newsletter_confirmation`, `jwt_role`, `prevent_article_reassignment`, `prevent_media_hard_delete`, `publish_due_scheduled_articles`, `purge_rate_limits`, `release_expired_jobs`, `request_has_jwt`, `search_articles`, `touch_email_outbox_updated_at`, `touch_job_updated_at`, `touch_updated_at`. Several are SECURITY DEFINER. Their full body, execution grants and callers require review before sharing or changing; only the core profile/permission helper definitions were inspected in detail.

Observed non-internal triggers include `auth.users.on_auth_user_created` → `handle_new_auth_user` (creates a `public.profiles` record); article status/audit/revision/assignment/timestamp triggers; append-only review/revision/correction and audit triggers; media soft-delete-only; profile, job and email timestamp triggers. Storage also has provider-managed lifecycle/delete/timestamp triggers. Auth registration is therefore already coupled to the editorial app; changing or replacing the trigger can break it.

There are 33 public policies and no policies returned for `storage`. Existing policies permit public reads for selected editorial content and role/ownership checks for editorial writes; `profiles` has self-read/self-update and admin paths, while `user_roles` writes require `is_super_admin`. Some RLS-enabled tables have no listed ordinary role policies. No marketplace-specific vendor, rider, customer or COD policy was found. Inspection of policy text is not an adversarial verification.

## 3. Managed schemas, auth and storage

- Non-system relation inventory: `auth` 27 tables, `storage` 10 tables, `public` 19 tables/2 views, `realtime` 2 tables/1 partitioned table, `supabase_migrations` 1 table, `extensions` 2 views, `vault` 1 table/1 view. Internal table columns, system RLS and access are not fully enumerated in this report; they are provider-managed and must not be modified directly.
- Supabase Auth config: email signup enabled, email autoconfirm disabled, phone sign-in disabled; TOTP enroll/verify enabled; JWT expiry 3,600 seconds. Auth site URL currently points to `https://american-signal-desk.vercel.app` with empty explicit URI allow-list. This is another signal of existing editorial use. SMTP host is not configured in the metadata; real mail delivery/limits were not tested. Do not change redirect, email templates, MFA or signup globally without assessing the existing app and obtaining approval.
- The repo's sign-in flow verifies Keycloak ID tokens, issues server-side opaque sessions, and uses its own role/permission/scope model. It is **not Supabase Auth integration**. Registration, password recovery, email verification, phone OTP and live session behavior for Get Stoopy are not established. There are no `@supabase/supabase-js` integrations in inspected source. Never put a service-role key in browser code or chat.
- `storage.buckets` and `storage.objects` both returned zero rows, and no Storage policies were observed. This is a snapshot, not proof that external storage or an application doesn't exist. The repo instead uses `LocalEncryptedObjectStorage` and a `StorageObject` metadata model. A production adapter to Supabase Storage, private documents, signed/authorized access, upload limits/content verification, retention and deletion need design and tests. Do not reuse editorial `media_assets` merely because it stores file metadata. No bucket creation is approved here.
- `pgcrypto` and `uuid-ossp` are installed. PostGIS `3.3.7` is available in the provider's extension catalog but **not installed**. The existing Prisma chain starts with `CREATE EXTENSION IF NOT EXISTS postgis` and expects geometry and particular roles/grants. Availability does not prove that installation, permissions, namespaces or migrations are safe in this shared project.

## 4. Existing application architecture and module inventory

**Web:** Next.js 15/React 19 (`apps/web`), responsive storefront and layout previews; Next server-side BFF routes proxy selected APIs. Homepage, shop/product pages, cart, checkout, account, vendor, rider and admin paths exist. Catalog/cart/quote have development API integration and tests but configured live market/session/API end-to-end was not demonstrated. Checkout holds a quote/reservation, not a completed COD order. Account order history is not connected. Vendor dashboard/orders/inventory, rider dashboard/delivery, and admin dashboard/review views are predominantly layout/preview/unavailable states; they do not constitute working operations or authorization.

**Backend:** NestJS modular API (`apps/api/src`) with auth/security, parties/KYC, catalog/inventory, commerce, payments/orders, fulfillment, serviceability, dispatch, delivery, finance, risk, notification, storage and admin controllers. Repository source and tests include multiple foundation services, but production availability and completeness are not established. Rider delivery supports pickup, OTP and completion foundations; failed-attempt/re-delivery, coordinated multi-store rider itineraries and full last-successful fee collection are not an end-to-end live workflow. Refund/payout operations have sandbox/disabled components; online payments remain out of scope.

**Worker/infrastructure:** `apps/worker` uses Redis/BullMQ/outbox and includes inventory, dispatch, KYC and recipient-draft expiry. Existing object storage is local encrypted development storage. Supabase-only hosting does not automatically supply the separately running Nest API, background worker, Redis or existing Keycloak. Free alternatives may exist, but suitability, uptime, costs/quotas and operational ownership are **not verified**. Do not assume a Supabase subscription upgrades or a new provider are required; evaluate minimal adaptation with the owner before architectural change.

**Repository database, not hosted:** `packages/db/prisma/schema.prisma` contains 106 models, with 77 ordered migrations. Important groups already designed in code include `User`, `UserIdentity`, `Role`, `Permission`, `UserRole`, `Session`, geography/service zones; `Vendor`, `VendorMembership`, `RiderProfile`, `Store`, `Product`, `ProductVariant`, `Inventory`, `Cart`, `CheckoutQuote`, `Order`, `VendorSuborder`, `OrderItem`; `DispatchRun`, `DispatchOffer`, `RiderAssignment`, `Delivery`, `DeliveryProof`, `DeliveryOtpChallenge`; `CodCollection`, `CodDeposit`, `CodAllocation`, ledger journals/lines, rider earnings, vendor settlements, refunds/payout reservations; KYC, audit and notifications. Existing objects must be mapped and reused where safe rather than duplicating functionality. Repo migration definitions are not evidence that those objects exist in Supabase.

## 5. Missing components and provisional database plan

No final DDL or table count can be approved from a names-only mapping. The following are **logical capabilities to map to existing code and Supabase objects**, not permission to create duplicate tables. Confirm exact mapping after isolation, identity and security review:

| Capability | Hosted observation | Candidate existing repo structures / required work |
|---|---|---|
| Identity and profiles | `auth.users` + editorial `profiles`/RBAC exist | Reuse Auth identity where safe; decide explicit mapping to existing `User`/`UserIdentity` and separate marketplace authorization; preserve editorial roles and profile trigger |
| Admin, seller, rider | Editorial admin roles only | `Role`, `Permission`, `UserRole`, `Vendor`, `VendorMembership`, `RiderProfile` and scoped admin structures exist in repo; adapt verified claims and membership |
| Customer, product and stock | No hosted COD/product tables observed | Reuse repo User/customer scope, Store/Product/Variant/Inventory models and migrations after compatibility review; don't reuse editorial `categories` without semantic mapping |
| Order and items | No hosted marketplace order tables observed | Existing `Order`, `VendorSuborder`, `OrderItem`, `Cart`, `CheckoutQuote`; authoritative recipient, fees, tax/discount policy, idempotency and real customer total still required |
| Dispatch and delivery attempts | No hosted marketplace dispatch tables observed | Repo DispatchRun/Offer/Assignment/Delivery/Event models; define multi-store rider trips, attempts, retries and status transitions; add only missing structures once designed |
| COD cash, rider ledger and vendor settlement | No hosted COD ledger observed | Existing CodCollection/Deposit/Allocation and Ledger/Settlement models need safe per-delivery allocation, exact-once fee claim, revised database invariants, reconciliation and tests; **do not repurpose editorial audit logs as a financial ledger** |
| Returns, cancellations, verification, notifications | No hosted marketplace equivalents observed | Repo cancellation/refund/KYC/Notification/Audit structures exist; complete full workflow and private document access, including refunds/returns policies |
| Storage | No buckets or object policies observed | Design public product images separately from private verification/vendor/rider/delivery-proof objects, with scope, MIME/size enforcement, quarantine, deduplication, retention and recovery |

Potential modifications concern the repo's order/quote/delivery/collection/finance models and migrations—not a request to edit editorial tables. Existing profile reuse, role mapping, needed extensions, privileges, schemas and any functions require explicit design and approval. Add only reviewed incremental version-controlled migrations, with a demonstrated backup/restore plan, safe staging, no deletes/truncates/resets, and known forward/rollback compatibility. Never modify existing credentials.

## 6. Target authentication and security plan (proposal, not implemented)

1. Review and preserve existing Auth users, `profiles`/role trigger and editorial redirect behavior. Design a Supabase-Auth-to-API identity adapter with verified issuer/audience/signature/expiry and authoritative account status. Reconcile the current Keycloak-specific OIDC/session/step-up model rather than merely switching env variables. Determine whether to reuse the existing editorial profile safely or maintain a marketplace extension linked by `auth.users.id` without duplicate identity.
2. Implement signup, email verification, login/logout, reset and revocation using Supabase-supported flows; verify redirect URLs without breaking the existing app. Phone OTP/SMS and delivery OTP need separate supported channel and cost/availability assessment; phone auth is currently disabled. Real email delivery and limitations must be verified before promising the flow.
3. Define server/database-enforced vendor membership, rider assignment, customer ownership and admin scopes. Use non-user-writable role claims or trusted tables, least-privilege role grants and RLS, hardened function search paths, minimal `SECURITY DEFINER` execution and safe audit logging. Separate financial write functions/transactions from public direct writes. Verify cross-role and cross-tenant denial with synthetic users; don't infer security from a UI or RLS flag.
4. Review the current self-profile UPDATE and broad grants in a controlled plan that avoids damaging editorial workflows. Document whether the risk is reachable through real deployed APIs; don't test mutation on live accounts. Retain application-level ownership checks and CSRF/session protections as appropriate.

## 7. Storage plan (proposal, not implemented)

Use the existing project's Supabase Storage, after authorization, with distinct public/private policies according to use: product images may be public only when approved; vendor/rider/verification documents and delivery proof remain private and scoped. Specify MIME, byte-size, dimension and content validation, upload authorization, malware/quarantine workflow, short-lived signed access or trusted streaming, audit, object identity and idempotent deduplication. Compression is only for appropriate images and must preserve evidence where required. Design retention, export/restore and encryption/key management before moving sensitive data. Bucket names/count are not final; avoid duplicates and never delete existing objects.

## 8. Free-plan compatibility and current measurements

- User's previous figures: 28 MB/500 MB DB, 0 GB/1 GB file storage, 0 GB/5 GB egress, 1/50,000 MAU. **Historical user-provided data**, not verified current quota or use.
- Read-only PostgreSQL `pg_database_size(current_database())` now reports **12,834,483 bytes (~12.24 MiB)**. This includes PostgreSQL database storage and is **not necessarily Supabase's billable database usage metric**; don't compare directly to the historical dashboard figure.
- `storage.buckets` = 0; `storage.objects` = 0; total `auth.users` = 1. The latter is total accounts, **not monthly active users**. Current billed object bytes, egress, MAU, bandwidth, plan, quotas, backup availability and billing status are **not exposed by the used connector** and remain unverified. Ask the owner to check the Supabase dashboard, without sharing secrets.
- Prior authorized test-branch creation was refused by the provider with `entitlement_required`/Pro requirement. **Do not retry, upgrade, or create another project to bypass that restriction.** No paid service is required by this audit; provider restrictions may change and should be independently verified only when appropriate.
- Free-plan suitability for actual workload, background jobs, password email, OTP/SMS, maps/routing, hosting, backup and recovery is not proven. Email/SMS or map providers and always-on worker infrastructure can incur costs independent of Supabase. No paid service should be enabled without approval. Free local synthetic Postgres/PostGIS/Redis CI is an existing alternative for code testing, but it is not a copy or proof of the production configuration and does not by itself guarantee safe deployment. No additional project/branch was created.
- Future optimizations: cursor pagination and bounded responses; appropriate indexes checked with query plans; avoid unnecessary realtime and edge invocations; use thumbnail compression, private signed access and retention; monitor dashboard quotas and error/latency; avoid large test uploads or tests that consume production quota. Never stress or intentionally fill the live database.

## 9. Implementation roadmap and approval gates

1. **Owner review/approval:** confirm `ugxiwbspmivugtriiehi` is the intended shared project and that the editorial application and Auth users must remain functional. Review findings, backup/restore approach and current dashboard usage; do not share secrets. Approve a proposed coexistence and integration design, not blanket execution of unreviewed changes.
2. **Design and free local rehearsal:** inspect existing migrations and exposure/default-grants/extension behavior in an isolated disposable local Postgres/PostGIS test database; model an Auth adapter and marketplace namespace or other coexistence scheme, and verify the existing editorial interaction. No paid branch or provider bypass. A local rehearsal does not represent hosted privileges or restore ability.
3. **Safe identity and private storage:** implement and test Supabase Auth/session integration, role isolation and private document adapter in code; maintain existing application behavior and avoid global Auth modifications without separate review. Verify deliverability and any OTP costs.
4. **Authoritative checkout and COD:** bind recipient, valid areas and routed per-rider itineraries to an immutable quote; highest rider-delivery slab charged once; Purbadhala total delivery charge ≤৳30; every rider route ≤3 km from first store through all stops to customer. Each rider collects its own product price; the final successful delivery collects the one fee. If the final delivery fails after earlier success, retry it and collect on successful retry. Define never-successful/cancel/partial cases, concurrent handoff coordination, discounts/tax, settlement and refund policy; implement exact-once database/ledger consistency and idempotency with independent tests. Keep unsafe COD guard until replacement is reviewed.
5. **Frontend integration:** connect the existing UI without unrelated redesign; admin/vendor/rider/customer data and actions use explicit authorization and accurate states, not static preview claims. Add map only after provider/privacy/cost decision and actual route geometry availability.
6. **Reviewable deployment plan:** present precise versioned migrations, resource/privilege/security diffs, backup and restore rehearsal, traffic/worker sequencing and rollback plan for explicit approval. Do not execute production DDL or change global Auth/Storage settings before approval. Preview with synthetic data and run full e2e, negative-permission, concurrency and financial reconciliation tests before any live promotion.
7. **Launch/monitor:** only after independently verified end-to-end scenarios and explicit authorization; monitor errors, reconciliation and Free-plan quota. No guaranteed zero-cost or immediate live launch has been established.

## 10. Testing evidence and gaps

The repository has disposable integration suites for API, RLS/PostGIS, commerce, dispatch/delivery, payments, ledger, finance-adjacent paths, inventory, KYC, storage, notifications and serviceability. PR CI for audited commit `7586689` run `43553104820` passed validation and disposable integration; a separate push CI run `43553100218` failed at integration, but its logs were unavailable (download returned EOF), so the cause is unknown. Do not call that push run passed. These tests are not live Supabase Auth/Storage, current hosted RLS role impersonation, a provider backup/restore, real email/OTP, or production COD end-to-end verification. Audit did not run modifying tests, deploy, migrate, create buckets/branches, or write hosted records.

## Appendix A — Managed Auth and Storage column names

These are provider-managed structures, not a suggestion to read token/secret **values** or to modify the tables. Only column names are shown; metadata was obtained without selecting row contents. Foreign keys, grants, constraints and every function/trigger in these managed schemas were not exhaustively reviewed.

### `auth` (27 tables)

- `audit_log_entries`: instance_id, id, payload, created_at, ip_address.
- `custom_oauth_providers`: id, provider_type, identifier, name, client_id, client_secret, acceptable_client_ids, scopes, pkce_enabled, attribute_mapping, authorization_params, enabled, email_optional, issuer, discovery_url, skip_nonce_check, cached_discovery, discovery_cached_at, authorization_url, token_url, userinfo_url, jwks_uri, created_at, updated_at, custom_claims_allowlist.
- `flow_state`: id, user_id, auth_code, code_challenge_method, code_challenge, provider_type, provider_access_token, provider_refresh_token, created_at, updated_at, authentication_method, auth_code_issued_at, invite_token, referrer, oauth_client_state_id, linking_target_id, email_optional.
- `identities`: provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, email, id.
- `instances`: id, uuid, raw_base_config, created_at, updated_at.
- `mfa_amr_claims`: session_id, created_at, updated_at, authentication_method, id.
- `mfa_challenges`: id, factor_id, created_at, verified_at, ip_address, otp_code, web_authn_session_data.
- `mfa_factors`: id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret, phone, last_challenged_at, web_authn_credential, web_authn_aaguid, last_webauthn_challenge_data.
- `mfa_recovery_code_sets`: id, user_id, mfa_factor_id, failed_verification_count, verification_locked_until, created_at, updated_at.
- `mfa_recovery_codes`: id, mfa_recovery_code_set_id, code_hash, consumed_at, created_at.
- `oauth_authorizations`: id, authorization_id, client_id, user_id, redirect_uri, scope, state, resource, code_challenge, code_challenge_method, response_type, status, authorization_code, created_at, expires_at, approved_at, nonce.
- `oauth_client_states`: id, provider_type, code_verifier, created_at.
- `oauth_clients`: id, client_secret_hash, registration_type, redirect_uris, grant_types, client_name, client_uri, logo_uri, created_at, updated_at, deleted_at, client_type, token_endpoint_auth_method.
- `oauth_consents`: id, user_id, client_id, scopes, granted_at, revoked_at.
- `one_time_tokens`: id, user_id, token_type, token_hash, relates_to, created_at, updated_at, expires_at.
- `refresh_tokens`: instance_id, id, token, user_id, revoked, created_at, updated_at, parent, session_id.
- `saml_providers`: id, sso_provider_id, entity_id, metadata_xml, metadata_url, attribute_mapping, created_at, updated_at, name_id_format.
- `saml_relay_states`: id, sso_provider_id, request_id, for_email, redirect_to, created_at, updated_at, flow_state_id.
- `schema_migrations`: version.
- `scim_tokens`: id, sso_provider_id, token_hash, prefix, created_at, expires_at, revoked_at, last_used_at.
- `scim_users`: id, sso_provider_id, user_id, resource, user_name, external_id, active, created_at, updated_at, deleted_at.
- `sessions`: id, user_id, created_at, updated_at, factor_id, aal, not_after, refreshed_at, user_agent, ip, tag, oauth_client_id, refresh_token_hmac_key, refresh_token_counter, scopes.
- `sso_domains`: id, sso_provider_id, domain, created_at, updated_at.
- `sso_providers`: id, resource_id, created_at, updated_at, disabled.
- `users`: instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, invited_at, confirmation_token, confirmation_sent_at, recovery_token, recovery_sent_at, email_change_token_new, email_change, email_change_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at, phone, phone_confirmed_at, phone_change, phone_change_token, phone_change_sent_at, confirmed_at, email_change_token_current, email_change_confirm_status, banned_until, reauthentication_token, reauthentication_sent_at, is_sso_user, deleted_at, is_anonymous.
- `webauthn_challenges`: id, user_id, challenge_type, session_data, created_at, expires_at.
- `webauthn_credentials`: id, user_id, credential_id, public_key, attestation_type, aaguid, sign_count, transports, backup_eligible, backed_up, friendly_name, created_at, updated_at, last_used_at.

### `storage` (10 tables)

- `bucket_lifecycle_states`: bucket_id, generation, next_run_at, claim_id, claim_until, continuation, last_started_at, last_completed_at, last_success_at, last_result, failure_count, last_error, updated_at.
- `buckets`: id, name, owner, created_at, updated_at, public, avif_autodetection, file_size_limit, allowed_mime_types, owner_id, type, versioning_status, lifecycle_configuration, lifecycle_configuration_generation.
- `buckets_analytics`: name, type, format, created_at, updated_at, id, deleted_at.
- `buckets_vectors`: id, type, created_at, updated_at.
- `lifecycle_abandoned_artifacts`: bucket_id, key, name, version, attempted_at.
- `migrations`: id, name, hash, executed_at.
- `objects`: id, bucket_id, name, owner, created_at, updated_at, last_accessed_at, metadata, path_tokens, version, owner_id, user_metadata, archived_at, is_delete_marker, is_versioned.
- `s3_multipart_uploads`: id, in_progress_size, upload_signature, bucket_id, key, version, owner_id, created_at, user_metadata, metadata.
- `s3_multipart_uploads_parts`: id, upload_id, size, part_number, bucket_id, key, etag, owner_id, version, created_at.
- `vector_indexes`: id, name, bucket_id, data_type, dimension, distance_metric, metadata_configuration, created_at, updated_at.
