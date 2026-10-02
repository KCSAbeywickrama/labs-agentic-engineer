# AGENTS.md — tests/e2e

End-to-end walks of the console (`apps/console`) against the real
local stack, driven by `agent-browser` from bash. How to run: `README.md`.

**Status:** `acme-expenses-walk.sh`, the live walk of the running example;
steps 1–2 (sign-in, New project). Add a step only once its screen is wired to
aep-api; no placeholders for steps that are not.

## Conventions

- Run against the cluster from `deployments/` (`make dev-env` once, `make
  dev-update` after each source edit) — no mocked infra.
- Locate by role and accessible name (`find role … --name … --exact`); CSS only
  for an element with no role, with a comment saying why.
- Every check waits with a timeout and fails with `step N failed: <what>`.
- Anything that creates real resources (repositories, agent turns) stays behind
  `E2E_CREATE=1` and is cleaned up in the exit trap.
- Walk the flow by hand with agent-browser before scripting it.
