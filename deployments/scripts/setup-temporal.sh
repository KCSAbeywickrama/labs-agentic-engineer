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

# scripts/setup-temporal.sh — installs the Temporal workflow engine that
# drives the AEP devflow workflows (services/aep-api/internal/feature/devflow).
# aep-api runs the Temporal WORKER in-process; this deploys the SERVER + Web UI
# into the k3d cluster, reached from docker-compose via the start.sh port
# bridge (host.docker.internal:7233).
#
# Lean labs profile: single-replica server, Cassandra/Elasticsearch/Prometheus
# /Grafana disabled, PostgreSQL persistence (the chart's bundled postgres). Not
# a production topology — a demo-scale durable-execution backend.
#
# Idempotent: helm install is gated by helm_install_if_not_exists; the
# namespace-register step retries until the frontend answers.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
source "$SCRIPT_DIR/env.sh"
source "$SCRIPT_DIR/utils.sh"

# Pin the chart version so a server upgrade is a deliberate bump, not a
# silent drift on the next setup run.
TEMPORAL_CHART_VERSION="0.62.0"
NS="temporal"
VALUES_FILE="$SCRIPT_DIR/../helm-charts/values/temporal-values.yaml"

echo "============================================"
echo "  AEP — Temporal workflow engine"
echo "============================================"

kubectl cluster-info --context "$CLUSTER_CONTEXT" &>/dev/null || {
    echo "❌ Cluster '$CLUSTER_CONTEXT' not running. Run ./setup.sh first."
    exit 1
}

helm repo add temporal https://go.temporal.io/helm-charts >/dev/null 2>&1 || true
helm repo update temporal >/dev/null 2>&1 || true

helm_install_if_not_exists temporal "$NS" temporal/temporal \
    --version "$TEMPORAL_CHART_VERSION" \
    --values "$VALUES_FILE" \
    --timeout 15m

echo "⏳ Waiting for the Temporal frontend to become ready..."
kubectl --context "$CLUSTER_CONTEXT" -n "$NS" rollout status deployment/temporal-frontend --timeout=600s || true

# The chart does not auto-create the 'default' namespace the worker connects
# to. Register it via the admintools pod (tctl), retrying while the frontend
# settles.
echo "🧬 Registering the 'default' Temporal namespace..."
ADMIN_POD="$(kubectl --context "$CLUSTER_CONTEXT" -n "$NS" get pod -l app.kubernetes.io/component=admintools -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
if [ -n "$ADMIN_POD" ]; then
    for i in $(seq 1 20); do
        if kubectl --context "$CLUSTER_CONTEXT" -n "$NS" exec "$ADMIN_POD" -- \
            tctl --namespace default namespace describe >/dev/null 2>&1; then
            echo "   'default' namespace already registered"
            break
        fi
        if kubectl --context "$CLUSTER_CONTEXT" -n "$NS" exec "$ADMIN_POD" -- \
            tctl --namespace default namespace register --retention 72h >/dev/null 2>&1; then
            echo "✅ 'default' namespace registered"
            break
        fi
        echo "   frontend not ready yet — retry $i/20"
        sleep 6
    done
else
    echo "⚠️  admintools pod not found — register the 'default' namespace manually with tctl."
fi

echo ""
echo "✅ Temporal installed."
echo "   Frontend (gRPC): temporal-frontend.$NS.svc:7233 (host bridge added by start.sh → localhost:7233)"
echo "   Web UI:          port-forwarded to http://localhost:8233 by start.sh"
echo ""
