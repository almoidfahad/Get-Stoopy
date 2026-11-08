# Shop filter usability

The shop category list now uses a native, keyboard-operable disclosure on small screens and remains visible on desktop. The selected category is named in the mobile disclosure, including a neutral fallback when a valid category's name cannot be loaded. The category links preserve the search and reset pagination. “All categories” accurately describes that action even when a search is active.

Applied search and category filters can also be removed individually: the other filter is preserved, and the cursor is cleared. Long search terms, category names, product names and store names can wrap without forcing the page wider. No search, sorting, category or catalog backend behavior was added; no product data was invented for the application.

Server-rendered tests cover the disclosure markup, filter URLs and missing category names. A headless Chromium check with a temporary **synthetic local catalog** tested 320px, 390px and 1440px widths, keyboard opening of the mobile disclosure, individual filter removal, long unbroken text, document overflow and Axe checks in the exercised state; no violations were detected. This does not validate the live catalog, real devices, screen readers, translations or all accessibility requirements. The production market, database and deployment were not changed.
