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

# Intelligent "run-after-pull" driver. Diffs the checkout against the last
# successful run (deployments/.aep-last-run marker) and runs ONLY the setup
# steps whose inputs changed, then hands off to start.sh. It never modifies the
# other scripts — it only invokes them. See docs/developer-guide/run-after-pull.md
# for the manual equivalent and the change → step mapping.
#
# Usage (from the repo root):
#   bash deployments/scripts/update.sh            # detect → plan → confirm → run
#   bash deployments/scripts/update.sh --dry-run  # print the plan only (no side effects)
#   bash deployments/scripts/update.sh --yes      # run without the confirm prompt
#   bash deployments/scripts/update.sh --full     # run every step regardless of the diff
#   bash deployments/scripts/update.sh --from <sha>   # diff against <sha> instead of the marker
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEPLOY_DIR="$SCRIPT_DIR/.."

# shellcheck source=env.sh
source "$SCRIPT_DIR/env.sh"
# shellcheck source=utils.sh
source "$SCRIPT_DIR/utils.sh"

MARKER="$DEPLOY_DIR/.aep-last-run"

# ── Flags ────────────────────────────────────────────────────────────────────
ASSUME_YES=0
DRY_RUN=0
FULL=0
FROM_OVERRIDE=""

usage() {
    sed -n '18,29p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

while [ $# -gt 0 ]; do
    case "$1" in
        -y|--yes)      ASSUME_YES=1 ;;
        -n|--dry-run)  DRY_RUN=1 ;;
        -f|--full)     FULL=1 ;;
        --from)        FROM_OVERRIDE="$2"; shift ;;
        -h|--help)     usage 0 ;;
        *)             echo "❌ Unknown argument: $1"; echo; usage 1 ;;
    esac
    shift
done

echo "=== AEP update — run only what the pull changed ==="

# ── Change detection (pure git; no side effects) ─────────────────────────────
NEW="$(git -C "$ROOT_DIR" rev-parse HEAD)"

# The set of paths (repo-root-relative) to base the decision on:
#   committed range  marker..HEAD   +   uncommitted tracked changes vs HEAD
#   +  untracked files.  So both a pull AND local edits are accounted for.
CHANGED=""
MODE="incremental"

resolve_sha() { git -C "$ROOT_DIR" rev-parse --verify --quiet "$1^{commit}" >/dev/null 2>&1; }

if [ "$FULL" = "1" ]; then
    MODE="full (--full)"
elif [ -n "$FROM_OVERRIDE" ]; then
    if resolve_sha "$FROM_OVERRIDE"; then
        OLD="$FROM_OVERRIDE"
    else
        echo "❌ --from '$FROM_OVERRIDE' is not a resolvable commit."; exit 1
    fi
elif [ -f "$MARKER" ]; then
    OLD="$(cat "$MARKER")"
    if ! resolve_sha "$OLD"; then
        echo "⚠️  Marker sha ($OLD) not found in history — falling back to a full run."
        MODE="full (unresolvable marker)"
    fi
else
    echo "ℹ️  No marker ($MARKER) — first intelligent run; planning a full run."
    MODE="full (no marker)"
fi

if [[ "$MODE" == full* ]]; then
    # Full run: force every gated step on. start.sh always runs regardless.
    NEED_INSTALL=1; NEED_GEN=1; NEED_VRUN=1; NEED_AEP=1
    T_INSTALL="(full run)"; T_GEN="(full run)"; T_VRUN="(full run)"; T_AEP="(full run)"
else
    # Assemble the changed-path set. grep/diff exit non-zero on "no match"; keep
    # set -e happy with `|| true`.
    committed=""
    if [ "$OLD" != "$NEW" ]; then
        committed="$(git -C "$ROOT_DIR" diff --name-only "$OLD" "$NEW" 2>/dev/null || true)"
    fi
    working="$(git -C "$ROOT_DIR" diff --name-only HEAD 2>/dev/null || true)"
    untracked="$(git -C "$ROOT_DIR" ls-files --others --exclude-standard 2>/dev/null || true)"
    CHANGED="$(printf '%s\n%s\n%s\n' "$committed" "$working" "$untracked" | grep -v '^$' | sort -u || true)"

    # first_match REGEX → prints the first changed path matching REGEX (or empty).
    first_match() { grep -E -m1 "$1" <<<"$CHANGED" || true; }

    RE_INSTALL='^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|go\.work|go\.work\.sum)$|^(apps|packages|services|runners)/[^/]+/package\.json$|^packages/ui/[^/]+/package\.json$|^(services/aep-api|tools/aepctl|deployments/single-cluster/resource-types/thunder-app/operator)/go\.(mod|sum)$'
    RE_GEN='^packages/contracts/api/v1/openapi\.yaml$|^packages/contracts/schemas/.*\.schema\.json$|^skills/'
    RE_AEP='^deployments/scripts/(setup-aep|env|utils|build-validation-runner)\.sh$|^deployments/manifests/|^deployments/single-cluster/resource-types/'

    T_INSTALL="$(first_match "$RE_INSTALL")"; [ -n "$T_INSTALL" ] && NEED_INSTALL=1 || NEED_INSTALL=0
    T_GEN="$(first_match "$RE_GEN")";         [ -n "$T_GEN" ]     && NEED_GEN=1     || NEED_GEN=0
    T_AEP="$(first_match "$RE_AEP")";         [ -n "$T_AEP" ]     && NEED_AEP=1     || NEED_AEP=0

    # Validation runner: ANY runners/remote-worker/ change, plugin/ included.
    #
    # plugin/ was excluded here on the premise that it is a live hostPath
    # overlay needing no rebuild. That holds only for the coding-agent
    # ClusterWorkflow, which bind-mounts the host plugin dir into the runner pod
    # (manifests/aep-coding-agent.dev-patch.yaml → /aep-dev/plugin). Validation
    # dispatches exclusively through the cluster-gateway-proxy path, whose Job
    # mounts nothing but emptyDirs, so it runs the plugin BAKED into
    # aep-validation-runner:dev — skipping the rebuild leaves validation running
    # stale skills with no signal that anything is wrong.
    #
    # Rebuilding is cheap: the plugin sits in the image's final COPY layer, so a
    # skills-only change re-does that layer and the import, not the chromium
    # download.
    T_VRUN="$(grep -E '^runners/remote-worker/' <<<"$CHANGED" | head -1 || true)"
    [ -n "$T_VRUN" ] && NEED_VRUN=1 || NEED_VRUN=0
fi

# start.sh always runs — its `docker compose up --build` rebuilds every service
# image from source, and it also refreshes DNS, kubeconfig, OpenBao, secrets.
NEED_START=1

# ── Print the plan ───────────────────────────────────────────────────────────
echo ""
if [[ "$MODE" == full* ]]; then
    echo "Plan ($MODE):"
else
    echo "Plan — changes since ${OLD:0:12} → ${NEW:0:12}:"
fi
plan_row() { printf "  %-38s ← %s\n" "$1" "$2"; }
[ "$NEED_INSTALL" = "1" ] && plan_row "make install" "${T_INSTALL:-?}"
[ "$NEED_GEN"     = "1" ] && plan_row "make gen" "${T_GEN:-?}"
[ "$NEED_VRUN"    = "1" ] && plan_row "make build-validation-runner FORCE=1" "${T_VRUN:-?}"
[ "$NEED_AEP"     = "1" ] && plan_row "deployments/scripts/setup-aep.sh" "${T_AEP:-?}"
[ "$NEED_START"   = "1" ] && plan_row "deployments/scripts/start.sh" "always"

if [ "$NEED_AEP" = "1" ] && [[ "$MODE" != full* ]]; then
    echo ""
    echo "  ⚠️  setup-aep.sh re-applies cluster config and SIGHUP-restarts k3s (brief disruption)."
fi

if [ "$DRY_RUN" = "1" ]; then
    echo ""
    echo "🅳 dry-run — no steps executed, marker unchanged."
    exit 0
fi

# ── Confirm ──────────────────────────────────────────────────────────────────
if [ "$ASSUME_YES" != "1" ]; then
    echo ""
    read -r -p "Proceed? [y/N] " reply || reply=""
    case "$reply" in
        y|Y) ;;
        *) echo "Aborted."; exit 0 ;;
    esac
fi

# ── Preflight (side effects allowed past this point) ─────────────────────────
echo ""
echo "🔍 Preflight..."
if ! docker info &>/dev/null; then
    echo "❌ Docker is not running. Start Docker / Colima first."; exit 1
fi
if ! command -v k3d &>/dev/null; then
    echo "❌ k3d not installed."; exit 1
fi

# Cluster must exist. If it exists but is stopped (e.g. after a reboot), start it.
CLUSTER_STATE="$(k3d cluster list "$CLUSTER_NAME" --no-headers 2>/dev/null | awk '{print $2}')"
if [ -z "$CLUSTER_STATE" ]; then
    echo "❌ k3d cluster '$CLUSTER_NAME' does not exist."
    echo "   This is a first-time bring-up — run: bash deployments/scripts/setup.sh"
    exit 1
fi
SERVERS_RUNNING="${CLUSTER_STATE%%/*}"   # "1/1" → 1, "0/1" → 0
if [ "${SERVERS_RUNNING:-0}" -lt 1 ]; then
    echo "⏻ k3d cluster '$CLUSTER_NAME' is stopped → starting..."
    k3d cluster start "$CLUSTER_NAME"
    wait_for_cluster || { echo "❌ Cluster failed to become ready."; exit 1; }
else
    echo "✅ k3d cluster '$CLUSTER_NAME' is running"
fi

# ── Execute the selected steps in order ──────────────────────────────────────
if [ "$NEED_INSTALL" = "1" ]; then
    echo ""; echo "📦 make install"
    make -C "$ROOT_DIR" install
fi
if [ "$NEED_GEN" = "1" ]; then
    echo ""; echo "🧬 make gen"
    make -C "$ROOT_DIR" gen
fi
if [ "$NEED_VRUN" = "1" ]; then
    echo ""; echo "🐳 make build-validation-runner FORCE=1"
    make -C "$ROOT_DIR" build-validation-runner FORCE=1
fi
if [ "$NEED_AEP" = "1" ]; then
    echo ""; echo "⚙️  setup-aep.sh"
    bash "$SCRIPT_DIR/setup-aep.sh"
fi

echo ""; echo "🚀 start.sh"
bash "$SCRIPT_DIR/start.sh"

# ── Record the marker (success only; `set -e` aborts before here on failure) ──
echo "$NEW" > "$MARKER"
echo ""
echo "✅ update complete — marker set to ${NEW:0:12}"
