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

# #98 transition: the legacy console moves to http://localhost:8091 while the
# new console (apps/console) takes :8090. Fresh clusters get both origins from
# values-thunder.yaml + setup-openchoreo.sh; THIS script retrofits an
# already-seeded cluster, idempotently:
#
#   1. adds http://localhost:8091 to aep-console-client's redirectUris
#      (Thunder admin API, via the same in-pod THUNDER_SKIP_SECURITY
#      lift/restore dance as setup-thunder-client.sh), and
#   2. re-applies the Thunder HTTPRoute CORS filter with the :8091 origin
#      (kgateway rejects the token-endpoint preflight otherwise — redirect
#      URIs alone are not enough).
#
# Delete this script together with the legacy console when the #98
# retirement checklist completes.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"
source "$SCRIPT_DIR/utils.sh"
load_public_urls

LEGACY_ORIGIN="${PUBLIC_LEGACY_CONSOLE_URL:-http://localhost:8091}"
CLIENT_ID="aep-console-client"

echo "=== Patching Thunder for the legacy console at ${LEGACY_ORIGIN} ==="

THUNDER_POD=$(kubectl --context "${CLUSTER_CONTEXT}" get pod -n thunder \
    -l app.kubernetes.io/name=thunder -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
if [ -z "${THUNDER_POD}" ]; then
    echo "❌ Thunder pod not found. Run setup-openchoreo.sh first." >&2
    exit 1
fi

# ── 1. redirect URIs ────────────────────────────────────────────────────────
# The admin API is Bearer-gated after bootstrap (THUNDER_SKIP_SECURITY=false);
# lift the gate for the duration and restore it on exit, exactly like
# setup-thunder-client.sh.
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
    echo "🔓 Temporarily setting THUNDER_SKIP_SECURITY=true"
    kubectl --context "${CLUSTER_CONTEXT}" set env deploy/thunder-deployment -n thunder \
        THUNDER_SKIP_SECURITY=true >/dev/null
    kubectl --context "${CLUSTER_CONTEXT}" rollout status deploy/thunder-deployment -n thunder --timeout=180s >/dev/null
    trap restore_thunder_security EXIT
    THUNDER_POD=$(kubectl --context "${CLUSTER_CONTEXT}" get pod -n thunder \
        -l app.kubernetes.io/name=thunder -o jsonpath='{.items[0].metadata.name}')
fi

thunder_get() {
    kubectl --context "${CLUSTER_CONTEXT}" exec -n thunder "${THUNDER_POD}" -- \
        curl -sS "http://localhost:8090$1"
}

APP_ID=$(thunder_get "/applications" \
    | jq -r --arg cid "$CLIENT_ID" '.applications[] | select(.clientId == $cid) | .id')
if [ -z "${APP_ID}" ] || [ "${APP_ID}" = "null" ]; then
    echo "❌ Application with clientId=${CLIENT_ID} not found in Thunder." >&2
    exit 1
fi
echo "Application: ${CLIENT_ID} (${APP_ID})"

APP_JSON=$(thunder_get "/applications/${APP_ID}")
if echo "$APP_JSON" | jq -e --arg uri "$LEGACY_ORIGIN" \
        '.inboundAuthConfig[0].config.redirectUris | index($uri)' >/dev/null; then
    echo "⏭️  ${LEGACY_ORIGIN} already in redirectUris"
else
    UPDATED=$(echo "$APP_JSON" | jq --arg uri "$LEGACY_ORIGIN" \
        '.inboundAuthConfig[0].config.redirectUris += [$uri]')
    HTTP_CODE=$(echo "$UPDATED" | kubectl --context "${CLUSTER_CONTEXT}" exec -i -n thunder "${THUNDER_POD}" -- \
        curl -sS -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Type: application/json' \
        -d @- "http://localhost:8090/applications/${APP_ID}")
    if [ "$HTTP_CODE" != "200" ]; then
        echo "❌ Failed to update redirectUris (HTTP $HTTP_CODE)" >&2
        exit 1
    fi
    echo "✅ ${LEGACY_ORIGIN} added to redirectUris"
fi

# ── 2. CORS origin ──────────────────────────────────────────────────────────
# Same filter value as setup-openchoreo.sh (keep in sync). kgateway rejects
# duplicate allowOrigins, hence replace-not-append semantics.
CORS_PATCH=$(cat <<EOF
[{"op":"replace","path":"/spec/rules/0/filters","value":[{"type":"CORS","cors":{"allowOrigins":["http://localhost:19080","http://*.openchoreoapis.localhost:19080","${PUBLIC_CONSOLE_URL}","${LEGACY_ORIGIN}","${PUBLIC_THUNDER_URL}"],"allowMethods":["GET","POST","PUT","PATCH","DELETE","OPTIONS"],"allowHeaders":["Content-Type","Authorization","Accept","Origin"],"allowCredentials":true,"maxAge":3600}}]}]
EOF
)
kubectl patch httproute -n thunder thunder-httproute \
    --type=json -p="$CORS_PATCH" --context "${CLUSTER_CONTEXT}" >/dev/null
if [ "$(kubectl get httproute -n thunder thunder-httproute \
        --context "${CLUSTER_CONTEXT}" \
        -o jsonpath='{.spec.rules[0].filters[0].type}' 2>/dev/null)" != "CORS" ]; then
    echo "❌ CORS filter verify failed on thunder-httproute" >&2
    exit 1
fi
echo "✅ Thunder HTTPRoute CORS filter includes ${LEGACY_ORIGIN}"

echo "=== Done ==="
