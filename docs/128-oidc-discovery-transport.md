# OIDC discovery transport policy

## Problem and change

The web BFF enables `allowInsecureHttp` in non-production environments to support a local HTTP identity provider. Discovery previously rejected *every* issuer other than a local HTTP issuer whenever this flag was enabled, so an ordinary HTTPS identity provider could not be used in development. IPv6 loopback was also compared to `::1`, although Node's URL parser returns `[::1]` as the hostname.

HTTPS discovery now works regardless of that flag and does not enable the OpenID client's insecure-request option. HTTP discovery is accepted only when the flag is explicitly true and the parsed hostname is `localhost`, `127.0.0.1`, or `[::1]`. Other HTTP hosts and non-HTTP(S) schemes are rejected before discovery. The insecure-request option is enabled only for that explicitly allowed local HTTP case; use a trusted local provider, since it permits insecure endpoint requests during that development flow. Production does not set the flag.

## Verification

- Automated policy tests cover HTTPS with the flag enabled and disabled, explicit HTTP loopback including IPv6, remote HTTP, unsupported protocols, and absence of the insecure-request option for HTTPS.
- An isolated synthetic HTTPS OIDC provider used a short-lived self-signed test certificate with a 127.0.0.1 IP SAN. With that fixture certificate trusted only in the test process, real discovery, PKCE code exchange and nonce validation succeeded. Without that trust the certificate was rejected. A provider advertising an HTTP token endpoint under HTTPS discovery was rejected without contacting that endpoint. TLS verification was not disabled.
- A separate local Next development process with the synthetic provider produced an HTTPS authorization redirect and HTTP-only transaction cookie through `/api/auth/login`. At 320, 390 and 1440 pixels the login link received keyboard focus, with no detected horizontal overflow or automated Axe violations.
- Full unit suite, typecheck and an isolated production build passed.

This is synthetic verification, not a real provider sign-in, production deployment, or end-to-end backend test. Local HTTP flow remains deliberately development-only; a real provider and deployment still require their own configuration and validation.
