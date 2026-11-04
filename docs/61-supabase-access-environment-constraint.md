# 61 — Supabase access: why the CLI device flow cannot complete in this environment

Status: **blocked, with the cause now identified.** No migration, query or schema
change has been made against any Supabase project.

## The finding

The agent sandbox is **restarted whenever the turn pauses for user input**. This
was measured directly, not assumed:

- a Supabase CLI login was started and left waiting at `Enter your verification
  code:`;
- the turn paused to ask the owner for that code;
- on resuming, `cat /proc/uptime` reported the machine had been up **4 minutes**,
  the CLI process was gone, its FIFO was gone, and `~/.supabase` had been
  recreated empty.

Snapshot-excluded paths (`.local`, `.cache`, `/tmp`) are wiped on the same restart,
and `.git/config` is excluded too — so the repository's `origin` remote and the
git credential helper configuration also disappear.

## Why this defeats the device flow specifically

The Supabase CLI device flow requires **one continuous process**:

1. the CLI generates a key pair and registers a login session;
2. the owner opens the dashboard link and reads a verification code;
3. the code must be typed **into that still-running process**, which then
   completes the exchange and stores the token.

Step 2 requires asking the owner, and asking the owner restarts the sandbox and
kills the process from step 1. The private key never persists, so a code delivered
after the pause cannot be redeemed by a new process either.

This is a structural limitation, **not** an owner error. Five sessions have now
failed this way (`279f242b`, `2a47b95d`, `8183d71d`, `ade37b71…`, `7d3ce784…`). The
codes the owner supplied were not wrong; the receiving process was already dead.

**Do not attempt the interactive CLI device flow in this environment again.**
Retrying it wastes the owner's time and produces the same result.

## Current connector state (read-only checks)

The Supabase connector is **enabled** for this conversation, and it is
authenticated as an account that can see the correct organisation:

| Check | Result |
| --- | --- |
| `list_organizations` | `nvzdtellxsolovaexwnr` — "almoidfahad's Org" |
| `list_projects` | `[]` — **no projects visible** |
| `get_project xiyfzjjgkmtoxchfexyi` | **403 Authentication failed** |

So the connector reaches the right org but sees zero projects in it, and the
target project reference is refused. Re-authenticating alone is not evidence that
this will change; the 403 must not be retried blindly, and no new project may be
created (owner constraint: existing project only).

The open question for the owner is therefore about **ownership/visibility**, not
about credentials: does `xiyfzjjgkmtoxchfexyi` still exist, is it in
`almoidfahad's Org`, is it active rather than paused, and is the connected account
the one that owns it?

## Tooling change made as a result

`gh` is now installed under **`/home/user/tooling/gh`** (snapshot-durable) instead
of `/tmp`, which was wiped on every restart. The git credential helpers for
`github.com` and `gist.github.com` point at that path. Release tarballs continue to
be checksum-verified before use.

After a restart, the repository remote must be re-added before pushing:

```
git remote add origin https://github.com/almoidfahad/Get-Stoopy.git
```

Executable bits on `scripts/*.sh` and `scripts/*.mjs` are also reset to `644` by
the snapshot restore; restore them with `chmod +x` so the working tree is clean.
Neither is a source change.

## What is *not* blocked

Application work that needs no Supabase access continues normally against the
local disposable PostgreSQL/PostGIS test database: the serviceable-destination
slice is complete, CI is green, and preview-only deployments are verified. The
checkout quote UI slice does not depend on Supabase.

## Gates still required before any Supabase migration

Unchanged from `docs/48`: Management API visibility → read-only preflight
(PostGIS, schemas, `_prisma_migrations`, roles/RLS) → owner approval of the exact
forward migration plan and role/grant bootstrap → migrate → all five gates → CI →
preview-only deployment. Seoul (`ap-northeast-2`) remains **development only**.
