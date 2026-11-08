# Vendor product layout preview

The vendor workspace now links to `/vendor/product-preview`, an interactive **layout preview only** for product name, optional brand and description. The fields update a local visual preview and have limits matching the existing create-product DTO. The page has no persistence, network submission, store selection, save, publish, image upload, price or inventory function. It does not create a catalog draft; all entries disappear on navigation or reload. A prominent notice explains these limits and warns against sensitive information. The page is public because it handles only user-entered ephemeral content and contains no store data; it does not confer vendor permissions.

The existing catalog API is not connected. A real product workflow must select an authorized store, enforce backend membership/permissions and CSRF, validate inputs server-side, handle variants, stock, images and moderation, and provide honest success/error states. Never rely on this preview or client field limits for authorization or validation. Product management remains listed as unavailable on the dashboard.

Server-render tests check labels, limits, explanatory text, and absence of submission controls. They do not exercise browser input interactions, accessibility with assistive technology, live authentication, authorization, or persistence; responsive visual review also remains open. The supplied vendor dashboard reference does not include a product editor, so this is an interpretation awaiting design review.

The subsequent inventory increment adds a jsdom interaction test for typing into this preview. It still does not replace real-browser, visual or assistive-technology review.
