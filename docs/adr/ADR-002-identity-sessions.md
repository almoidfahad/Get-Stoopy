# ADR-002: Established identity provider with revocable BFF sessions

Status: ACCEPTED for development — owner approval 2026-11-01. Production/provider gates remain. Date: 2026-11-01.

Context: Customer password/OAuth plus mandatory privileged TOTP, safe linking, recovery, device/session revocation and step-up are required. Credentials-only JWT auth is insufficient.

Decision: Propose Keycloak for credential/OIDC/TOTP lifecycle, with Next.js BFF holding an opaque Secure/HttpOnly session and encrypted server-side provider tokens. Marketplace roles/scopes/assurance remain authoritative in the application database. Pin and test the chosen identity version, Argon2id parameters and Google Authenticator-compatible TOTP. Disable email-only automatic account linking. Keycloak owns its own schema/migrations; no per-role marketplace databases.

Consequences: Adds an identity service, upgrade/backup/on-call burden and configuration complexity. It avoids inventing password/MFA primitives. Emergency application lock must revoke API/socket access even if provider tokens remain temporarily valid. Provider account deletion/linking must preserve marketplace audit identity.

Alternative: A maintained database-session auth framework with a tested credentials adapter if the owner rejects Keycloak operations. Auth.js Credentials does not persist credential/session data by default; do not assume it supplies the required controls. [1](https://authjs.dev/getting-started/authentication/credentials)

Review gate: Owner accepts identity operating model; Phase-2 tests prove enrollment, login, linking, recovery, revocation and step-up. No identity service is provisioned.
