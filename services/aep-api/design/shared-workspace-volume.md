<!--
Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).

WSO2 LLC. licenses this file to you under the Apache License,
Version 2.0 (the "License"); you may not use this file except
in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied.  See the License for the
specific language governing permissions and limitations
under the License.
-->

# Shared workspace volume — shipped end state

How aep-api and agents share `/workspaces`: one RWO PVC, co-located pods,
bounded retention, and the accepted single-node limitation.

## 1. Shared RWO PVC `/workspaces` (D2, 2026-07-31)

One PersistentVolumeClaim mounts at `/workspaces` on aep-api (read-write) and
agents (read-only). aep-api is the sole writer: bare mirrors under
`repos/<org>/<project>/<repoSlug>/`, immutable per-SHA snapshots, `trash/`, and
`tmp/`. Agents derive snapshot paths from turn `WorkspaceRef` IDs + SHAs and
never write the mount.

Access mode is **ReadWriteOnce**. Size is **10Gi**. Ticket-11 D2 kept the
shared volume (reversed 2026-07-31); content does not move over HTTP.

## 2. Placement: shared-label podAffinity (hostname)

Both Deployments carry the same pod label
(`aep.io/workspace-colocation=<value>`) and a
`requiredDuringSchedulingIgnoredDuringExecution` podAffinity on that label with
`topologyKey: kubernetes.io/hostname`. The first pod schedules freely; later pods
must land on the same node so the RWO volume is attachable.

Not used:

- **hostname `nodeSelector`** — pins to a specific node name and fights
  reschedule after node loss.
- **agents → api podAffinity** — one-way affinity leaves aep-api free to move
  alone; mutual shared-label affinity keeps both sides together.

No `strategy: Recreate`. Identical `fsGroup` on every mounting pod (leaf
securityContext patch so `runAsNonRoot` is preserved).

## 3. Retention, maintenance, admission

| Knob | Value |
|---|---|
| `AEP_WORKSPACE_SNAPSHOT_MAX_AGE` | 1h |
| `AEP_WORKSPACE_TRASH_MAX_AGE` | 1h |
| `AEP_WORKSPACE_ORG_QUOTA_BYTES` | 2 GiB (2147483648) |
| Disk watermarks | high 85% / low 70% |
| Admission | refuse new snapshots at ≥ 90% used (bytes or inodes) |

Reaper sweep order (leader-only for disk-mutating passes): trash age-purge
**before** snapshot eviction; `tmp/` cleanup; orphan reconciliation; git
maintenance; org quota / watermark eviction. Two-phase delete lands under
`trash/<ulid>` then purges by age.

Git maintenance (never `git gc`, never `git maintenance --task=loose-objects`):

1. `repack -ad`
2. `prune --expire=2.hours.ago`
3. `pack-refs --all --prune`

Gate: >1000 loose objects or >20 packs; ~10 repos per tick; exclusive flock
with ~2s timeout then skip. `repack.writeBitmaps=false` on mirrors.

Admission at 90%: `Ensure` refuses a new snapshot when recorded usage ≥ 90%
(max of byte used% and inode used%) and the dest does not already exist;
in-flight reads and existing snapshots keep working. ENOSPC triggers an
emergency trash sweep and surfaces `ErrDiskFull`.

## 4. Accepted limitation: single-node RWO

Node loss takes the whole workspace plane offline until the volume reattaches
(~6–12 minutes typical). The design does **not** scale writers or readers past
one node: RWO + hostname co-location is the capacity ceiling.

## 5. Collab

Collab-server runs **replicas: 1**, `/healthz` probes, 512Mi memory limit,
`terminationGracePeriodSeconds: 30`, concurrent shutdown flush. D6 keeps access
tokens fresh over the stateless channel for long sessions; residual: a
last-leave forced flush often has no client for `token-please`, so exposure
stays the ≤60s commit debounce window.

## 6. Rejected alternatives

| Approach | Outcome |
|---|---|
| HTTP content bundles / `/internal/v1` bundle endpoint + agents HTTP client | Cancelled — D2 kept the shared mount; content does not move over HTTP |
| RWX in dev (multi-node flock) | Declined — stay RWO + co-location |
| Register #1 (persist HEAD/tags in Postgres / `PersistingWorkspace`) | Cancelled |
| Snapshot-layer removal | Cancelled |

## 7. Related concerns

- **Collab upstream:** console nginx can override the collab upstream via
  `COLLAB_SERVER_URL`; that is a deployment concern, not a workspace-volume
  change.
- **Anthropic credentials:** aep-api still applies per-org
  `anthropic-credentials` Secrets into workflow namespaces via the in-cluster
  client. Cloud/helm does not mount those files; the k8s push path and any
  ExternalSecret wiring remain operational cleanup outside this design.
