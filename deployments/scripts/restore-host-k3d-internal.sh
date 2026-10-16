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

# deployments/scripts/restore-host-k3d-internal.sh — give host.k3d.internal an
# address again, after a node restart has taken it away.
#
# Usage: bash deployments/scripts/restore-host-k3d-internal.sh [apply|check]
#        (default: apply; both are safe to repeat)
#
# ── Why this exists ─────────────────────────────────────────────────────────
#
# Two consumers resolve host.k3d.internal, through two resolvers.
#
# Pods, through CoreDNS. Every CoreDNS rewrite on this cluster answers with
# the name: OpenChoreo's own *.openchoreo.localhost key, the
# *.openchoreoapis.localhost key setup-env-for-aectl.sh adds beside it, and
# the *.amp / *.gateway / *.agentmanager / *.am-gateway keys
# setup-agent-manager.sh merges in. So does OpenChoreo's build chain, which
# pushes to the local registry as host.k3d.internal:10082 from a pod.
#
# The node, through its own /etc/hosts. The images that build chain produces
# name the registry as host.k3d.internal:10082 too, and the upstream k3d
# config mirrors that registry host to itself (its purpose there is to mark
# the registry as plain HTTP). So containerd resolves the name on every image
# pull, from the node container's /etc/hosts, never from CoreDNS.
#
# k3d defines the name when it CREATES the cluster, in both places: a line in
# each node's /etc/hosts and the `coredns` ConfigMap's NodeHosts key. Neither
# owner knows about k3d's line. Docker rebuilds a container's /etc/hosts on
# every start, and k3s-supervisor regenerates NodeHosts from node addresses
# every time the node container restarts. k3d puts them back only when it
# drives the start itself (`k3d cluster start`); a colima stop/start, a host
# sleep or a Docker restart brings the node back under Docker's
# `unless-stopped` policy, which k3d never sees. A cluster that has been
# through one keeps every rewrite and loses the one name they all point at.
#
# Nothing fails loudly when that happens. Pods get NXDOMAIN for hostnames that
# resolve perfectly from the host, and it surfaces several systems away: the
# OpenChoreo API cannot fetch Thunder's JWKS, so it rejects every token as
# INVALID_TOKEN, so callers see 401s with no mention of DNS.
# setup-environment-aigateway.sh reads an empty environment list out of a 500
# and reports the environment as unregistered. Running pods keep their cached
# images, so the node side waits for the first fresh pull, the next component
# the platform builds, and fails it with `ErrImagePull … lookup
# host.k3d.internal: no such host`, which the deploy stage takes for a broken
# image.
#
# ── What this does ──────────────────────────────────────────────────────────
#
# Pods: the name is written into `coredns-custom`, which no controller
# reconciles, so it survives the next restart as well. `template`, not
# `hosts`: the .:53 server block already loads `hosts /etc/coredns/NodeHosts`,
# and CoreDNS accepts one hosts instance per block.
#
# The node: the registry mirror in each node's /etc/rancher/k3s/registries.yaml
# is pointed at the k3d load balancer by its container name,
# k3d-<cluster>-serverlb. That name is Docker's own DNS, rebuilt on every
# start, and the load balancer already forwards 10082 to the node, so image
# pulls stop needing the injected name at all. k3s renders registries.yaml
# for containerd when it starts, so the new route takes over at the next node
# restart, the very event that used to take the name away. Until then
# containerd still resolves host.k3d.internal, so if a restart has already
# dropped it from /etc/hosts, the line is put back the way k3d wrote it, for
# this one node lifetime. setup-env-for-aectl.sh gives a NEW cluster the
# load-balancer mirror in its k3d config, so a cluster created from current
# main has nothing to migrate here.

set -euo pipefail

MODE="${1:-apply}"
case "$MODE" in
    apply|check) ;;
    *) echo "usage: $(basename "$0") [apply|check]" >&2; exit 2 ;;
esac

CLUSTER_NAME="${CLUSTER_NAME:-openchoreo}"
CLUSTER_CONTEXT="${CLUSTER_CONTEXT:-k3d-${CLUSTER_NAME}}"
CM_KEY="hostk3dinternal.override"
REGISTRY_HOST="host.k3d.internal:10082"
LB_ENDPOINT="http://k3d-${CLUSTER_NAME}-serverlb:10082"
NODE_REGISTRIES="/etc/rancher/k3s/registries.yaml"
# Where k3s renders registries.yaml for containerd at each start. Read, to tell
# which route pulls take right now; never written (k3s owns it).
CONTAINERD_HOSTS_TOML="/var/lib/rancher/k3s/agent/etc/containerd/certs.d/${REGISTRY_HOST}/hosts.toml"

kubectl() { command kubectl --context "$CLUSTER_CONTEXT" "$@"; }
fail() { echo "❌ $1" >&2; [ $# -gt 1 ] && echo "   $2" >&2; exit 1; }

# The address is the cluster network's gateway — where the Docker host answers
# from inside the cluster, and where k3d publishes the load balancer's ports.
# Read off the network rather than assumed: the subnet is Docker's to choose,
# and a node's own address changes when its container is recreated.
HOST_GW="$(docker network inspect "k3d-${CLUSTER_NAME}" \
    --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null || true)"
[ -n "$HOST_GW" ] \
    || fail "No gateway on the k3d-${CLUSTER_NAME} docker network." \
            "Is the cluster up? \`k3d cluster list\`, and CLUSTER_NAME=${CLUSTER_NAME}."

DESIRED='template IN A host.k3d.internal {
  match "^host\.k3d\.internal\.$"
  answer "{{ .Name }} 60 IN A '"${HOST_GW}"'"
  fallthrough
}'

current="$(kubectl -n kube-system get cm coredns-custom \
    -o jsonpath="{.data.${CM_KEY//./\\.}}" 2>/dev/null || true)"

# k3d labels every container with its cluster and role. The load balancer is
# not a node: it runs no containerd and pulls nothing. A stopped node can be
# neither inspected nor migrated, and is reported rather than skipped: it
# would come back on whatever mirror it has.
ALL_NODES="$(docker ps -a --filter "label=k3d.cluster=${CLUSTER_NAME}" \
    --format '{{.Names}} {{.Label "k3d.role"}} {{.State}}' \
    | awk '$2 == "server" || $2 == "agent"')"
NODES="$(awk '$3 == "running" { print $1 }' <<<"$ALL_NODES")"
STOPPED_NODES="$(awk '$3 != "running" { print $1 }' <<<"$ALL_NODES")"
[ -n "$NODES" ] \
    || fail "No running node container for cluster ${CLUSTER_NAME}." \
            "Is the cluster up? \`k3d cluster list\`."

# registries.yaml may carry several mirror keys. Both readers below look only
# under the registry host's own key, so another key can neither hide a pending
# migration nor be rewritten. Quotes are ignored: k3d writes the key bare, the
# upstream config quotes it, and a hand edit may do either.
#
# stdin: registries.yaml. Prints that key's endpoint lines, trimmed.
registry_endpoints() {
    awk -v key="  ${REGISTRY_HOST}:" '
        { bare = $0; gsub(/"/, "", bare) }
        bare == key { inblock = 1; next }
        inblock && (bare ~ /^[^ ]/ || bare ~ /^ [^ ]/ || bare ~ /^  [^ ]/) { inblock = 0 }
        inblock && bare ~ /^ *- / { sub(/^ */, "", bare); print bare }'
}
# stdin: registries.yaml. Prints it with that key's self-referential endpoint
# replaced by the load balancer; every other line passes through unchanged.
registry_rewritten() {
    awk -v key="  ${REGISTRY_HOST}:" -v self="- http://${REGISTRY_HOST}" -v lb="- ${LB_ENDPOINT}" '
        { bare = $0; gsub(/"/, "", bare) }
        bare == key { inblock = 1; print; next }
        inblock && (bare ~ /^[^ ]/ || bare ~ /^ [^ ]/ || bare ~ /^  [^ ]/) { inblock = 0 }
        inblock {
            match(bare, /^ */)
            if (substr(bare, RLENGTH + 1) == self) { print substr($0, 1, RLENGTH) lb; next }
        }
        { print }'
}
# Where registries.yaml sends the registry host: "lb", "self", or "" for a
# shape this script does not know and will not touch.
node_mirror() {
    local eps
    eps="$(docker exec "$1" cat "$NODE_REGISTRIES" 2>/dev/null | registry_endpoints || true)"
    if grep -qxF -- "- ${LB_ENDPOINT}" <<<"$eps"; then echo lb
    elif grep -qxF -- "- http://${REGISTRY_HOST}" <<<"$eps"; then echo self
    fi
}
# Whether containerd, as k3s last rendered it, still reaches the registry by
# the injected name. A missing hosts.toml is read as "yes": the conservative
# answer, and the one older k3s layouts deserve.
node_pulls_need_name() {
    ! docker exec "$1" grep -qF -- "${LB_ENDPOINT}" "$CONTAINERD_HOSTS_TOML" 2>/dev/null
}
node_hosts_has_name() {
    docker exec "$1" grep -qE \
        "^${HOST_GW//./\\.}[[:space:]]+host\.k3d\.internal([[:space:]]|\$)" /etc/hosts 2>/dev/null
}

if [ "$MODE" = "check" ]; then
    rc=0
    echo "host.k3d.internal on ${CLUSTER_CONTEXT}"
    echo "   network gateway:  ${HOST_GW}"
    # NodeHosts is reported too: it is where k3d put the name and where k3s
    # takes it away, so its state says whether this cluster has restarted since
    # it was created.
    if kubectl -n kube-system get cm coredns -o jsonpath='{.data.NodeHosts}' 2>/dev/null \
        | grep -q 'host\.k3d\.internal'; then
        nodehosts_carries_name=1
        echo "   NodeHosts:        carries the name (k3d's own entry is intact)"
    else
        nodehosts_carries_name=0
        echo "   NodeHosts:        dropped (expected after a node restart)"
    fi
    if [ "$current" = "$DESIRED" ]; then
        echo "   coredns-custom:   ✅ ${CM_KEY} present, answers ${HOST_GW}"
    elif [ -n "$current" ]; then
        echo "   coredns-custom:   ⚠️  ${CM_KEY} present but stale (gateway moved?)"
        rc=1
    elif [ "$nodehosts_carries_name" = 1 ]; then
        # Resolving today, on k3d's own entry — so the rewrites work and nothing
        # is broken yet. Still reported as a finding: that entry goes at the
        # first node restart, and this is the window in which to pre-empt it.
        echo "   coredns-custom:   ❌ ${CM_KEY} absent — the name resolves from NodeHosts"
        echo "                        today, and goes with it at the next node restart"
        rc=1
    else
        echo "   coredns-custom:   ❌ ${CM_KEY} absent — rewrites resolve to nothing"
        rc=1
    fi
    for node in $NODES; do
        echo "   ${node}:"
        mirror="$(node_mirror "$node")"
        case "$mirror" in
            lb)   echo "     registry mirror:  ✅ ${LB_ENDPOINT}" ;;
            self) echo "     registry mirror:  ❌ http://${REGISTRY_HOST} (itself) — pulls depend on the injected name"
                  rc=1 ;;
            *)    echo "     registry mirror:  ⚠️  ${NODE_REGISTRIES} has a shape this script does not know"
                  rc=1 ;;
        esac
        if ! node_pulls_need_name "$node"; then
            echo "     image pulls:      ✅ reach the registry through the load balancer; no injected name involved"
        elif node_hosts_has_name "$node"; then
            echo "     image pulls:      resolve host.k3d.internal from /etc/hosts (k3d's own line is intact)"
            [ "$mirror" = lb ] \
                && echo "                       the load-balancer route takes over when k3s next starts"
        else
            echo "     image pulls:      ❌ resolve host.k3d.internal, and /etc/hosts has dropped it — fresh pulls fail"
            rc=1
        fi
    done
    for node in $STOPPED_NODES; do
        echo "   ${node}:"
        echo "     not running:      ⚠️  neither inspected nor migrated; run again once it is up"
        rc=1
    done
    exit $rc
fi

if [ "$current" = "$DESIRED" ]; then
    echo "⏭️  host.k3d.internal already answers ${HOST_GW} in CoreDNS"
else
    # Merge-patched, never applied: setup-agent-manager.sh and
    # setup-env-for-aectl.sh own their own keys in this same ConfigMap, and an
    # apply that declares only this one would prune theirs.
    kubectl -n kube-system patch cm coredns-custom --type merge \
        -p "$(V="$DESIRED" K="$CM_KEY" python3 -c \
            'import json,os; print(json.dumps({"data": {os.environ["K"]: os.environ["V"]}}))')"
    kubectl -n kube-system rollout restart deployment/coredns
    kubectl -n kube-system rollout status deployment/coredns --timeout=120s
    echo "✅ host.k3d.internal answers ${HOST_GW} in CoreDNS"
fi

rc=0
for node in $NODES; do
    case "$(node_mirror "$node")" in
        lb) echo "⏭️  ${node}: registry mirror already ${LB_ENDPOINT}" ;;
        self)
            # Read whole, rewrite on this side, write whole: the node needs
            # nothing beyond cat, and the file is never half-written.
            rewritten="$(docker exec "$node" cat "$NODE_REGISTRIES" | registry_rewritten)"
            printf '%s\n' "$rewritten" | docker exec -i "$node" sh -c "cat > '${NODE_REGISTRIES}'"
            # Read back rather than trust the edit.
            if [ "$(node_mirror "$node")" = lb ]; then
                echo "✅ ${node}: registry mirror → ${LB_ENDPOINT} (containerd takes it up when k3s next starts)"
            else
                echo "❌ ${node}: ${NODE_REGISTRIES} still routes ${REGISTRY_HOST} to itself; its endpoint" >&2
                echo "   line is not the plain '- http://${REGISTRY_HOST}' this script rewrites. Edit it by hand." >&2
                rc=1
            fi
            ;;
        *)  echo "⚠️  ${node}: ${NODE_REGISTRIES} has a shape this script does not know; left alone" >&2
            rc=1 ;;
    esac
    if node_pulls_need_name "$node" && ! node_hosts_has_name "$node"; then
        docker exec "$node" sh -c "echo '${HOST_GW} host.k3d.internal' >> /etc/hosts"
        echo "✅ ${node}: '${HOST_GW} host.k3d.internal' back in /etc/hosts — image pulls resolve again."
        echo "   Delete any pod in ImagePullBackOff so its Deployment re-pulls at once."
    fi
done
for node in $STOPPED_NODES; do
    echo "⚠️  ${node}: not running — neither inspected nor migrated; run again once it is up" >&2
    rc=1
done

echo ""
echo "   Verify from inside the cluster:"
echo "     kubectl -n kube-system run dnscheck --rm -i --restart=Never \\"
echo "       --image=busybox:1.36 --command -- nslookup thunder.openchoreo.${AE_DOMAIN:-localhost}."
echo "   Verify a node's route to the registry (expects {}):"
echo "     docker exec ${NODES%%$'\n'*} wget -q -O- ${LB_ENDPOINT}/v2/"
exit $rc
