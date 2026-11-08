# 63 — Checkout reservation recovery hardening

The cart's available-to-promise stock can drop after the buyer reserves it. The
cart and checkout pages previously required a currently valid cart before linking
to or loading an existing quote. City lookup failures or removal of coverage also
prevented recovery. This could leave a buyer unable to find and release a hold.

- The cart always links to an active quote, even when the cart is empty or has
  issues, and notes that stock availability may reflect the reservation.
- Checkout loads an active quote before applying the new-quote cart and city
  checks. Existing holds can be viewed and released even when those checks fail.
  New reservation controls remain disabled when their prerequisites are missing.
- A failed quote read is reported explicitly: the reservation might still exist.
  The UI does not assert that stock is free or attempt another reservation.
- A recovered RESERVED quote disables new reservation controls even before the
  client-side clock effect runs.

## Verification and limits

- `npm test`: 307 tests passed, including 10 web rendering/recovery tests. The
  page tests mock API calls and the panel, and the panel tests are server-rendered;
  they are not browser/E2E, concurrency, or live database tests. In particular,
  refresh/state synchronization and release interaction still need browser tests.
- Web TypeScript check and `npm run build:vercel`: passed locally.
- Full typecheck and integration tests were not verified: Prisma client generation
  attempted to download engines from `binaries.prisma.sh`, which is blocked in
  this environment. No remote database was accessed or migrated. The environment
  has Node 22, while the repository declares Node 26.
- `npm audit --omit=dev` reported 13 dependency advisories (12 high, 1 moderate)
  at the time of the check; this is not a security audit or a remediation. Full
  `npm ci` reported 16 advisories including development dependencies. Review and
  test dependency upgrades separately before deployment.

Order placement UI, delivery fees, taxes and real payment are not part of this
change. No production deployment, live payment, or paid resource was enabled.
