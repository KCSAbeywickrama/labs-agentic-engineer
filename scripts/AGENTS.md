# AGENTS.md — scripts/

One-command dev tasks: cluster/stack lifecycle (setup/start/stop/teardown),
codegen helpers, and anything else that should be a single command.

**Status:** empty bucket. The `deployments/scripts/*` lifecycle scripts and the
runner image build/push are reconciled here as services are ported (`plan.md` §10).

## Conventions

- Scripts are thin and idempotent; prefer wrapping the `Makefile` verbs over
  duplicating logic.
- Replace the committed `local-dispatcher` binary with a build/fetch step here.
