# Incremental build cache correctness + test environment rebuild

Status: **fixed and verified.** No product behaviour changed.

## Problem

After a workspace snapshot restore, `npm run typecheck` failed with ~100 errors of the form:

```
error TS2307: Cannot find module '@getstoopy/core' or its corresponding type declarations.
```

`npm run build:packages` reported success but emitted nothing.

## Root cause

The eight workspace packages use `tsc -b` (project references, `composite: true`). TypeScript
writes its incremental cache to `packages/<pkg>/tsconfig.tsbuildinfo`, **next to the tsconfig**,
while the emitted output goes to `packages/<pkg>/dist/`.

Those two locations have different lifetimes: `dist/` is a generated build directory and is not
preserved, but `tsconfig.tsbuildinfo` sat outside it and survived. On restore, `tsc -b` read the
stale cache, concluded every project was up to date, and skipped emission — so `dist/` stayed
empty and every dependent app failed to resolve `@getstoopy/*`.

This is a cache/output lifetime mismatch, not a source-code defect. It would recur on any
machine or CI runner that restores the cache without the output.

## Fix

Point the incremental cache **inside the output directory** for all eight packages:

```json
"tsBuildInfoFile": "dist/tsconfig.tsbuildinfo"
```

Cache and output now share one lifetime. If `dist/` is absent, the cache is absent too, so
`tsc -b` correctly rebuilds. Incremental builds still work when both are present. No `--force`
flag and no clean-step is needed, and no build gets slower.

Packages updated: `auth`, `bff`, `config`, `core`, `events`, `ledger`, `observability`, `storage`.

## Test environment rebuild (sandbox reset)

The sandbox was reset, removing the Node toolchain, PostgreSQL/PostGIS, Redis, installed
dependencies and file modes. Rebuilt from pinned sources:

| Component | Version | Verification |
| --- | --- | --- |
| Node | 26.13.0 | SHA-256 matched `SHASUMS256.txt` |
| PostgreSQL | 17 + PostGIS 3 | distro packages |
| Redis | 8.0.2 | distro package |
| Dependencies | `npm ci` from lockfile | clean install |
| Schema | 71 migrations | applied to `getstoopy_foundation_test` |

Executable bits on `scripts/*.sh` / `*.mjs` and the `origin` remote were restored; neither is a
source change.

## Gate results after the fix

| Gate | Result |
| --- | --- |
| `db:validate` | PASS |
| `typecheck` | PASS |
| unit | **187 / 38 files** PASS |
| integration | **148 / 26 files** PASS |
| design validator | **10 passed / 0 failed** |
| `build` | PASS |
| `build:vercel` | PASS |

The design validator needs its Python dependencies (`openapi-spec-validator==0.7.2`,
`markdown-it-py`, `beautifulsoup4`, `PyYAML`, `Pillow`), exactly as CI installs them; a missing
module is an environment gap, not a validation failure.

## Boundary

Test database only. No production or Supabase migration, no live payment, no money movement.
