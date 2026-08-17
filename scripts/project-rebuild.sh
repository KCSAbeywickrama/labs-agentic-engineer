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

# Rebuild AND deploy one component of a platform-created project from what is on
# its default branch.
#
# The loop it was written for: clone the repo the platform created for a project,
# change code by hand, push to the default branch, run this. The push alone does
# nothing — components are created AutoBuild=false, and while the platform
# subscribes to GitHub's `push` event no handler is registered for it, so the
# delivery is logged and dropped. This call is what makes a hand-edit real.
#
#   scripts/project-rebuild.sh my-project my-component
#   NO_LOGS=1 scripts/project-rebuild.sh my-project my-component   # trigger + verdict only
#
# Both arguments are required on purpose. A build costs a pod and a push to the
# registry, and a mistyped component silently rebuilds the wrong thing — so
# neither gets a default, unlike project-revalidate.sh's read-only trigger.
#
# THE BUILD IS NOT PINNED TO A COMMIT. Only the merged-PR fan-out pins a SHA;
# this clones the head of the repo's default branch at the moment the build pod
# runs. Push first, then run this.
#
# --- Why this script deploys, and what it deliberately does not deploy --------
#
# Components carry `autoDeploy: false` (ADR-0017): a green build posts a Workload
# and NOTHING promotes it. The platform's own deploy is a stage of the milestone
# run, so an off-run hand-edit has no deploy behind it — this script performs one.
#
# It performs the SAME TWO WRITES the run supervisor's deploy stage performs
# (projects.DeploymentService.deployOne): cut a ComponentRelease from the Workload
# the build just posted, then point the component's existing ReleaseBinding at it.
# The endpoint URL does not move — every name in the serving path (binding,
# RenderedRelease, dataplane namespace, Service, gateway hostname) is keyed on
# project/component/environment, never on the release.
#
# What it does NOT do, and this is the one way it differs from a real run: the
# deploy stage rewrites the WHOLE binding from the CURRENT design in one call —
# release pin, trait environment configs (jwtAuth) and workload overrides (env
# vars, env-config.js) together, via DesiredDeploymentFor. This writes only the
# pin, which is why the wiring already on the binding survives untouched. So a
# hand-edit to CODE deploys exactly as the platform would; a change to the DESIGN
# (api-security, env vars, a dependency's URL) does not reach the cluster through
# here. Run a real cycle for that.
#
# It also deploys ONE component, so it skips the wave ordering a run derives from
# the design's hard wiring edges (ADR-0019). In this loop the component's
# dependencies are already up, which is what makes that safe.
#
# Requires jq — the build log and the ReleaseBinding are JSON, which sed cannot
# walk honestly.
set -euo pipefail

usage() {
    echo "Usage: $(basename "$0") <project> <component>" >&2
    echo "  Builds <component> from the head of the project repo's default branch," >&2
    echo "  tails the build log, then cuts a release and re-pins the binding to it." >&2
}

PROJECT="${1:-}"
COMPONENT="${2:-}"
if [ -z "$PROJECT" ] || [ -z "$COMPONENT" ]; then
    usage
    exit 1
fi

BFF_URL="${BFF_URL:-http://localhost:9090}"
THUNDER_URL="${THUNDER_URL:-http://thunder.openchoreo.localhost:8080}"
SEEDER_CLIENT_ID="${SEEDER_CLIENT_ID:-aep-local-dev-seeder}"
SEEDER_CLIENT_SECRET="${SEEDER_CLIENT_SECRET:-aep-local-dev-seeder-secret}"

# The deploy talks to OpenChoreo directly, because the BFF exposes no deploy
# trigger — `POST /components/{c}/builds` has no sibling, and the only caller of
# DeploymentService is the run supervisor's activity.
#
# It uses the BFF's OWN service identity rather than the seeder client above:
# OpenChoreo authorises per resource, and the seeder token that reads components
# is 403 on releasebindings. These are deployments/docker-compose.yml's local-dev
# defaults for a plane on the loopback interface; both are overridable, and
# neither is a credential any real environment shares.
OC_API_URL="${OC_API_URL:-http://api.openchoreo.localhost:8080}"
OC_CLIENT_ID="${OC_CLIENT_ID:-aep-api-client}"
OC_CLIENT_SECRET="${OC_CLIENT_SECRET:-aep-api-client-secret}"

# The environment a project's components serve in — openchoreo.DevEnvironmentName.
ENVIRONMENT="${ENVIRONMENT:-development}"

# Two separate budgets because they bound different things: a cold image build
# is minutes, while a binding re-pin rolling out is seconds.
BUILD_TIMEOUT="${BUILD_TIMEOUT:-900}"
DEPLOY_TIMEOUT="${DEPLOY_TIMEOUT:-300}"
POLL_INTERVAL="${POLL_INTERVAL:-3}"
# How often the status wait reports that nothing has changed. It exists because
# a build can sit in one state for minutes and silence is indistinguishable from
# a hang — see the wait loop below.
HEARTBEAT="${HEARTBEAT:-30}"

# All four feed `$(( ))` below, where a non-numeric value would fail as an
# arithmetic syntax error naming nothing. Refuse it here, where the message can
# name the variable.
for var in BUILD_TIMEOUT DEPLOY_TIMEOUT POLL_INTERVAL HEARTBEAT; do
    if ! [[ "${!var}" =~ ^[1-9][0-9]*$ ]]; then
        echo "❌ ${var} must be a positive integer (got '${!var}')." >&2
        exit 1
    fi
done

if ! command -v jq > /dev/null 2>&1; then
    echo "❌ jq is required (the build log and the ReleaseBinding are JSON)." >&2
    echo "   macOS: brew install jq" >&2
    exit 1
fi

if ! curl -fsS --max-time 3 "$BFF_URL/healthz" > /dev/null 2>&1; then
    echo "❌ BFF not reachable at $BFF_URL"
    echo "   Bring the compose stack up first: cd deployments && bash scripts/start.sh"
    exit 1
fi

mint_token() {
    curl -sS -X POST "${THUNDER_URL%/}/oauth2/token" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "grant_type=client_credentials" \
        -d "client_id=$1" \
        -d "client_secret=$2" 2> /dev/null \
        | sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}

TOKEN=$(mint_token "$SEEDER_CLIENT_ID" "$SEEDER_CLIENT_SECRET")
if [ -z "$TOKEN" ]; then
    echo "❌ Thunder did not return an access_token for '${SEEDER_CLIENT_ID}'."
    echo "   The client is registered by deployments/scripts/setup-local.sh / start.sh."
    exit 1
fi

API="${BFF_URL}/api/v1/projects/${PROJECT}/components/${COMPONENT}"

# --- Everything the deploy needs is resolved BEFORE the build ----------------
#
# A build is minutes and a pushed image; discovering only afterwards that the
# deploy cannot run is the one failure this ordering exists to prevent.

OC_TOKEN=$(mint_token "$OC_CLIENT_ID" "$OC_CLIENT_SECRET")
if [ -z "$OC_TOKEN" ]; then
    echo "❌ Thunder did not return an access_token for '${OC_CLIENT_ID}' (the deploy identity)."
    echo "   Set OC_CLIENT_ID / OC_CLIENT_SECRET to this plane's aep-api client."
    exit 1
fi

# OpenChoreo's `namespace` path segment is the ORG. The BFF derives it from the
# token, so it is never on the wire; ask it which org this token is bound to.
# ORG= overrides for a plane carrying more than one.
ORG="${ORG:-}"
if [ -z "$ORG" ]; then
    ORG=$(curl -sS -H "Authorization: Bearer ${TOKEN}" "${BFF_URL}/api/v1/organizations" 2> /dev/null \
        | jq -r '.items[0].name // empty')
fi
if [ -z "$ORG" ]; then
    echo "❌ Could not resolve the org from ${BFF_URL}/api/v1/organizations."
    echo "   Pass it explicitly:  ORG=<org> $(basename "$0") ${PROJECT} ${COMPONENT}"
    exit 1
fi

# The two OpenChoreo names this script has to spell for itself. Both are rules
# Go owns — ocname.ScopedComponentName and openchoreo.ReleaseBindingName — and a
# bash script cannot import them, so this is a SECOND SPELLING that will drift if
# either rule changes. It is spelled once, here, so there is one place to fix.
SCOPED="${PROJECT}-${COMPONENT}"
BINDING="${SCOPED}-${ENVIRONMENT}"

# Body and status separately, so a refusal prints its reason instead of being
# swallowed by a non-2xx exit.
oc_call() {
    local method="$1" path="$2" body="${3:-}"
    if [ -n "$body" ]; then
        curl -sS -X "$method" "${OC_API_URL%/}${path}" \
            -H "Authorization: Bearer ${OC_TOKEN}" \
            -H "Content-Type: application/json" \
            -d "$body" -w '\n%{http_code}' 2>&1
    else
        curl -sS -X "$method" "${OC_API_URL%/}${path}" \
            -H "Authorization: Bearer ${OC_TOKEN}" -w '\n%{http_code}' 2>&1
    fi
}

BINDING_PATH="/api/v1/namespaces/${ORG}/releasebindings/${BINDING}"

# A component with no binding yet cannot be deployed from here, and must not be:
# writing a pin-only binding would create one carrying no traits, no env vars and
# no files, which is a half-written object OpenChoreo would render and serve.
# DeploymentService.Converge refuses the same case for the same reason.
PRE=$(oc_call GET "$BINDING_PATH")
PRE_CODE="${PRE##*$'\n'}"
if [ "$PRE_CODE" = "404" ]; then
    echo "❌ No ReleaseBinding ${BINDING} in org ${ORG} — this component has never been deployed."
    echo "   Only a milestone run writes the first binding (it carries the trait configs,"
    echo "   env vars and files this script deliberately does not compose). Run a cycle first."
    exit 1
fi
if [ "$PRE_CODE" != "200" ]; then
    echo "❌ Could not read ReleaseBinding ${BINDING} (HTTP ${PRE_CODE})."
    echo "   ${PRE%$'\n'*}"
    exit 1
fi

# A component provisioned before ADR-0017 still carries autoDeploy: true, and
# OpenChoreo's controller then promotes the build's Workload on its own — racing
# the pin below over one field. A WARNING and not a refusal: the race is usually
# won by whoever writes last and the wait loop names the loss explicitly, so the
# rebuild is still worth running. EnsureComponent re-asserts false the next time
# a real cycle touches this component.
if [ "$(oc_call GET "/api/v1/namespaces/${ORG}/components/${SCOPED}" | jq -r '.spec.autoDeploy // false' 2> /dev/null)" = "true" ]; then
    echo "⚠️  ${SCOPED} still carries autoDeploy: true — OpenChoreo will promote this build too,"
    echo "    so its release and this script's may race. To settle it before building:"
    echo "    kubectl patch components.openchoreo.dev -n ${ORG} ${SCOPED} --type=merge -p '{\"spec\":{\"autoDeploy\":false}}'"
    echo
fi

# --- Trigger -----------------------------------------------------------------

echo "🔨 Building ${PROJECT}/${COMPONENT} from the default branch head"

RESP=$(curl -sS -X POST "${API}/builds" \
    -H "Authorization: Bearer ${TOKEN}" \
    -w '\n%{http_code}' 2>&1)
CODE="${RESP##*$'\n'}"
JSON="${RESP%$'\n'*}"

if [ "$CODE" != "201" ]; then
    echo "❌ HTTP ${CODE}"
    echo "   ${JSON}"
    # The refusal a hand-edit earns most often, and the one whose message does
    # not explain itself: a component the platform has never built has no
    # OpenChoreo Component CR, and only the merged-PR fan-out creates one.
    case "$JSON" in
        *"not found"* | *"Not Found"*)
            echo "   If this component has never been built, it has no OpenChoreo Component CR yet —"
            echo "   only a merged pull request's fan-out provisions one."
            ;;
    esac
    exit 1
fi

RUN=$(printf '%s' "$JSON" | jq -r '.name // empty')
if [ -z "$RUN" ]; then
    echo "❌ Build accepted but no run name came back: ${JSON}"
    exit 1
fi
echo "✅ Started build ${RUN}"
echo

# --- Tail the build log ------------------------------------------------------
#
# `complete` is the endpoint's own "this build is terminal AND this response
# carries everything there will ever be", so it — not a status poll — is what
# ends the tail. Observability is optional in a local plane: a 503 means the log
# service is not wired, which is no reason to stop watching the build.
CURSOR=0
if [ "${NO_LOGS:-0}" = "1" ]; then
    echo "⏭  Skipping the log tail (NO_LOGS=1)."
else
    LOG_DEADLINE=$((SECONDS + BUILD_TIMEOUT))
    while true; do
        if [ "$SECONDS" -ge "$LOG_DEADLINE" ]; then
            echo "⏱  Build log still open after ${BUILD_TIMEOUT}s — giving up on the tail."
            break
        fi
        PAGE=$(curl -sS -H "Authorization: Bearer ${TOKEN}" \
            "${API}/builds/${RUN}/logs?since=${CURSOR}" -w '\n%{http_code}' 2>&1)
        PCODE="${PAGE##*$'\n'}"
        PJSON="${PAGE%$'\n'*}"
        if [ "$PCODE" != "200" ]; then
            echo "⚠️  Build logs unavailable (HTTP ${PCODE}) — falling back to the status poll."
            break
        fi
        printf '%s' "$PJSON" | jq -r '.logs[]? | .log' || true
        # An empty page carries no cursor; the previous one then stands.
        NEXT=$(printf '%s' "$PJSON" | jq -r '.nextCursor // 0')
        if [ -n "$NEXT" ] && [ "$NEXT" != "0" ] && [ "$NEXT" != "null" ]; then
            CURSOR="$NEXT"
        fi
        if [ "$(printf '%s' "$PJSON" | jq -r '.complete')" = "true" ]; then
            break
        fi
        sleep "$POLL_INTERVAL"
    done
fi

# --- The build verdict -------------------------------------------------------
#
# The log ending is not the verdict; the run's terminal condition Reason is. It
# is read off the builds listing, which the BFF caps at 20 runs with no ordering
# guarantee — so a run that is not in the page yet counts as still pending rather
# than as a failure.
build_row() {
    curl -sS -H "Authorization: Bearer ${TOKEN}" "${API}/builds" 2> /dev/null \
        | jq -r --arg run "$RUN" '.items[]? | select(.name == $run) | "\(.status)\t\(.completed)"' \
        || true
}

mmss() { printf '%02d:%02d' $(($1 / 60)) $(($1 % 60)); }

# This wait can run for minutes with nothing to print, and when the log tail is
# unavailable it is the ONLY thing on screen — so it reports every status change
# and heartbeats in between, which is what makes a stall look like a stall.
STATUS=""
COMPLETED="false"
LAST_STATUS=""
HINTED=0
WAIT_FROM=$SECONDS
LAST_BEAT=$SECONDS
STATUS_DEADLINE=$((SECONDS + BUILD_TIMEOUT))
echo "⏳ Waiting for ${RUN} to finish…"
while [ "$SECONDS" -lt "$STATUS_DEADLINE" ]; do
    ROW="$(build_row)"
    if [ -n "$ROW" ]; then
        STATUS="${ROW%%$'\t'*}"
        COMPLETED="${ROW##*$'\t'}"
        ELAPSED=$((SECONDS - WAIT_FROM))
        if [ "$STATUS" != "$LAST_STATUS" ]; then
            echo "   [$(mmss "$ELAPSED")] ${STATUS}"
            LAST_STATUS="$STATUS"
            LAST_BEAT=$SECONDS
        elif [ $((SECONDS - LAST_BEAT)) -ge "$HEARTBEAT" ]; then
            echo "   [$(mmss "$ELAPSED")] still ${STATUS}…"
            LAST_BEAT=$SECONDS
        fi
        # A build that has not left Pending is not slow, it is blocked — most
        # often a step image that will not pull. Say where to look, once.
        if [ "$HINTED" = "0" ] && [ "$STATUS" = "WorkflowPending" ] && [ "$ELAPSED" -ge 120 ]; then
            echo "   ↳ pending for 2m — the step pods say why:"
            echo "     kubectl get pods -A | grep ${RUN}"
            HINTED=1
        fi
        if [ "$COMPLETED" = "true" ]; then
            break
        fi
    fi
    sleep "$POLL_INTERVAL"
done

echo
if [ "$COMPLETED" != "true" ]; then
    echo "⏱  Build ${RUN} reported no terminal state within ${BUILD_TIMEOUT}s (last status: ${STATUS:-unknown})."
    echo "   Re-check:  curl -sS -H \"Authorization: Bearer \$TOKEN\" ${API}/builds"
    exit 1
fi

if [ "$STATUS" != "WorkflowSucceeded" ]; then
    echo "❌ Build ${RUN} finished ${STATUS}. Nothing was deployed."
    exit 1
fi
echo "✅ Build ${RUN} succeeded."

# --- Cut the release ---------------------------------------------------------
#
# The release is named off THIS BUILD, not off a commit, and that is the whole
# reason the loop works. `generate-release` treats a name that already exists as
# success, so a release name that did not change per build would silently keep
# the previous image serving — and a rebuild with no new push (a Dockerfile fix,
# a retry) is exactly that case. The build run name ends in the unix-milli suffix
# openchoreo.NewBuildRunName appends, so it is unique per build and stable across
# a re-run of this script for the same build.
#
# The 18/18 caps mirror projects.ReleaseNameFor's widths, which keep the whole
# name inside the k8s label budget a release name is bound by.
cap18() { printf '%s' "$1" | cut -c1-18 | sed 's/-*$//'; }

SUFFIX="${RUN##*-}"
if ! [[ "$SUFFIX" =~ ^[0-9]+$ ]]; then
    # The run name was not shaped as expected. Fall back to its own tail rather
    # than to a fixed string, which would collide across builds.
    SUFFIX="$(printf '%s' "$RUN" | tr -cd 'a-z0-9' | tail -c 13)"
fi
RELEASE="$(cap18 "$PROJECT")-$(cap18 "$COMPONENT")-${SUFFIX}"

echo
echo "🚀 Cutting release ${RELEASE} from the Workload the build posted"
CUT=$(oc_call POST "/api/v1/namespaces/${ORG}/components/${SCOPED}/generate-release" \
    "{\"releaseName\":\"${RELEASE}\"}")
CUT_CODE="${CUT##*$'\n'}"
case "$CUT_CODE" in
    200 | 201) ;;
    # Already there — this script ran for this build before. The release was cut
    # from the same build's Workload, so it is the one we want.
    409) echo "   (release already existed — re-running for the same build)" ;;
    *)
        echo "❌ Could not cut the release (HTTP ${CUT_CODE})."
        echo "   ${CUT%$'\n'*}"
        exit 1
        ;;
esac

# --- Re-pin the binding ------------------------------------------------------
#
# Read-modify-write of spec.releaseName ALONE. Everything else on the binding —
# trait environment configs, workload overrides, the fields OpenChoreo's own
# controllers own — is carried through untouched, which is what makes a pin-only
# write safe here where a blind PUT would not be.
#
# Retried on 5xx because OpenChoreo's controllers rewrite these bindings
# continuously and report a lost write race as a generic 500 (the same reason the
# Go client wraps this call in retryStaleWrite).
echo "📌 Pinning ${BINDING} to ${RELEASE}"
PINNED=0
OBSERVED_BEFORE=0
REPINNED=1
for attempt in 1 2 3; do
    # Re-derived per attempt, not carried over: a retry re-reads, and the answer
    # this decides ("will a reconcile follow our write?") is a property of the
    # state we just read, not of the state the failed attempt read.
    REPINNED=1
    CUR=$(oc_call GET "$BINDING_PATH")
    CUR_CODE="${CUR##*$'\n'}"
    CUR_JSON="${CUR%$'\n'*}"
    if [ "$CUR_CODE" != "200" ]; then
        echo "❌ Could not read ${BINDING} (HTTP ${CUR_CODE})."
        echo "   ${CUR_JSON}"
        exit 1
    fi
    # Read from the SAME response the write is built on, so what the wait below
    # treats as "before" is the state this write actually replaced.
    OBSERVED_BEFORE=$(printf '%s' "$CUR_JSON" | jq -r '
        (.status.conditions // [] | map(select(.type == "Ready")) | first)
        | .observedGeneration // 0')
    if [ "$(printf '%s' "$CUR_JSON" | jq -r '.spec.releaseName // ""')" = "$RELEASE" ]; then
        # Already pinned here — a re-run for the same build. The write changes
        # nothing, so no reconcile follows and the wait must not expect one.
        REPINNED=0
    fi
    BODY=$(printf '%s' "$CUR_JSON" | jq -c --arg r "$RELEASE" '.spec.releaseName = $r')
    PUT=$(oc_call PUT "$BINDING_PATH" "$BODY")
    PUT_CODE="${PUT##*$'\n'}"
    PUT_JSON="${PUT%$'\n'*}"
    if [ "$PUT_CODE" = "200" ] || [ "$PUT_CODE" = "201" ]; then
        PINNED=1
        break
    fi
    if [ "$PUT_CODE" -ge 500 ] 2> /dev/null; then
        echo "   ↻ stale write (HTTP ${PUT_CODE}), re-reading… (attempt ${attempt}/3)"
        sleep "$POLL_INTERVAL"
        continue
    fi
    echo "❌ Could not pin ${BINDING} (HTTP ${PUT_CODE})."
    echo "   ${PUT_JSON}"
    exit 1
done

if [ "$PINNED" != "1" ]; then
    echo "❌ Could not pin ${BINDING} after 3 attempts — OpenChoreo kept rewriting it."
    exit 1
fi

# --- Wait for it to come up --------------------------------------------------
#
# The binding's Ready condition is the verdict, and observedGeneration is what
# makes it honest: a binding that was already serving reports Ready=True from the
# PREVIOUS generation the instant after the pin lands, so reading the condition
# alone would declare a deploy that has not started yet a success. The condition
# carries the generation the controller stamped it at, and `metadata.generation`
# is NOT on the wire (openchoreo-api strips it), so the gate is that the stamp
# has ADVANCED past what the pin replaced — not that it matches a known number.
#
# spec.releaseName is re-read every poll for a different reason: this script is
# not guaranteed to be the only writer of the pin. A component still carrying
# `autoDeploy: true` from before ADR-0017 has OpenChoreo's controller promoting
# releases too, and silently waiting for OUR release to come up while the
# controller serves ITS one is the failure worth naming out loud.
#
# Ready=False is the binding's INITIAL state while it renders and rolls out, so
# only the short list of reasons that waiting cannot fix is treated as failure —
# the same allow-list as projects.terminalDeployReason. Everything else is
# pending, bounded by DEPLOY_TIMEOUT.
echo
echo "⏳ Waiting for ${BINDING} to come up on ${RELEASE}…"
READY="false"
LAST_REASON=""
LAST_BEAT=$SECONDS
WAIT_FROM=$SECONDS
DEPLOY_DEADLINE=$((SECONDS + DEPLOY_TIMEOUT))
while [ "$SECONDS" -lt "$DEPLOY_DEADLINE" ]; do
    NOW=$(oc_call GET "$BINDING_PATH")
    NOW_CODE="${NOW##*$'\n'}"
    if [ "$NOW_CODE" = "200" ]; then
        # `|` and not a tab: read collapses runs of whitespace separators, which
        # would shift the fields whenever a reason is empty.
        IFS='|' read -r R_RELEASE R_STATUS R_REASON R_OBSERVED <<< "$(
            printf '%s' "${NOW%$'\n'*}" | jq -r '
                (.status.conditions // [] | map(select(.type == "Ready")) | first) as $c
                | [.spec.releaseName // "", $c.status // "", $c.reason // "",
                   ($c.observedGeneration // 0 | tostring)] | join("|")')"
        ELAPSED=$((SECONDS - WAIT_FROM))

        if [ "$R_RELEASE" != "$RELEASE" ]; then
            echo
            echo "❌ ${BINDING} is pinned to ${R_RELEASE:-nothing}, not ${RELEASE} — something re-pinned it."
            echo "   Most likely the component still carries autoDeploy: true, so OpenChoreo promotes"
            echo "   releases of its own. Check:"
            echo "   kubectl get components.openchoreo.dev -n ${ORG} ${SCOPED} -o jsonpath='{.spec.autoDeploy}'"
            exit 1
        fi
        if [ "$REPINNED" = "1" ] && [ "${R_OBSERVED:-0}" -le "${OBSERVED_BEFORE:-0}" ] 2> /dev/null; then
            R_REASON="not observed yet"
        elif [ "$R_STATUS" = "True" ]; then
            READY="true"
            break
        else
            case "$(printf '%s' "$R_REASON" | tr '[:upper:]' '[:lower:]')" in
                renderingfailed | renderfailed | invalidrelease | releasenotfound)
                    echo "   [$(mmss "$ELAPSED")] ${R_REASON}"
                    echo
                    echo "❌ ${BINDING} will not come up: ${R_REASON}."
                    echo "   kubectl describe releasebinding -n ${ORG} ${BINDING}"
                    exit 1
                    ;;
            esac
        fi

        if [ "$R_REASON" != "$LAST_REASON" ]; then
            echo "   [$(mmss "$ELAPSED")] ${R_REASON:-pending}"
            LAST_REASON="$R_REASON"
            LAST_BEAT=$SECONDS
        elif [ $((SECONDS - LAST_BEAT)) -ge "$HEARTBEAT" ]; then
            echo "   [$(mmss "$ELAPSED")] still ${R_REASON:-pending}…"
            LAST_BEAT=$SECONDS
        fi
    fi
    sleep "$POLL_INTERVAL"
done

echo
if [ "$READY" = "true" ]; then
    echo "✅ ${COMPONENT} is serving ${RELEASE}."
else
    echo "⏱  ${BINDING} did not report Ready within ${DEPLOY_TIMEOUT}s (last: ${LAST_REASON:-unknown})."
    echo "   The rollout may still land. Watch it:"
    echo "   kubectl describe releasebinding -n ${ORG} ${BINDING}"
fi

echo
echo "   Deployments:"
curl -sS -H "Authorization: Bearer ${TOKEN}" "${API}/deployments" 2> /dev/null | jq -r '
    if ((.items // []) | length) == 0 then
        "     (no ReleaseBinding for this component yet)"
    else
        .items[]
        | "     \(.environment // "?"): \(.status // "?")  [\(.releaseName // "?")]"
          + (if (.endpointUrl // "") != "" then "\n       → " + .endpointUrl else "" end)
    end'

if [ "$READY" != "true" ]; then
    exit 1
fi
