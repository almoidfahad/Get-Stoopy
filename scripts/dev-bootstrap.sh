#!/usr/bin/env bash
# Rebuild a local development/test environment from pinned sources.
#
# Safe by construction:
#   * never targets production; the application databases are created locally
#   * only the isolated *_foundation_test database is migrated
#   * reads credentials from the existing, uncommitted .env; prints no secret values
#   * idempotent: re-running skips anything already present
#
# Usage:  bash scripts/dev-bootstrap.sh
# Requires: Debian/Ubuntu with passwordless sudo (for distro PostgreSQL/Redis only).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

NODE_VERSION="${NODE_VERSION:-v26.13.0}"
# Excluded-from-snapshot paths are rebuilt, not trusted.
TOOLCHAINS="${HOME}/.local/toolchains"
TEST_DB="${TEST_DB:-getstoopy_foundation_test}"

log() { printf '\n==> %s\n' "$*"; }

# --- 1. Node (checksum verified) ---------------------------------------------
NODE_HOME="${TOOLCHAINS}/node-${NODE_VERSION}-linux-x64"
if [[ ! -x "${NODE_HOME}/bin/node" ]]; then
  log "Installing Node ${NODE_VERSION}"
  mkdir -p "$TOOLCHAINS"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  (
    cd "$tmp"
    curl -fsSLO "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz"
    curl -fsSLO "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt"
    expected="$(grep " node-${NODE_VERSION}-linux-x64.tar.xz\$" SHASUMS256.txt | awk '{print $1}')"
    actual="$(sha256sum "node-${NODE_VERSION}-linux-x64.tar.xz" | awk '{print $1}')"
    [[ -n "$expected" && "$expected" == "$actual" ]] || { echo "NODE_CHECKSUM_MISMATCH" >&2; exit 1; }
    echo "node checksum OK"
    tar -xJf "node-${NODE_VERSION}-linux-x64.tar.xz" -C "$TOOLCHAINS"
  )
  rm -rf "$tmp"; trap - EXIT
fi
export PATH="${NODE_HOME}/bin:${PATH}"
# Match the version CI and Vercel install; engines requires npm >=10 <11.
if [[ "$(npm -v)" != 10.8.2 ]]; then
  log "Pinning npm 10.8.2"
  npm install --global --silent npm@10.8.2
fi
log "Node $(node -v), npm $(npm -v)"

# --- 2. PostgreSQL + PostGIS + Redis ----------------------------------------
if ! command -v psql >/dev/null 2>&1; then
  log "Installing PostgreSQL 17 + PostGIS 3 + Redis"
  export DEBIAN_FRONTEND=noninteractive
  sudo apt-get update -qq
  sudo apt-get install -y -qq postgresql-17 postgresql-17-postgis-3 redis-server
fi
if ! sudo -u postgres /usr/lib/postgresql/17/bin/pg_isready -q -h /var/run/postgresql -p 5432; then
  log "Starting PostgreSQL"
  sudo pg_ctlcluster 17 main start
fi
if ! redis-cli -h 127.0.0.1 -p 6379 ping >/dev/null 2>&1; then
  log "Starting Redis (no persistence; test queue only)"
  redis-server --bind 127.0.0.1 --port 6379 --save '' --appendonly no --daemonize yes
fi

# --- 3. Script modes and git remote -----------------------------------------
log "Restoring script modes and git remote"
chmod 755 scripts/*.sh
chmod 755 scripts/supabase-preflight.mjs scripts/vercel-preview-only.mjs
chmod 644 scripts/prisma.mjs
git remote get-url origin >/dev/null 2>&1 || \
  git remote add origin https://github.com/almoidfahad/Get-Stoopy.git

# --- 4. Dependencies ---------------------------------------------------------
if [[ ! -d node_modules ]]; then
  log "npm ci (from lockfile)"
  npm ci --no-audit --no-fund
fi

# --- 5. Roles and isolated test database ------------------------------------
[[ -f .env ]] || { echo "Missing .env (uncommitted local file). Aborting." >&2; exit 1; }
set -a; source .env; set +a

extract_password() {
  python3 -c "import os,urllib.parse as u;print(u.unquote(u.urlsplit(os.environ['$1']).password or ''))"
}
DB_OWNER_PASSWORD="$(extract_password DATABASE_MIGRATION_URL)"
DB_RUNTIME_PASSWORD="$(extract_password DATABASE_URL)"
DB_PRIVILEGED_PASSWORD="$(extract_password DATABASE_PRIVILEGED_URL)"
export DB_OWNER_PASSWORD DB_RUNTIME_PASSWORD DB_PRIVILEGED_PASSWORD
[[ -n "$DB_OWNER_PASSWORD" && -n "$DB_RUNTIME_PASSWORD" && -n "$DB_PRIVILEGED_PASSWORD" ]] \
  || { echo "Could not read local DB credentials from .env" >&2; exit 1; }

log "Ensuring least-privilege roles"
sudo -E -u postgres bash scripts/setup-db-roles.sh >/dev/null

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${TEST_DB}'" | grep -q 1; then
  log "Creating ${TEST_DB}"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${TEST_DB} OWNER gs_owner;"
fi
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$TEST_DB" -c 'CREATE EXTENSION IF NOT EXISTS postgis;' >/dev/null
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$TEST_DB" -c 'GRANT ALL ON SCHEMA public TO gs_owner;' >/dev/null

# --- 6. Point every URL at the test database, never the dev/prod one ---------
export DATABASE_URL="${DATABASE_URL%/*}/${TEST_DB}"
export DATABASE_PRIVILEGED_URL="${DATABASE_PRIVILEGED_URL%/*}/${TEST_DB}"
export DATABASE_MIGRATION_URL="${DATABASE_MIGRATION_URL%/*}/${TEST_DB}"
export TEST_DATABASE_URL="$DATABASE_URL"
export TEST_DATABASE_PRIVILEGED_URL="$DATABASE_PRIVILEGED_URL"
export TEST_DATABASE_MIGRATION_URL="$DATABASE_MIGRATION_URL"
export TEST_REDIS_URL="${TEST_REDIS_URL:-redis://localhost:6379/15}"

log "Prisma generate + migrate (test database only)"
npm run db:generate >/dev/null
npm run db:migrate
psql "$DATABASE_MIGRATION_URL" -v ON_ERROR_STOP=1 -f scripts/db-grants.sql >/dev/null
echo "applied migrations: $(psql "$DATABASE_MIGRATION_URL" -tAc 'SELECT count(*) FROM _prisma_migrations')"

# --- 7. Design-validator Python dependencies --------------------------------
DESIGN_VENV="${HOME}/.local/gs-design-venv"
if [[ ! -x "${DESIGN_VENV}/bin/python" ]]; then
  log "Installing design-validator dependencies"
  python3 -m venv "$DESIGN_VENV"
  "${DESIGN_VENV}/bin/pip" install --quiet --disable-pip-version-check \
    openapi-spec-validator==0.7.2 markdown-it-py beautifulsoup4 PyYAML Pillow
fi

# --- 8. Emit a sourceable environment file for gates ------------------------
mkdir -p "${HOME}/.local"
cat > "${HOME}/.local/gs-gate-env.sh" <<EOF
cd ${REPO_ROOT}
export PATH="${NODE_HOME}/bin:\$PATH"
set -a; source .env; set +a
export DATABASE_URL="${DATABASE_URL}"
export DATABASE_PRIVILEGED_URL="${DATABASE_PRIVILEGED_URL}"
export DATABASE_MIGRATION_URL="${DATABASE_MIGRATION_URL}"
export TEST_DATABASE_URL="${DATABASE_URL}"
export TEST_DATABASE_PRIVILEGED_URL="${DATABASE_PRIVILEGED_URL}"
export TEST_DATABASE_MIGRATION_URL="${DATABASE_MIGRATION_URL}"
export TEST_REDIS_URL="${TEST_REDIS_URL}"
export GS_DESIGN_PYTHON="${DESIGN_VENV}/bin/python"
EOF
chmod 600 "${HOME}/.local/gs-gate-env.sh"

log "Bootstrap complete"
cat <<'EOF'
Run the gates with:
  source ~/.local/gs-gate-env.sh
  npm run db:validate && npm run typecheck && npm test \
    && npm run test:integration && "$GS_DESIGN_PYTHON" tools/validate_design_artifacts.py
EOF