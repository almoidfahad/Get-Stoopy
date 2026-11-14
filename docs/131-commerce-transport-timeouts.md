# Cart and checkout transport safety

## Change

Cart and quote requests previously had no explicit upstream timeout and followed redirects by default. A slow server could leave the cart or checkout waiting indefinitely, while an unexpected redirect or response status could be relayed to the browser or mistaken for an ordinary rejection. An unreadable error response could also reach the UI as a 4xx even though its result was not safely understood.

The shared cart transport now sets an eight-second abort signal for each upstream request, including body consumption, combines it with any caller abort signal, and uses manual redirects. The cart preflight accepts only HTTP 200/201 with its existing cart validation; it never sends a subsequent command if that read is unavailable. Cart mutations accept the expected success statuses and existing result validation; a redirect, unexpected success status, timeout, malformed error body, 408 or server failure becomes a generic 502 uncertain result. Quote creation, read and release apply the same transport policy and map unexpected statuses or unreadable bodies to 502. A 401 maps to `SIGN_IN_REQUIRED`; structured 4xx errors other than 408 retain their code and status but not arbitrary upstream details. No upstream request is automatically retried.

The deadline is per upstream call, not an overall checkout deadline; a cart preflight and its subsequent mutation may each consume up to eight seconds. After a mutation begins, an abort or unexpected response does not imply cancellation or rollback. Existing cart UI requires the buyer to inspect/reload before another change; reservation UI preserves the original attempt for an explicit retry, and release UI blocks further release actions pending reload. These controls do not create durable cart idempotency or guarantee that an earlier request has stopped.

## Verification and limits

- 926 tests, typecheck and isolated production web build passed. Tests cover redirect refusal, abort signals, unexpected 2xx/3xx, 408, 401, structured and malformed errors, and BFF responses.
- In an isolated synthetic API and real Next BFF, a preflight stalled after headers produced unavailable without sending a mutation; cart mutation, quote creation and release were separately committed by the fixture before their headers or body stalled. Each returned 502 after about eight seconds, without a duplicate request or redirect.
- At 320, 390 and 1440 CSS pixels, synthetic cart, reservation and release mutations committed before a 307 response showed the existing unknown-result warnings. Redirect targets were not contacted; keyboard guarding, selected Axe checks and horizontal overflow passed. This is not a full accessibility audit.
- No real commerce backend, identity provider, user database, Supabase connection or production deployment was used. Payment and order placement remain unavailable; real end-to-end behavior still requires backend verification.
