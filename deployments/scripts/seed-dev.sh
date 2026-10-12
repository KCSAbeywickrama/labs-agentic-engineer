#!/bin/bash
# Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
#
# WSO2 LLC. licenses this file to you under the Apache License,
# Version 2.0 (the "License"); you may not use this file except
# in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.

# Local dev only: connects the default org's GitHub PAT, Anthropic API key and
# Claude Code subscription (OAuth) token through PATCH /api/v1/config, so the
# console welcome step is not needed after a fresh `make dev-env`.
#
# /api/v1 takes user tokens only (a client_credentials token is refused whatever
# its audience), so this signs in as a dev user through the same
# authorization-code + PKCE flow the console runs, headless, then sends ONE
# atomic PATCH with the sections that are set in the env file and not already
# connected. Idempotent: a connected section is skipped (each reconnect would
# mint a new SecretReference); SEED_FORCE=1 overwrites.
#
# Reads deployments/.env (each key optional):
#   LOCAL_DEV_ADMIN_GITHUB_PAT, LOCAL_DEV_ADMIN_GITHUB_OWNER   gitProvider (both)
#   ANTHROPIC_API_KEY                                           llm
#   AEP_CODING_ANTHROPIC_KEY                                    Claude Code OAuth
#                                                               token (subscription)
# Claude Code is the default runtime and is set explicitly.
#
# Knobs: THUNDER_URL, API_URL, CONSOLE_URL, SEED_USER / SEED_PASSWORD (the
# local Thunder admin, setup-env-for-aectl.sh), ENV_FILE, SEED_FORCE.
# Secrets are read from the file and sent on stdin, never on argv or echoed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/../.env}"
THUNDER_URL="${THUNDER_URL:-http://thunder.openchoreo.localhost:8080}"
CONSOLE_URL="${CONSOLE_URL:-http://console.ae.localhost:8080}"
API_URL="${API_URL:-${CONSOLE_URL}/aep-api-service}"
SEED_USER="${SEED_USER:-admin}"
SEED_PASSWORD="${SEED_PASSWORD:-Admin@123}"
CLIENT_ID="aep-console-client"

command -v jq >/dev/null 2>&1 || { echo "❌ jq not found on PATH"; exit 1; }

# Whitelist-load one key: the file may hold values with spaces or '='.
env_key() {
  local key="$1" val
  val="${!key:-}"
  if [ -z "$val" ] && [ -f "$ENV_FILE" ]; then
    val=$(grep "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2- || true)
    val="${val#\"}"; val="${val%\"}"; val="${val#\'}"; val="${val%\'}"
  fi
  printf '%s' "$val"
}
GITHUB_PAT=$(env_key LOCAL_DEV_ADMIN_GITHUB_PAT)
GITHUB_OWNER=$(env_key LOCAL_DEV_ADMIN_GITHUB_OWNER)
ANTHROPIC_KEY=$(env_key ANTHROPIC_API_KEY)
OAUTH_TOKEN=$(env_key AEP_CODING_ANTHROPIC_KEY)

echo "=== seed-dev (local dev only) ==="

curl -fsS --max-time 5 "${API_URL}/healthz" >/dev/null 2>&1 \
  || { echo "❌ aep-api not reachable at ${API_URL}"; exit 1; }

# Headless sign-in: authorize -> flow/execute (credentials) -> auth/callback
# -> code -> token. The callback JSON escapes '&' as &, so the code is
# read with jq, not a regex.
verifier=$(openssl rand -base64 48 | tr -d '=+/\n' | head -c 64)
challenge=$(printf %s "$verifier" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
loc=$(curl -sS --max-time 10 -i -G "${THUNDER_URL}/oauth2/authorize" \
  --data-urlencode "client_id=${CLIENT_ID}" --data-urlencode response_type=code \
  --data-urlencode "redirect_uri=${CONSOLE_URL}/callback" --data-urlencode "scope=openid profile" \
  --data-urlencode "code_challenge=${challenge}" --data-urlencode code_challenge_method=S256 \
  --data-urlencode state=seed | tr -d '\r' | sed -n 's/^[Ll]ocation: //p')
auth_id=$(printf '%s' "$loc" | sed -n 's/.*authId=\([^&]*\).*/\1/p')
exec_id=$(printf '%s' "$loc" | sed -n 's/.*executionId=\([^&]*\).*/\1/p')
[ -n "$auth_id" ] && [ -n "$exec_id" ] || { echo "❌ Thunder did not start a sign-in flow"; exit 1; }

flow() { curl -sS --max-time 10 -X POST "${THUNDER_URL}/flow/execute" -H 'Content-Type: application/json' -d @-; }
challenge_token=$(jq -n --arg e "$exec_id" '{executionId:$e,action:"",inputs:{}}' | flow | jq -r '.challengeToken // empty')
assertion=$(jq -n --arg e "$exec_id" --arg c "$challenge_token" --arg u "$SEED_USER" --arg p "$SEED_PASSWORD" \
  '{executionId:$e,action:"action_001",challengeToken:$c,inputs:{username:$u,password:$p}}' | flow | jq -r '.assertion // empty')
[ -n "$assertion" ] || { echo "❌ sign-in as ${SEED_USER} failed (wrong SEED_USER/SEED_PASSWORD?)"; exit 1; }

code=$(jq -n --arg a "$auth_id" --arg s "$assertion" '{authId:$a,assertion:$s}' \
  | curl -sS --max-time 10 -X POST "${THUNDER_URL}/oauth2/auth/callback" -H 'Content-Type: application/json' -d @- \
  | jq -r '.redirect_uri // empty' | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')
[ -n "$code" ] || { echo "❌ Thunder returned no authorization code"; exit 1; }
token=$(curl -sS --max-time 10 -X POST "${THUNDER_URL}/oauth2/token" \
  -d grant_type=authorization_code -d "client_id=${CLIENT_ID}" \
  --data-urlencode "code=${code}" --data-urlencode "redirect_uri=${CONSOLE_URL}/callback" \
  --data-urlencode "code_verifier=${verifier}" | jq -r '.access_token // empty')
[ -n "$token" ] || { echo "❌ token exchange failed"; exit 1; }
echo "✅ Signed in as ${SEED_USER}"

# The bearer goes in a curl config read from stdin so it never appears on argv.
config=$(printf 'header = "Authorization: Bearer %s"\n' "$token" \
  | curl -sS --max-time 30 -K - "${API_URL}/api/v1/config")
connected() { # connected jq-path : true when that section is non-null
  [ "${SEED_FORCE:-0}" = "1" ] && return 1
  [ "$(printf '%s' "$config" | jq -r "${1} != null")" = "true" ]
}

patch='{"agents":{"runtime":"claude-code"}}'
labels="Claude Code runtime"

if [ -n "$ANTHROPIC_KEY" ]; then
  if connected .llm; then echo "✅ Anthropic API key already connected, skipping"
  else
    patch=$(jq -nc --argjson p "$patch" --arg k "$ANTHROPIC_KEY" '$p + {llm:{kind:"anthropic",apiKey:$k}}')
    labels="${labels} + Anthropic API key"
  fi
else echo "⏭️  ANTHROPIC_API_KEY not set, skipping the API key"; fi

if [ -n "$OAUTH_TOKEN" ]; then
  if connected .agents.subscription; then echo "✅ Claude subscription token already connected, skipping"
  else
    patch=$(jq -nc --argjson p "$patch" --arg t "$OAUTH_TOKEN" '$p | .agents.subscription = {kind:"claude",token:$t}')
    labels="${labels} + Claude OAuth token"
  fi
else echo "⏭️  AEP_CODING_ANTHROPIC_KEY (OAuth token) not set, skipping the subscription"; fi

if [ -n "$GITHUB_PAT" ] && [ -n "$GITHUB_OWNER" ]; then
  if connected .gitProvider; then echo "✅ GitHub already connected, skipping"
  else
    patch=$(jq -nc --argjson p "$patch" --arg pat "$GITHUB_PAT" --arg login "$GITHUB_OWNER" \
      '$p + {gitProvider:{kind:"github",mode:"pat",pat:$pat,githubLogin:$login}}')
    labels="${labels} + GitHub PAT"
  fi
else echo "⏭️  LOCAL_DEV_ADMIN_GITHUB_PAT / _OWNER not set, skipping GitHub"; fi

echo "🔗 Connecting: ${labels}"
resp=$(mktemp); trap 'rm -f "$resp"' EXIT
# Body on stdin and the bearer in a process-substitution curl config: neither is on argv.
code=$(curl -sS --max-time 60 -K <(printf 'header = "Authorization: Bearer %s"\n' "$token") \
  -o "$resp" -w '%{http_code}' -X PATCH "${API_URL}/api/v1/config" \
  -H 'Content-Type: application/json' -d @- <<<"$patch")
case "$code" in
  2*) echo "✅ Connected (HTTP ${code})" ;;
  *)  echo "❌ PATCH /config failed (HTTP ${code}): $(head -c 300 "$resp" | jq -r '.message // .' 2>/dev/null)"; exit 1 ;;
esac
echo "=== seed-dev complete ==="
