# Public catalog and city read timeouts

The storefront's product listing, categories, product details and serviceable-city requests previously had no explicit deadline and followed upstream redirects. A slow upstream could hold shop, product or checkout rendering indefinitely; a redirect could make a different endpoint's response look like the requested data.

These reads now use manual redirects and an eight-second abort signal that remains active during JSON body consumption. Only a direct HTTP 200 is treated as a successful read; a direct catalog 404 keeps the existing not-found behavior (listing/category 404s display unavailable), while a city 404 and other statuses, redirects, timeouts, invalid JSON and network/configuration errors are unavailable. This retains the existing retry UI and does not infer an empty catalog or lack of delivery from a transport failure. Each request has its own deadline; checkout may also need a separate cart request.

## Verification and remaining limits

- 1,003 local tests, typecheck and an isolated production web build passed. Tests cover redirects, unexpected statuses, 404 behavior, invalid JSON, header/body abort and missing market configuration.
- With a synthetic local API and the real Next BFF, upstream responses that stalled before headers or partway through the body returned the existing shop, product and checkout unavailable screens after about 8.4 seconds. The two parallel shop reads and the product and city reads made one call each and did not retry automatically.
- At 320, 390 and 1440 CSS pixels, synthetic redirects were not followed; the three screens offered keyboard-operable retry and selected Axe/overflow checks passed. A JavaScript-disabled shop retry retained the search query.
- This increment changes transport only. The city response has existing shape validation, but catalog JSON is not yet fully validated against the product/category presentation contract; a syntactically valid malformed catalog body can still cause incorrect rendering or an error. Public image handling is separate. A real backend, screen reader and real device were not tested; no Supabase database or production deployment was touched.
