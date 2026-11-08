# Shop UI increment

The shop now follows the homepage's dark, white and red storefront visual language: breadcrumb, collection header, responsive search and category navigation, and clearly presented product, empty and error states. The reference inventory specifies the storefront's design direction but does not supply a separate shop-page mockup; this layout is an interpretation rather than a pixel-matched approved shop design.

Search, category filtering and cursor navigation continue to use the public catalog. Product cards use actual API data, and their existing no-image/out-of-stock handling remains unchanged. No sample products, prices, ratings, sort controls or other unsupported features were added. Failed category loading is surfaced separately from product availability.

Server-rendered tests exercise filters and cursor preservation, real product output, unconfigured/unavailable/empty states, and category-service failure. These tests and a production build do not replace desktop/mobile browser, keyboard or assistive technology review, or validation against a configured live catalog. The remainder of the marketplace UI and the actual backend setup remain open.
