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

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "  AEP Platform — Full Setup"
echo "============================================"
echo ""
echo "This script sets up everything needed to run AEP:"
echo "  1. k3d cluster"
echo "  2. Prerequisites (cert-manager, Kgateway, ESO, OpenBao)"
echo "  3. OpenChoreo (Control Plane, Data Plane, Workflow Plane, Thunder)"
echo "  4. Observability Plane (Observer + OpenSearch + Fluent Bit +"
echo "     logs-adapter + AI RCA agent — in-UI Live Progress streaming,"
echo "     plus the alert → AI-RCA → coding-agent handoff pipeline:"
echo "     docs/developer-guide/sre-handoff-runbook.md)"
echo "     SKIP_OBSERVABILITY=1 skips this stage (heaviest install: OpenSearch"
echo "     StatefulSet + Fluent Bit DaemonSet + RCA agent) — Live Progress"
echo "     streaming and the alert→RCA pipeline are then unavailable until"
echo "     scripts/setup-observability.sh is run manually."
echo "  5. Temporal workflow engine (drives the devflow workflows; aep-api"
echo "     runs the worker in-process)"
echo "  6. AEP-specific config (ClusterWorkflows, ComponentTypes,"
echo "     Environment, AuthzRoleBindings, .env file)"
echo ""

bash "$SCRIPT_DIR/setup-k3d.sh"
echo ""

bash "$SCRIPT_DIR/setup-prerequisites.sh"
echo ""

bash "$SCRIPT_DIR/setup-openchoreo.sh"
echo ""

if [ "${SKIP_OBSERVABILITY:-0}" = "1" ]; then
    echo "⏭️  SKIP_OBSERVABILITY=1 — skipping Observability Plane (run scripts/setup-observability.sh manually when needed)"
else
    bash "$SCRIPT_DIR/setup-observability.sh"
fi
echo ""

bash "$SCRIPT_DIR/setup-temporal.sh"
echo ""

bash "$SCRIPT_DIR/setup-aep.sh"
echo ""

echo "============================================"
echo "  ✅ Setup Complete!"
echo "============================================"
echo ""
echo "  Start AEP:  cd deployments && bash scripts/start.sh"
echo "  Stop AEP:   cd deployments && bash scripts/stop.sh"
echo "  Console:      http://localhost:8090"
echo "  Login:        admin / admin"
echo ""
echo "  Coding-agent: dispatched as a one-shot pod via the"
echo "                'aep-coding-agent' ClusterWorkflow"
echo "                in the workflow plane (no long-lived runner)."
echo ""
