# Checkout subtotal persistence boundary

Catalog prices and line quantities are individually bounded, but a cart can contain enough high-value lines for their exact BigInt subtotal to exceed PostgreSQL's signed `BIGINT` range. Quote, group and line amounts are stored as `BIGINT`. Previously that valid cart could reach persistence and fail with an internal database error.

Checkout arithmetic now rejects a line or subtotal above `9,223,372,036,854,775,807` minor units, the storage type's maximum. All amounts remain integer minor units; no floating-point arithmetic or silent truncation is introduced. Since line values are positive, a bounded total also bounds each group subtotal. The API turns this specific failure into `CHECKOUT_SUBTOTAL_LIMIT` (409). Any stock reservations and associated events made earlier in the same transaction roll back. This is a storage-safety ceiling, not a business-approved order limit or an authorization to accept orders of that size.

The checkout UI explains a first definitive limit rejection and allows the buyer to adjust the cart. If an earlier request had an unknown outcome, it still preserves the same retry payload instead of assuming the earlier request failed. Unit tests cover the exact boundary and aggregate overflow; integration coverage constructs eleven valid high-priced variants, checks rejection and rollback on retries, then verifies that a reduced ten-line quote can be created and released. Component tests cover definitive and previously uncertain responses.

This does not implement delivery/tax charges, a final payable total, recipient/address collection or customer-facing COD checkout. No schema migration, hosted data or deployment is included.
