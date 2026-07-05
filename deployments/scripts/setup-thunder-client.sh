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

# Create the POC's confidential OAuth client in Thunder for the API Platform
# verification flow. Idempotent — re-running checks for an existing app and
# only creates one if absent.
#
# Writes the resulting client_id/client_secret to deployments/.poc-api-platform-client.env
# which verify-api-platform.sh reads to mint tokens.
#
# Why exec into the Thunder pod: the admin API at :8090 is not externally
# exposed in deployments/, and the bootstrap scripts shipped with the Thunder
# image (`common.sh` + `thunder_api_call`) already know the right admin token
# / OU lookup mechanics. We piggyback on them.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
source "$SCRIPT_DIR/env.sh"

CLIENT_ID="${POC_CLIENT_ID:-poc-api-platform-client}"
CLIENT_SECRET="${POC_CLIENT_SECRET:-poc-api-platform-secret}"
OUT_FILE="${SCRIPT_DIR}/../.poc-api-platform-client.env"

echo "=== Bootstrapping POC OAuth client in Thunder ==="

THUNDER_POD=$(kubectl --context "${CLUSTER_CONTEXT}" get pod -n thunder \
    -l app.kubernetes.io/name=thunder -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
if [ -z "${THUNDER_POD}" ]; then
    echo "❌ Thunder pod not found. Run setup-openchoreo.sh first." >&2
    exit 1
fi
echo "Thunder pod: ${THUNDER_POD}"

# The Thunder image shipped with OC 1.1.1 gates its admin REST API behind
# Bearer auth once its own bootstrap job finishes (Www-Authenticate: Bearer;
# THUNDER_SKIP_SECURITY=false on the runtime deployment). This script runs
# AFTER that lock, so for LOCAL DEV we temporarily lift the gate around the
# client registration and restore it afterwards. The trap restores security
# even if the registration fails mid-way.
SKIP_SEC_CURRENT=$(kubectl --context "${CLUSTER_CONTEXT}" get deploy -n thunder thunder-deployment \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="THUNDER_SKIP_SECURITY")].value}')
restore_thunder_security() {
    if [ "${SKIP_SEC_CURRENT}" != "true" ]; then
        echo "🔒 Restoring THUNDER_SKIP_SECURITY=${SKIP_SEC_CURRENT:-false}"
        kubectl --context "${CLUSTER_CONTEXT}" set env deploy/thunder-deployment -n thunder \
            THUNDER_SKIP_SECURITY="${SKIP_SEC_CURRENT:-false}" >/dev/null
        kubectl --context "${CLUSTER_CONTEXT}" rollout status deploy/thunder-deployment -n thunder --timeout=180s >/dev/null
    fi
}
if [ "${SKIP_SEC_CURRENT}" != "true" ]; then
    echo "🔓 Temporarily setting THUNDER_SKIP_SECURITY=true for client bootstrap"
    kubectl --context "${CLUSTER_CONTEXT}" set env deploy/thunder-deployment -n thunder \
        THUNDER_SKIP_SECURITY=true >/dev/null
    kubectl --context "${CLUSTER_CONTEXT}" rollout status deploy/thunder-deployment -n thunder --timeout=180s >/dev/null
    trap restore_thunder_security EXIT
    # the pod was replaced by the rollout — re-resolve it
    THUNDER_POD=$(kubectl --context "${CLUSTER_CONTEXT}" get pod -n thunder \
        -l app.kubernetes.io/name=thunder -o jsonpath='{.items[0].metadata.name}')
    echo "Thunder pod (post-rollout): ${THUNDER_POD}"
fi

# The Thunder bootstrap scripts live under /home/wso2thunder/thunder/scripts
# in the v0.34 image and are sourced as `common.sh`. We replicate the same
# pattern here in a one-shot inline script piped into the pod.
kubectl --context "${CLUSTER_CONTEXT}" exec -i -n thunder "${THUNDER_POD}" -- \
    bash -s -- "${CLIENT_ID}" "${CLIENT_SECRET}" <<'POD_SCRIPT'
set -e
CLIENT_ID="$1"
CLIENT_SECRET="$2"

# The image's common.sh builds URLs from THUNDER_API_BASE — default it for
# in-pod calls (the bootstrap job sets it; a bare exec shell does not).
export THUNDER_API_BASE="${THUNDER_API_BASE:-http://localhost:8090}"

# Source common.sh if available (provides thunder_api_call; on gated images
# the surrounding script lifts THUNDER_SKIP_SECURITY for the duration).
# Path varies by Thunder version; probe known locations.
# /opt/thunder/bootstrap/ is where the image shipped with OC 1.1.1 keeps it.
for candidate in \
    /opt/thunder/bootstrap/common.sh \
    /home/wso2thunder/thunder/scripts/common.sh \
    /opt/thunder/scripts/common.sh \
    /thunder/scripts/common.sh; do
    if [ -f "$candidate" ]; then
        source "$candidate"
        break
    fi
done

if ! command -v thunder_api_call >/dev/null 2>&1; then
    # Fallback: minimal inline implementation against localhost admin port.
    thunder_api_call() {
        local method="$1" path="$2" body="${3:-}"
        if [ -n "$body" ]; then
            curl -sS -X "$method" -H 'Content-Type: application/json' \
                -d "$body" -w '%{http_code}' "http://localhost:8090${path}"
        else
            curl -sS -X "$method" -w '%{http_code}' "http://localhost:8090${path}"
        fi
    }
fi

# Fetch default OU ID.
RESP=$(thunder_api_call GET "/organization-units/tree/default")
HTTP_CODE="${RESP: -3}"; BODY="${RESP%???}"
if [ "$HTTP_CODE" != "200" ]; then
    echo "ERROR: Failed to fetch default OU (HTTP $HTTP_CODE): $BODY" >&2
    exit 1
fi
OU_ID=$(echo "$BODY" | grep -o '"handle":"default"[^}]*"id":"[^"]*"\|"id":"[^"]*"[^}]*"handle":"default"' \
    | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$OU_ID" ]; then
    echo "ERROR: Could not extract default OU ID from response: $BODY" >&2
    exit 1
fi

# Idempotent check — list apps, see if our clientId is already registered.
LIST=$(thunder_api_call GET "/applications")
LIST_CODE="${LIST: -3}"; LIST_BODY="${LIST%???}"
if [ "$LIST_CODE" != "200" ]; then
    echo "ERROR: Failed to list applications (HTTP $LIST_CODE)" >&2
    exit 1
fi

if echo "$LIST_BODY" | grep -q "\"clientId\":\"${CLIENT_ID}\""; then
    echo "POC client '${CLIENT_ID}' already exists, leaving as-is."
    exit 0
fi

PAYLOAD=$(cat <<JSON
{
  "name": "POC API Platform Client",
  "description": "POC: hello-world OAuth client for protected-API verification.",
  "ouId": "${OU_ID}",
  "inboundAuthConfig": [{
    "type": "oauth2",
    "config": {
      "clientId": "${CLIENT_ID}",
      "clientSecret": "${CLIENT_SECRET}",
      "grantTypes": ["client_credentials"],
      "tokenEndpointAuthMethod": "client_secret_post",
      "pkceRequired": false,
      "publicClient": false,
      "token": {"accessToken": {"validityPeriod": 3600}}
    }
  }]
}
JSON
)

CREATE=$(thunder_api_call POST "/applications" "$PAYLOAD")
CREATE_CODE="${CREATE: -3}"; CREATE_BODY="${CREATE%???}"
if [ "$CREATE_CODE" != "201" ] && [ "$CREATE_CODE" != "200" ]; then
    echo "ERROR: Failed to create application (HTTP $CREATE_CODE): $CREATE_BODY" >&2
    exit 1
fi

echo "Created POC client '${CLIENT_ID}'"
POD_SCRIPT

# Persist credentials for verify-api-platform.sh.
cat > "${OUT_FILE}" <<EOF
# Generated by setup-thunder-client.sh — re-run is idempotent.
POC_CLIENT_ID=${CLIENT_ID}
POC_CLIENT_SECRET=${CLIENT_SECRET}
EOF
chmod 600 "${OUT_FILE}"

echo ""
echo "✅ POC client ready"
echo "   client_id:     ${CLIENT_ID}"
echo "   client_secret: ${CLIENT_SECRET}"
echo "   creds file:    ${OUT_FILE}"
