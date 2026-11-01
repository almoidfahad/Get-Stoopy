# ADR-003: PostgreSQL/PostGIS, scoped repositories and RLS

Status: ACCEPTED for development — owner approval 2026-11-01. Production/provider gates remain. Date: 2026-11-01.

Context: Administrative geography, service polygons, remote recipient ordering and strict admin isolation must coexist. UI filtering is not authorization.

Decision: One marketplace PostgreSQL database with PostGIS; Prisma migrations and a reviewed spatial adapter. Separate administrative hierarchy from versioned service boundaries. Typed AccessContext and scoped repositories are mandatory; RLS on core scoped tables is defense in depth. Transaction-local context, least-privileged runtime and separate migration owner. Destination controls order operations; buyer residence does not widen access. Financial scope is explicit.

Consequences: Requires composite ancestry constraints, polygon overlap policy, GiST indexes, pooled-context tests and scope-before-aggregation caches/exports. Prisma 8 announces a PostGIS extension, but exact release maturity/compatibility must be tested before pinning; reviewed parameterized SQL remains an option. [2](https://www.prisma.io/blog/prisma-orm-8-closes-330-most-requested-issues)

Alternatives: Raw SQL for all spatial operations; a different ORM was not requested and adds migration cost. Separate city databases violate the centralized model and complicate remote orders/finance.

Review gate: Approve hierarchy, destination visibility and financial-scope anchor. No executable schema/migration exists yet.
