# AGENTS.md — scripts/

One-command dev tasks: cluster/stack lifecycle (setup/start/stop/teardown),
codegen helpers, and anything else that should be a single command.

**Status:** nothing here yet. The cluster/stack lifecycle scripts and the runner
image build/push land here.

## Conventions

- Scripts are thin and idempotent; prefer wrapping the `Makefile` verbs over
  duplicating logic.
- Replace the committed `local-dispatcher` binary with a build/fetch step here.
