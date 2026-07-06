# ADR-0004 — Dependency wiring is authored by the coding agent, never patched by the platform

When a task with dependencies is dispatched, the platform resolves the targets
(catalog names, env bindings, resource outputs) and posts them as a
"Platform-resolved dependencies" comment on the task's GitHub issue. The coding
agent copies that block verbatim into the component's `workload.yaml`. The
platform never patches a deployed Workload CR.

The alternative — the BFF patching `spec.dependencies` into the CR after deploy —
worked but split ownership of the workload between the repo and the platform:
`git checkout` of the repo no longer reproduced the running system. With
declarative wiring the repo stays the single source of truth for the workload,
at the cost of one round-trip through the coding agent when dependencies change.
