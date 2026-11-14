# Product photo recovery

On a product detail page, a failed main photo now offers a local retry without navigating away or resetting selected product options. Each retry uses a fresh same-origin image-proxy URL; the proxy still assembles the upstream path from validated IDs and ignores caller-supplied query parameters. Successful and error proxy responses use `Cache-Control: no-store`. The status reports loading, failure or success, and the retry control remains present so keyboard focus is not lost. Failures that happen before hydration are detected from the image element after hydration. Selecting a different product resets gallery selection and failures.

This does not retry failed thumbnails, guarantee that a genuinely missing image will become available, or make images available without a configured catalog. A full page reload is still an alternative. No live catalog or backend was modified.

Verification: 551 local tests passed, including retry/focus, pre-hydration failure, product changes, proxy error caching and validated upstream construction. Typecheck and production web build passed. Chromium checks with a synthetic catalog and browser-intercepted failing/successful image requests covered keyboard retry, focus retention, document overflow and Axe checks at 320, 390 and 1440 CSS pixels. These checks are not a complete accessibility or real-service audit.
