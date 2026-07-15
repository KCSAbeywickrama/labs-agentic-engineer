# Developer guide — run the platform after a pull

How to bring AEP back up after `git pull` brings in the latest changes.

All commands are run **from the repo root**. Paths are relative — the
`deployments/scripts/*.sh` scripts resolve their own directories, so invoking
them by their full relative path works regardless of your shell's CWD (as long
as it's the repo root).

This assumes you have **already run the one-time `setup.sh`** at least once
(the k3d cluster + OpenChoreo + Thunder + Temporal exist). If not, see
[First-time setup](#first-time-setup) at the end.

## One command

`update.sh` automates the decision below: it diffs your checkout against the
last successful run, runs **only** the steps whose inputs changed, then hands
off to `start.sh`. It prints a plan and asks for confirmation first, and
auto-starts the k3d cluster if it exists but is stopped.

```bash
bash deployments/scripts/update.sh              # detect → plan → confirm → run
bash deployments/scripts/update.sh --dry-run    # preview the plan only (no side effects)
bash deployments/scripts/update.sh --yes        # run without the confirm prompt
bash deployments/scripts/update.sh --full       # run every step regardless of the diff
```

It records the last-run commit in `deployments/.aep-last-run` (git-ignored). On
its very first run — before that marker exists — it plans a full run. The manual
steps below are the reference for what it does and the fallback when you want to
run a single step yourself.

## Steps

### 1. Make sure Docker and the k3d cluster are up

The compose stack talks to an in-cluster OpenChoreo, so the cluster must be
running. After a reboot the cluster is *stopped*, not gone:

```bash
docker info >/dev/null && echo "docker ok"   # start Docker Desktop / Colima if this fails
k3d cluster list                             # is "openchoreo" running?
k3d cluster start openchoreo                 # start it if stopped
```

### 2. Sync dependencies from the pull

`pnpm-lock.yaml` / `go.work.sum` change often, so refresh workspace deps:

```bash
make install        # pnpm install + go work sync
```

### 3. Re-apply cluster config if deployment/manifests changed

When the pull touches `deployments/manifests/`, `deployments/single-cluster/`,
ClusterWorkflows, or ComponentTypes, re-run the idempotent AEP config step. It
re-applies ClusterWorkflows / ComponentTypes / Environment / AuthzRoleBindings,
and builds + imports the validation runner image if it is missing.

```bash
bash deployments/scripts/setup-aep.sh
```

### 4. Rebuild the validation runner image if its Dockerfile/toolchain changed

The validation runner's skills are baked into `aep-validation-runner:dev`. If
`runners/remote-worker/Dockerfile.validation` or the runner's TS/toolchain
changed in the pull, force a rebuild. (Skill-only edits are picked up live via
the plugin hostPath overlay and do **not** need this.)

```bash
make build-validation-runner FORCE=1
```

### 5. Start the stack

`start.sh` runs `docker compose up --build`, so it recompiles `aep-api`,
`agents`, `console`, etc. from your freshly-pulled source. It also refreshes
DNS, seeds the git-service kubeconfig, ensures OpenBao is reachable, and repairs
per-org secrets.

```bash
bash deployments/scripts/start.sh
```

### 6. Verify

```
Console:          http://localhost:8090   (login: admin / admin)
API:              http://localhost:9090
Agents:           http://localhost:4000
Temporal Web UI:  http://localhost:8233
SRE-handoff MCP:  http://localhost:3401/healthz  → {"status":"ok"}
```

`start.sh` prints these at the end and runs health checks (mcp-server,
runner-image drift, RCA agent). Watch its output for `⚠️` lines.

## Notes & gotchas

- **`.env` is preserved** across `setup-aep.sh` re-runs. Your
  `ANTHROPIC_API_KEY` / `GITHUB_APP_*` / `LOCAL_DEV_ADMIN_GITHUB_PAT` stay put —
  no need to re-edit unless you're adding them for the first time. Edit at
  `deployments/.env`.
- **Builds stuck in `CreateContainerConfigError`** after a cluster restart =
  OpenBao (inmem) lost its k8s auth. `start.sh` runs `repair-secrets.sh`
  automatically; if dispatches still hang, re-seed OpenBao and re-run
  `bash deployments/scripts/repair-secrets.sh`.
- **`make gen` / `make build` are for local IDE / typecheck / CI**, not required
  to run the stack — `start.sh`'s `--build` handles the deployed images. Run
  `make typecheck` / `make test` separately to validate the pull before
  starting.
- **Observability plane** (Live Progress, alert→RCA handoff) is skipped by
  default. To enable: `ENABLE_OBSERVABILITY=1 bash deployments/scripts/setup.sh`,
  or run `bash deployments/scripts/setup-observability.sh` directly.
- **Stop without destroying state:** `bash deployments/scripts/stop.sh` (compose
  down; cluster stays). Full teardown: `k3d cluster delete openchoreo`.

## First-time setup

Cluster doesn't exist yet:

```bash
make install
bash deployments/scripts/setup.sh   # k3d + prereqs + OpenChoreo + Thunder + Temporal + AEP infra
$EDITOR deployments/.env            # set ANTHROPIC_API_KEY (+ optional GITHUB_APP_*)
bash deployments/scripts/start.sh
```
