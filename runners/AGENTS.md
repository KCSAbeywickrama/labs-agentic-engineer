# AGENTS.md — runners/

One-shot / job images (not long-lived services). Run to completion in a pod.

**Status:** `remote-worker/` holds the `asdlc` skill plugin loaded by the
coding-agent runner — a TS Claude Agent SDK one-shot pod that provisions a
workspace, loads the `asdlc` skill, and runs the Agent SDK. The dev flow
bind-mounts `runners/remote-worker/plugin` into the runner pod for live skill
edits (see `deployments/scripts/setup-k3d.sh`).

## Conventions

- One public entry point (`src/index.ts`).
- Self-contained: all agent and SDK-specific wiring lives here.
