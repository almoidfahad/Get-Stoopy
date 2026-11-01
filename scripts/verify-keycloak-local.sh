#!/usr/bin/env bash
# Local-only OIDC smoke verification. Requires running Keycloak, API and web.
# Reads local .env; never prints credentials or cookies.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${LOCAL_VERIFY_USERNAME:?set LOCAL_VERIFY_USERNAME in local .env}"
: "${LOCAL_VERIFY_PASSWORD:?set LOCAL_VERIFY_PASSWORD in local .env}"
WEB_ORIGIN="${WEB_ORIGIN:-http://localhost:3000}"
JAR="$(mktemp)"; LOGIN_HTML="$(mktemp)"; POST_HTML="$(mktemp)"; ME_JSON="$(mktemp)"; ME2_JSON="$(mktemp)"
trap 'rm -f "$JAR" "$LOGIN_HTML" "$POST_HTML" "$ME_JSON" "$ME2_JSON"' EXIT
curl -fsS -c "$JAR" -o "$LOGIN_HTML" -L "$WEB_ORIGIN/api/auth/login"
ACTION="$(python3 - "$LOGIN_HTML" <<'PY'
import re,sys,html
s=open(sys.argv[1],encoding='utf-8').read()
m=re.search(r'<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"',s) or re.search(r'<form[^>]*action="([^"]+)"[^>]*id="kc-form-login"',s)
if not m: raise SystemExit('LOGIN_FORM_NOT_FOUND')
print(html.unescape(m.group(1)))
PY
)"
REDIRECT="$(curl -fsS -b "$JAR" -c "$JAR" -o "$POST_HTML" -w '%{redirect_url}' \
  --data-urlencode "username=$LOCAL_VERIFY_USERNAME" \
  --data-urlencode "password=$LOCAL_VERIFY_PASSWORD" \
  --data-urlencode 'credentialId=' \
  "$ACTION")"
if [ -z "$REDIRECT" ]; then echo 'KEYCLOAK_LOGIN_FAILED'; exit 1; fi
curl -fsS -b "$JAR" -c "$JAR" -o /dev/null -L "$REDIRECT"
ME_STATUS="$(curl -sS -b "$JAR" -c "$JAR" -o "$ME_JSON" -w '%{http_code}' "$WEB_ORIGIN/api/auth/me")"
if [ "$ME_STATUS" != "200" ]; then echo "ME_EXPECTED_200_GOT_$ME_STATUS"; exit 1; fi
CSRF="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('csrfToken',''))" "$ME_JSON")"
if [ -z "$CSRF" ]; then echo 'CSRF_MISSING'; exit 1; fi
LOGOUT_STATUS="$(curl -sS -b "$JAR" -c "$JAR" -o /dev/null -w '%{http_code}' -X POST \
  -H "Origin: $WEB_ORIGIN" -H "X-CSRF-Token: $CSRF" "$WEB_ORIGIN/api/auth/logout")"
if [ "$LOGOUT_STATUS" != "303" ] && [ "$LOGOUT_STATUS" != "204" ]; then echo "LOGOUT_EXPECTED_303_GOT_$LOGOUT_STATUS"; exit 1; fi
ME2_STATUS="$(curl -sS -b "$JAR" -o "$ME2_JSON" -w '%{http_code}' "$WEB_ORIGIN/api/auth/me")"
if [ "$ME2_STATUS" != "401" ]; then echo "REVOKED_SESSION_EXPECTED_401_GOT_$ME2_STATUS"; exit 1; fi
echo 'PASS: Keycloak OIDC login -> BFF session -> /me -> CSRF logout -> revoked session denied'
