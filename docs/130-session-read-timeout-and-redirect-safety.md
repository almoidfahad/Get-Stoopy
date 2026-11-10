# Session read timeout and redirect safety

The account, admin, vendor and rider pages and the `/api/auth/me` BFF endpoint previously fetched the session without an explicit timeout or redirect policy. A stalled upstream could hold those pages open; an upstream redirect could also be followed and its eventual response mistaken for a direct session response. The BFF route additionally passed upstream errors through or could throw instead of returning a controlled unavailable result.

These consumers now share a session read that uses a manual redirect policy and an eight-second abort signal covering both response headers and JSON body. Only a direct HTTP 200 with a nonblank user ID is considered a session; HTTP 401 is signed out; redirects, other statuses, malformed JSON, timeout and network or configuration errors are unavailable. Each page retains its own further validation and existing retry UI. The BFF route preserves a valid session payload, returns a generic 401 for a real 401 and a generic 502 for unavailable, with `Cache-Control: no-store`. It does not forward backend error details or redirect locations.

The session response is not proof of workspace authorization: admin, vendor and rider pages remain informational layouts, and all real operations require backend authorization. The browser endpoint's valid response remains the existing session payload, including fields such as CSRF; this increment does not change that contract or implement a new account workflow.

## Verification

- 903 local tests, typecheck and an isolated production web build passed. Tests cover only-200 success, 401 versus unavailable, bad bodies, redirects, header/body abort, BFF response status and no-store policy.
- A synthetic local session API and the real Next BFF/pages were used at 320, 390 and 1440 CSS pixels. All four pages rejected a redirect without contacting its target; keyboard retry after service recovery worked; selected Axe and horizontal-overflow checks passed. A JavaScript-disabled account retry also passed.
- With the synthetic upstream stalling before headers and after partial body separately, all four pages and `/api/auth/me` returned their unavailable state in about 8.6 seconds, with exactly one upstream request apiece and no automatic retry.

These are local synthetic checks, not a real identity/backend, real-device, screen-reader or comprehensive accessibility validation. No Supabase database or production deployment was touched.
