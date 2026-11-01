# Phase 2 — Live local Keycloak OIDC verification

Status: **PASS for local development smoke flow.** This is not production identity readiness and does not yet prove TOTP enrollment, account linking, recovery or step-up.

## What was run

- Keycloak **26.3.5** was started locally in development mode against the local PostgreSQL database using a dedicated `gs_keycloak` role and `keycloak` schema.
- The `get-stoopy` realm was imported from `infra/keycloak/get-stoopy-realm.json`.
- The confidential `get-stoopy-web` client secret was retrieved through the Keycloak admin API and stored only in the ignored local `.env`.
- A local-only verification user was created through the Keycloak admin API. Its credentials are only in the ignored local `.env` and are not committed.
- NestJS API and Next.js BFF were run locally.
- `scripts/verify-keycloak-local.sh` was added and run successfully.

## Verified flow

1. Browser-like request to `/api/auth/login`.
2. Redirect to Keycloak authorization endpoint with PKCE S256, state and nonce.
3. Keycloak username/password login.
4. Authorization-code callback to the Next.js BFF.
5. BFF token exchange and API session creation.
6. `/api/auth/me` returns an authenticated application session.
7. CSRF/Origin-protected logout.
8. The revoked session is denied on the next `/api/auth/me` request.

Result: `PASS: Keycloak OIDC login -> BFF session -> /me -> CSRF logout -> revoked session denied`.

## Security boundary

- Insecure HTTP OIDC is allowed only for `localhost`/loopback development issuers. Production still requires HTTPS and `__Host-` cookies.
- No public admin registration, implicit flow or direct-grant flow was enabled.
- No real customer identity data was used.
- The GitHub PAT previously pasted in chat was **not** committed. Secrets must remain outside the repository.

## Still pending

- Mandatory privileged-admin TOTP enrollment and step-up.
- Safe OAuth account linking, recovery, device/session management and emergency revocation drills.
- Argon2id parameter benchmark and Google Authenticator interoperability testing.
- Production Keycloak hostname/TLS/backup/HA configuration.
