# 46 — Vercel build remediation

Status: development/preview build configuration; no live payment, payout or production money-movement enablement.

## Problem
Both Vercel projects (`get-stoopy` and `getstoopy`) were importing the monorepo root with the default Next.js build command. That executed the root `npm run build`, which also builds the NestJS API and worker. On Vercel the Prisma client was not generated before that full build, producing TypeScript errors in API services. The web app itself builds successfully.

## Fix
- Add root `vercel.json` with an explicit web-only build:
  - install: pinned npm 10.8.2 + `npm ci`
  - build: `npm run build:vercel` = shared packages + Next.js web only
  - output: `apps/web/.next`
- Update both Vercel projects to the same explicit build/install/output settings.
- Add `npm run build` to GitHub Actions validation so full monorepo build regressions are caught before deployment.

## Boundary
This fixes deployment build checks only. `PAYMENTS_LIVE_ENABLED`, `PAYOUTS_LIVE_ENABLED`, `CROSS_BORDER_ENABLED` and AI execution remain disabled. Provider credentials, live reconciliation, refunds/adjustments and production promotion still require separate authorization.
