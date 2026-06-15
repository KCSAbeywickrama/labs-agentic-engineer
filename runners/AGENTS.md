# AGENTS.md — runners/

One-shot / job images (not long-lived services). Run to completion in a pod.

**Status:** empty bucket. The coding-agent runner is ported here
(`runners/coding-agent/` from `remote-worker/`, `plan.md` §10) — a TS Claude
Agent SDK one-shot pod that provisions a workspace, loads the `asdlc` skill, and
runs the Agent SDK.

## Conventions

- One public entry point (`src/index.ts`).
- Shared agent building blocks come from `packages/agent` (SDK-agnostic surface);
  SDK-specific wiring stays here.
