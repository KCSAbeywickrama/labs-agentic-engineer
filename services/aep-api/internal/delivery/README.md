# delivery — Delivery Pipeline

> **L2 · a domain.** Part of the [aep-api architecture](../../README.md).

Take a versioned Spec end-to-end: plan the Tasks, route every Execution through the ONE funnel, dispatch
coding agents, build/deploy the components, and run validation. **Single write-authority over the
executions store and the Temporal dev/task/validation workflows.**

```mermaid
flowchart LR
  API(["/api/v1"]) --> HTTP
  INT(["/internal/v1"]) -.-> VAL
  subgraph delivery
    HTTP["httpapi — build · task · execution handlers"]
    subgraph ROOT["root (shared kernel — types + ports + Temporal infra, no gorm)"]
      K1["Executor · DispatchRequest · TaskFacts · TaskStreamHub"]
      K2["Runtime · Signaler · signals · workflow I/O vocab (DevFlowInput/Status, DevPhase*…)"]
      K3["read DTOs — TaskView · ExecutionView · Lineage · TaskDetail"]
    end
    BUILD["build (buildpipe)"] --> ROOT
    TASK["task (taskflow)"] --> ROOT
    EXEC["execution — funnel/registry/sweep/TaskStreamService"] --> ROOT
    CODE["codingagent"] --> ROOT
    DEV["devflow — Temporal workflows/activities/worker"] --> ROOT
    VAL["validation — S2S context/credentials"] --> ROOT
    HTTP --> BUILD & TASK & EXEC
  end
  EXEC --> EXECS[("executions · workflow_runs")]
  DEV --> TMPRL[["Temporal"]]
  BUILD -->|SpecTagger · SaveSpec| SPEC[[spec]]
  BUILD -->|repo full-name| SC[[sourcecontrol]]
  CODE -->|org keys · git tokens| SEC[[platform/secrets]]
  EXEC -->|ExecutionReader| OPS[[ops]]
```

## Internal shape — kernel-root + feature sub-packages

Delivery is **not** the flat-root-of-services layout spec/organization/ops use, and **not** per-op slices.
Its absorbed features are densely cross-coupled AND carry the load-bearing `task ⊥ execution` split, which
the ordinary rules (`root ⊥ slice`, `slice ⊥ sibling`) cannot satisfy flat. The resolution: **anything
referenced across a feature boundary is a TYPE or PORT that lives in the ROOT; the feature logic that uses
it lives in a sub-package importing only the root.** `task` and `execution` are then peer sub-packages that
never import each other (the split survives as an internal boundary, re-asserted by `TestTaskExecutionSplit`),
and every former feature→feature edge becomes a legal slice→root type reference.

| Sub-package | Owns | Reaches the root for |
|---|---|---|
| `build` (buildpipe) | the whole-spec gate + `v<N>` tag cut, dev-workflow start/status, builds history, dep-drawer preflight | `Runtime`, the workflow I/O vocab, `TaskView` (via `TaskReader` port) |
| `task` (taskflow) | GitHub-native Task Commands/Reads/Plan + list/get/promote handlers | the read DTOs; reaches the funnel via the `Dispatcher` port |
| `execution` | the ONE funnel (admit/finish/reevaluate), registry, sweep, `TaskStreamService`, `OpsExecutionReader` | `Executor`/`DispatchRequest`/`TaskFacts`, `Signaler`, `TaskStreamHub` |
| `codingagent` | the CodingExecutor + dispatcher + job watchers + templates | `Executor`/`DispatchRequest`/`TaskStreamHub`, `Signaler` |
| `devflow` | the Temporal dev/task/validation workflows, activities, worker | `Runtime`, `Signaler`, the workflow I/O vocab |
| `validation` | the three S2S validation runner callbacks (context / test-credentials / criteria-report) | — (no cross-edges; least entangled) |
| `httpapi` | the aggregator: embeds build/task/execution handlers; **holds `Deps`** (see below) | imports the sub-packages (the exempt aggregator) |

**`Deps` lives in `httpapi`, not the root.** Every other domain keeps its `Deps` in the domain root, but
delivery's services live in sub-packages the root may not import (`root ⊥ slice`). The `httpapi` aggregator
is the one package allowed to name them, so `httpapi.Deps` + `httpapi.New` is where composition sits.

## Ports
| Port | Dir | Peer · contract |
|---|---|---|
| `Dispatcher` / `Reevaluator` | offers | `task` → the funnel's single dispatch door (root type, satisfied by `execution`) |
| `TaskReader` (returns root `TaskView`) | needs | `build` → the durable GitHub⋈executions read (satisfied by `*task.Reads` at the root) |
| `SpecTagger` (`*spec.SpecSaveResult`) · `SpecCollector` · `AuthDeriver` | needs | `spec` — the whole-spec gate + tag cut + design reads |
| `RepoLookup` (`owner/name`) | needs | `sourcecontrol` — repo full-name resolution |
| org-credential reads · `AnthropicKeyResolver` | needs | `platform/secrets` / P3a org repositories — coding-agent runner secrets |
| `ExecutionReader` (`ops.ExecutionFact`) | offers | `ops` — latest-execution-per-kind correlation (`execution.OpsExecutionReader`, P6-retired the app bridge) |
| `ValidationContext` · `ValidationCredentials` · `CriterionReporter` | offers | the S2S runner callbacks (`/internal/v1`, via the internalServer — not the public edge) |
| `CriterionStatusReader` | needs | `task` → the criteria checklist read (satisfied by `*delivery.CriterionStatusRepository`) |

## Owns
- The **executions** write-API (admit/finish/reevaluate through the funnel) and **workflow_runs**; the
  Temporal `Runtime`, `Signaler`, and the dev/task/validation workflows.
- **Persistence**: the `executions` / `workflow_runs` / `coding_agent_logs` / `criterion_statuses` gorm and
  their entities live in this domain — `repository_execution.go` · `repository_workflow_run.go` ·
  `repository_coding_agent_log.go` · `repository_criterion_status.go` over the `execution.go` /
  `workflow_run.go` / `coding_agent_log.go` / `criterion_status.go` entities — as single write-authority.

## Invariants — don't break
- **`task ⊥ execution`.** The GitHub-facing half (`task`) and the platform-owned half (`execution`) are
  peer sub-packages that never import each other; `task` reaches the funnel only through the root
  `Dispatcher` port. `TestTaskExecutionSplit` + `slice ⊥ sibling` both enforce it.
- **One funnel door.** Every Execution (coding, build, validation, provisioning) is admitted/finished/
  reevaluated through `execution`'s funnel — the single place org-fencing, dedup, and dep-gating live.
- **The kernel names no feature.** The root holds only types/ports/Temporal infra; it never imports a
  sub-package (`root ⊥ slice`), and the domain never imports `internal/feature/*`.
- **`Signaler` stays a nil-safe concrete type**, not an interface — its nil-safety (no-op when Temporal is
  unavailable) is load-bearing for tests and degraded runs.
- **The task-log stream is one connection, no server cursor.** `stream-task-log`
  (`GET .../tasks/{issueNumber}/log`, `text/event-stream`) carries a Task's whole live state — `task` /
  `execution` / `line` / `done` frames, the frame kind in a `type` field inside the `data:` payload so it
  rides the shared agent-stream parser. The server buffers no history and keeps no cursor; the client
  dedups and a reconnect re-derives. It settles/closes only on `deployed` — a transient `abandoned` during
  the merge→build handoff keeps it open.
- **Validation is the last devflow phase and never builds.** It starts only after every coding task
  succeeds and an OpenChoreo Ready-deployment check passes, then spawns `ValidationFlowWorkflow` → one
  `ValidationTaskWorkflow` lane per method (e2e only today). A validation Task is project-scoped, swaps to
  the Playwright runner image (`VALIDATION_RUNNER_IMAGE`), and its merged PR spawns **no build** — a
  completed validation derives to `deployed`/"Done". The acceptance oracle
  `specs/validation/validation-criteria.json` is read-only input authored in the design phase (spec domain).
- **Task LIST reads exclude the validation task** (`task/reads.go` `ListByTag`, the read-model boundary):
  it is a phase of the run, not an implementation task, so the console tasks page, the build's per-version
  task list, and the devflow planned-task graph never show it. Its state rides `deploy.validation`
  (+ `validationIssue`, `validationUrl`); `get-task` and `stream-task-log` still serve it by issue number —
  the pair the console validation log page consumes. `TaskView.prUrl` (recovered from the succeeded coding
  Execution's `pr#N` reason, no live PR query) links each Task's PR.
- **Per-criterion validation progress is durable, log-independent.** The Playwright runner reports each
  acceptance criterion's begin/end to the `runner-criteria-report` callback, which upserts
  `criterion_statuses` keyed by `(repo, issue_number, criterion_id)` (last-write-wins; execution id is
  provenance, not a key — a same-issue retry collapses onto the same rows). The console reads them via
  `get-task-validation-criteria` as its checklist seed and overlays the live `kind:"criterion"` stream frames, so a
  finished or FAILED (never-merged) run still shows the complete checklist without depending on the log
  snapshot tail. The runner also emits the same events onto its stdout NDJSON, so they ride the existing
  `stream-task-log` path for the live view with no backend stream-merge.
- Platform-wide rules (tenant gate, secrets fence, persistence-in-domain) → [../../README.md](../../README.md).
