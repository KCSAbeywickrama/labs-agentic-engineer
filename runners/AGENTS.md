# AGENTS.md — runners/

One-shot / job images (not long-lived services). Run to completion in a pod.

**Status:** nothing here yet. The coding-agent runner lands here
(`runners/coding-agent/`) — a TS Claude Agent SDK one-shot pod that provisions a
workspace, loads the `asdlc` skill, and runs the Agent SDK.

## Conventions

- One public entry point (`src/index.ts`).
- Self-contained: all agent and SDK-specific wiring lives here.
