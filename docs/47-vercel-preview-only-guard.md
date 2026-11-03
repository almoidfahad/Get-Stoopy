# 47 — Vercel preview-only guard and production-promotion containment

Status: containment applied; production authorization remains absent.

## Incident

The owner selected **preview-only** deployment scope. After the web-only build fix was pushed as `c72a0f2`, Vercel's existing `main`-branch automation created production deployments for both projects and promoted them:

- `get-stoopy`: `dpl_ARNzkwJBZrpMiAcySViziWFaExYD`
- `getstoopy`: `dpl_88aiU2X3HKWER4CffvysuNmsdMvK`

The builds succeeded, but the automatic production promotion was outside the approved scope. No live payment, payout, cross-border or AI-execution enablement was performed as part of this remediation.

## Containment

The owner chose to pause both projects immediately. Pause was verified by HTTP 503 responses from both production domains and both promoted deployment URLs:

- `https://get-stoopy.vercel.app`
- `https://getstoopy.vercel.app`
- `https://get-stoopy-az9xul8ei-gemini-clone.vercel.app`
- `https://getstoopy-ebw8mhmbr-gemini-clone.vercel.app`

There was no earlier successful production deployment to roll back to. The projects remain paused; preview URLs are also unavailable while paused.

## Permanent guard

`vercel.json` now combines three controls:

1. `git.deploymentEnabled: false` — disables automatic Git-triggered deployments on every branch.
2. `github.autoAlias: false` — prevents automatic production alias promotion if Git deployments are later re-enabled.
3. `ignoreCommand: node scripts/vercel-preview-only.mjs` — Vercel ignored-build-step guard. It proceeds only when `VERCEL_ENV=preview`; production, development and unknown environments exit 0 and cancel the build.

The guard is fail-closed. A manual preview deployment is still allowed; a production build is cancelled even if someone passes `--prod` or changes a dashboard trigger. Re-authorizing production requires an explicit code/config change plus separate owner approval.

## Verification

Local verification on the guarded tree:

- `db:validate`: PASS
- `typecheck`: PASS
- unit: **165 tests / 35 files PASS**
- integration: **124 tests / 23 files PASS**
- design validator: **10 passed / 0 failed**
- full monorepo build: PASS with `NODE_ENV=production`
- Vercel web-only build: PASS with `NODE_ENV=production`

The local `.env` currently sets `NODE_ENV=development`; Next.js production builds must be run with `NODE_ENV=production` (or with `NODE_ENV` unset so Next.js can default it). CI and Vercel do not inherit that local development value.

Remote CI and deployment-status evidence is recorded in the commit/PR checks after push. The regression suite `packages/core/test/vercel-preview-only.test.ts` checks:

- automatic Git deployments and production aliases are disabled;
- the ignored-build-step guard allows preview and cancels production/unknown environments;
- Vercel builds only shared packages + web, while CI retains the full monorepo build;
- CI contains no Vercel production deployment command.

## Resume procedure

Do **not** unpause merely because builds are green. Before resuming any traffic:

1. Confirm the production alias/domain strategy with the owner (there is no prior production rollback candidate).
2. Keep automatic Git deployments disabled and retain the preview-only guard.
3. Create manual preview deployments and verify their build status.
4. Obtain explicit owner approval before unpausing, because unpausing currently also restores the promoted production aliases.
5. Keep live payments, payouts, cross-border and AI execution disabled unless separately authorized.

## References

- Vercel Git configuration: `https://vercel.com/docs/project-configuration/git-configuration`
- Vercel GitHub integration: `https://vercel.com/docs/git/vercel-for-github`
- Vercel build configuration / ignored build step: `https://vercel.com/docs/builds/configure-a-build`
