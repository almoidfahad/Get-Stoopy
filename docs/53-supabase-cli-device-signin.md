# Supabase CLI device sign-in (owner-authorized, no pasted tokens)

Status: **tooling installed and device flow verified up to the owner authorization step.**
The owner deferred authorization, so **no Supabase session is active** and no Supabase project,
database, configuration or migration was touched.

## Why this path exists

The Supabase MCP connector returns `403` for the owner's project refs and an empty project list,
and the connector is **disabled** for this conversation. Pasted publishable/secret keys were
refused and must be rotated; a database key cannot fix a Management API authorization failure.

The Supabase CLI supports an interactive **device-style login**: the CLI generates a keypair,
prints a dashboard URL, the owner signs in with the owning account and approves, and the dashboard
shows a short one-time verification code. The CLI exchanges the code for a token **directly**.
The token never passes through chat, a file in the repo, or an environment variable we author.

## Pinning and verification

- Release: `supabase/cli` **v3.0.0** (published 2026-11-02).
- Asset: `supabase_3.0.0_linux_amd64.tar.gz`.
- SHA-256 verified against the release `checksums.txt` before extraction:
  `eeb61edcd59a4735fcb5e58596574f25d03d420efca779f43ddb307e1cc5c754`.
- Installed outside the repo at `~/.local/toolchains/supabase-v3.0.0/supabase`.
- CLI credential home is redirected to a sandbox-local, non-persisted directory
  (`$HOME/.arena/gs-supabase-home`), so no token can land in the repository or a workspace snapshot.

## Procedure

```bash
export HOME=<non-persisted credential home>
export PATH="$HOME/.local/toolchains/supabase-v3.0.0:$PATH"
supabase login --no-browser --name get-stoopy-agent
```

The command prints `https://supabase.com/dashboard/cli/login?session_id=...&public_key=...`
and then waits at `Enter your verification code:`. The owner opens the link, signs in with the
account that owns the target organization, approves the token name, and reads the code back.
A pseudo-terminal is required; without one the CLI emits no prompt.

Verify afterwards, read-only:

```bash
supabase projects list
supabase organizations list
```

## Authorization boundary

- `supabase login` mints a token with the signing-in account's access. Prefer a **scoped**
  dashboard token if the owner wants narrower permissions; scoped tokens are supplied by the
  owner directly to the CLI, never through this conversation.
- Login alone grants no database access. Prisma remains the sole migration owner, Keycloak
  remains the identity provider, and Supabase is a managed PostgreSQL/PostGIS host only.
- The first database action after login stays **read-only**:
  `npm run db:preflight:supabase` with `SUPABASE_DEV_DATABASE_URL` pointed at the
  **session pooler on port 5432** (transaction-mode 6543 is rejected for migrations).
- No new Supabase project is authorized. No production migration is authorized.
- Seoul (`ap-northeast-2`) latency/residency still needs explicit owner sign-off.

## Current state

Device flow reached the verification-code prompt and was then cancelled at the owner's request.
Nothing was authorized, no token was issued to this session, and the parked Supabase blockers
(Management API visibility, pooler URL, region sign-off) remain open.
