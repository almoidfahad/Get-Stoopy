# Geographic hierarchy, serviceability and remote ordering

## Canonical hierarchy

```text
Global (virtual root; not a tenant database)
└── Country (BD initially enabled; US prepared but disabled)
    └── Region / Division / State
        └── District
            └── City OR Upazila (country-configurable operational unit)
                └── Service Zone (business polygon, not necessarily a ward)
                    └── Neighborhood / Ward / Locality (optional)
```

Administrative boundary and service coverage are distinct. A city may launch only a few zones. Store service areas can span multiple zones only with authorization. A vendor is a legal business; Store is a pickup branch. This avoids losing the historical multi-city/branch requirement while preserving one vendor ledger.

Purbadhala is an upazila in **Netrokona District**, Mymensingh Division; it is not a child of Mymensingh City. Bangladesh Post's directory lists Purbadhala under Netrokona. [2](https://bdpost.portal.gov.bd/site/page/453622ed-3b80-4cc8-aa47-7f12eb19d821) Proposed pilots are separate: Mymensingh City operational zones and Purbadhala operational zones. Exact polygons, launch status and participating stores require owner/operations approval. Voice transcripts contain spelling variants; no unsupported boundary is inferred from them.

## Storage and polygon rules

- PostgreSQL/PostGIS geometry SRID 4326 for input/exchange; validate latitude/longitude ranges and geometry validity. Use a suitable geography cast or projected geometry only for explicitly tested distance operations.
- `BoundaryVersion` is append-only after approval; active pointer changes atomically. Store source, effective date, hash, approver and version. Keep the version used by each checkout/dispatch decision.
- MultiPolygon supports enclaves; reject self-intersections and empty geometry. GiST indexes support point-in-polygon and candidate searches.
- A zone must belong to exactly one City; ancestry must match Country→Region→District→City. A point in a parent boundary does not automatically mean service available.
- Define overlap policy before launch: reject ambiguous overlapping active zones or resolve by explicit priority with a deterministic tie rule. Do not select the first SQL row.
- Boundary points exactly on an edge use a documented PostGIS covers/contains policy and fixtures; no floating-point UI decision.
- Map drawing is an admin proposal. Higher approval activates a version. Ordinary admins cannot change their own scope by editing a service polygon.
- PostGIS access is implemented through typed repository adapters and reviewed SQL or a version-pinned supported ORM extension. Prisma's current PostGIS capabilities must be checked at implementation lock time; do not assume all spatial operators are native. [1](https://www.prisma.io/docs/orm/prisma-client/queries/raw-database-access/custom-and-type-safe-queries) [3](https://www.prisma.io/blog/prisma-orm-8-closes-330-most-requested-issues)

## Recipient-first checkout

```text
Buyer (any location within an enabled origin country)
  + Recipient (separate name/phone/address snapshot)
  → destination Country must equal enabled order country
  → destination City/Zone active and within operating hours
  → validated destination point + polygon version
  → eligible store service areas + sellable inventory
  → road route / delivery quote / fee / ETA
  → risk evaluation (buyer signals are not destination proof)
  → destination-scoped parent order + vendor suborders
  → destination-eligible rider dispatch
```

**Deliver to Myself** reuses a saved buyer address but still creates a recipient snapshot. **Deliver to Someone Else** collects the recipient independently. A Dhaka buyer can order for a Mymensingh recipient if that destination is supported. A buyer outside the destination zone is not fraud by that fact alone. Buyer GPS may be unavailable/declined; offer address-based checkout with risk-appropriate phone verification. Do not require buyer GPS to match recipient address.

The older conversation's strict buyer-GPS rule is explicitly superseded by master §10 and the later remote-ordering discussion. GPS, IP/VPN and device integrity are probabilistic risk inputs, never authoritative proof of recipient location. Phone OTP proves control of a number, not physical presence. No covert microphone/call access.

## Access scope for cross-area records

| Resource | Scope anchor | Important rule |
|---|---|---|
| Customer profile | Consent + support purpose; country/zone only for assigned support | Buyer residence does not grant buyer's city access to destination financial records |
| Vendor/store/product | Store location and approved service areas | Vendor owner limited to own business; admin scope intersects store/operational area |
| Parent order | Recipient destination zone for local operations | Buyer can always access own order; buyer-city admin does not automatically see remote destination order |
| Vendor suborder | Destination zone + vendor/store | City finance sees authorized destination operations, not other-city vendor ledger |
| Delivery/rider assignment | Pickup + destination zones and rider grant | Cross-zone job needs both service permissions or approved exception |
| Rider profile | Home/assigned operational scope | Relocating GPS does not rewrite admin assignment |
| Payment/refund/settlement | Merchant country + explicit financial-scope anchor | A zone operational role does not automatically receive bank data |
| Report/export/search/AI | Same predicate as underlying rows | Apply scope before aggregation/cache, not after |

For a multi-zone or multi-store parent, return only authorized suborders to local staff; mask totals that would reveal other scopes. Country-level consolidation is available only to roles with all contributing scopes. Define financial reporting anchor explicitly before Phase 7; no accidental “buyer city gets all revenue” rule.

## Rider eligibility and exceptions

Default own-zone work; time-limited neighboring-zone permission may be granted by an authorized higher admin. Every offer checks active KYC, vehicle class, active shift, consent, online status, capacity, allowed pickup/destination zones, location freshness/accuracy and road distance. Reject stale/spoof-suspect locations for new offers with a verification path. Do not cancel an existing delivery just because a rider crosses a boundary. Manual dispatch and temporary overrides require reason, expiry, actor and audit; they never bypass identity/KYC or create a second final assignment.

Google Routes exposes road `distanceMeters`, duration and traffic-aware routing options; Route Matrix supports multiple origins/destinations. Use these for route evidence, not an invented traffic payment multiplier. [1](https://developers.google.com/maps/documentation/routes/compute_route_directions) [2](https://developers.google.com/maps/documentation/routes/reference/rpc/google.maps.routing.v2)

## Geographic acceptance fixtures (planned)

- Same-country Dhaka→Mymensingh supported remote order succeeds without matching buyer GPS.
- Unsupported/inactive destination, ambiguous polygon, cross-border destination and closed operating window fail clearly before payment capture.
- Boundary revision does not rewrite historical order/fee evidence.
- Purbadhala admin cannot read Mymensingh City or Dhaka records; Mymensingh regional admin can read only descendant scope.
- Rider location stale, outside approved zone, expired override or inactive KYC prevents new offer; active delivery gets safe exception handling.
- SQL, API, export, report, cache and websocket tests all enforce the same scope.
