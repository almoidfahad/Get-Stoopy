#!/usr/bin/env bash
set -euo pipefail
: "${DB_OWNER_PASSWORD:?}"; : "${DB_RUNTIME_PASSWORD:?}"; : "${DB_PRIVILEGED_PASSWORD:?}"
PSQL=(psql -v ON_ERROR_STOP=1)
"${PSQL[@]}" -c "SELECT 1 FROM pg_database WHERE datname='getstoopy_test'" | grep -q 1 || "${PSQL[@]}" -c 'CREATE DATABASE getstoopy_test OWNER gs_owner;'
"${PSQL[@]}" -d getstoopy_test -c 'CREATE EXTENSION IF NOT EXISTS postgis;'
"${PSQL[@]}" -d getstoopy_test -c 'GRANT ALL ON SCHEMA public TO gs_owner;'
