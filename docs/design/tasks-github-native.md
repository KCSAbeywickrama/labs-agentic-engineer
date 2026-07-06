# Tasks: GitHub-native redesign — decision record

**Status:** 📐 Decided (grilling session 2026-07-04) — not built.

**Scope:** the whole tasks horizontal slice — domain model, GitHub representation,
state machine, reactive execution, plan generation on the new agents service, BFF
API surface, DB schema, and cutover. Replaces the legacy slice described in §9 of
`agents-generation-migration.md` (tech-lead plan/detail on agents-legacy,
`component_tasks`, projector, board fusion).

**Audience:** whoever implements this. Assumes `services/agents` (generic
tool-loop agent, `@aep/agent-stream`), the `internal/feature/*` BFF layout, and
the vocabulary in root `CONTEXT.md` (Task, Execution, machine block, command
label, projection label, plan turn — all defined there).

---

## 1. Core model: the Task/Execution split

Today's `component_tasks` conflates two entities with different owners and
lifecycles. They are separated:

| Entity | What | Owner | Store |
|---|---|---|---|
| **Task** | The work item: what should be done, for which component, its review state and lifecycle | **GitHub issue, entirely** — labels, body, open/closed, PR links | GitHub only |
| **Execution** | One platform attempt at one kind of work for a Task | Platform | Postgres `executions` |

Consequences:
- The `component_tasks` table, `TaskLifecycleStatus`, the 10-status
  `TaskStatus` enum + transition algebra, and the webhook projector **die**.
- The platform projects Execution progress onto the issue
  (labels/comments/board column); it never reads those projections back as truth.
- A Task exists the moment a correctly-labeled issue exists, **regardless of who
  created it** (console, plan turn, human, alerting tool). Reactive birth is the
  API for use cases like incident remediation and ops provisioning: external
  systems just open labeled issues — no BFF integration required.

## 2. Task representation on the issue

**Labels** carry flat, routable/filterable facts; a **machine block** carries
structured facts. Everything on an issue is human-editable, so nothing is
trusted blindly: the block is validated reactively (`issues.edited`), repaired or
flagged when mangled, and re-verified against the design at HEAD at the moment of
use (dispatch).

```markdown
<!-- aep:task/v1
component: order-service          # coding tasks; ops tasks carry `operation:` instead
dependsOn: [user-service, catalog] # component names — never issue numbers
origin: spec-plan                  # spec-plan | incident | manual
specTag: requirements-v3           # lineage
designTag: design-v5               # lineage = idempotency baseline; replaces batch_id
key: 7f3ac2…                       # idempotency key (hash: project, designTag, component, title-slug)
-->
> **Rationale:** …one sentence from planTask…

## Scope
…body written via updateTask (LLM) — human-editable afterwards…
```

Label vocabulary (proposal — bikeshed freely):
- Marker: `aep:task` (the router ignores unlabeled issues)
- Executor class (routing, exactly one): `aep:coding` | `aep:ops`
- Origin (filterable): `aep:origin/spec-plan` | `aep:origin/incident` | `aep:origin/manual`
- Commands (human/external-written only): `aep:execute` (edge-triggered,
  consumed by platform), `aep:hold` (level-triggered, stands while present)
- Projections (platform-written only): `aep:status/*` (derived status mirror),
  `aep:attention` (something needs a human — mangled block, stale vs design,
  refused op, no executor)

Rejected encodings: Projects v2 custom fields (org-level, GraphQL-only,
item-not-issue, recreates board_service coupling), deps-by-issue-number /
milestones-as-lineage (numbers unknown during batch creation; overloads human
planning concepts). Deps stay component names (the phase5 lesson).

## 3. Taxonomy

One **routing** dimension: executor class (`coding` = produces a PR via a coding
agent; `ops` = performs a platform operation). **Origin is metadata, never
routing** — an incident-born task needing a code fix is `aep:coding` +
`aep:origin/incident` (use case 3). Extending the platform = new class label +
executor registry entry (§11).

## 4. State: derived, projected, commanded

Truth = native GitHub facts (issue open/closed, linked PR open/merged/closed)
⋈ latest Execution per kind. Task status is **computed**, never stored:

| Derived status | From |
|---|---|
| pending | issue open, no active/successful coding Execution |
| in_progress | active coding Execution |
| ready_for_review | linked PR open |
| merged / building / deployed | PR merged / active / succeeded build Execution |
| rejected | PR closed unmerged |
| abandoned | issue closed without merge |
| failed | latest Execution of a kind failed |
| on_hold | `aep:hold` present (a command, honored not derived) |

The predicates overlap (issue closed while its PR is open; a failed retry after
an earlier attempt's PR). `derive.go` is **first-match-wins** in this order:
on_hold → merged-group (deployed / building / failed / merged — a merged PR is
irreversible and wins over a later issue-close; the latest build Execution
decides deployed/building/failed, none-or-canceled → merged) → abandoned →
ready_for_review (PR open) → in_progress (active coding/ops Execution) → rejected
(latest PR closed unmerged) → failed (latest Execution failed) → pending.
(Chosen default — §13.) **Amended 2026-07-04 during build: failed latest build
surfaces failed (not merged); an active retry surfaces in_progress over rejected
— retry visibility beats group purity (§13 default revised).**

`aep:status/*` labels are the **only** GitHub-side projection (write-only, for
humans and cheap filtering). **GitHub Projects v2 is dropped from v1 entirely**:
with metadata (§2), triggering (§5), and reads (§8) all rejected, a board would
be a write-only mirror — and a kanban invites drags it would silently ignore (a
lying affordance), while costing org-level GraphQL, PAT `project` scopes, and a
lazy create/link dance per repo. The console groups by `derivedStatus` from the
API (§9.1) and needs no labels for it.

**Update semantics:** an Execution snapshots its Task at dispatch. Updates to an
in-flight task apply to the issue immediately (audit comment notes the running
attempt keeps its dispatch-time scope) and affect future Executions only.

**Close semantics ("let it finish"):** closing an issue (humans only — the
planner has no close tool) stops **new** dispatches; an active Execution runs to
completion. The PR is its own human gate: merging it = approval (build/deploy
proceeds regardless of issue state); closing it records the coding Execution's
outcome as rejected. Reopening the issue re-enables dispatch.

## 5. Reactive engine: the single funnel

```
intent (aep:execute label, from anyone) → webhook / reconciliation sweep
  → gate check: not on hold ∧ no active Execution ∧ dependsOn satisfied
  → executor registry by class label → Execution row → run
```

- `aep:execute` is **consumed** (removed) by the platform when acted on; the
  issue timeline is the dispatch audit log. Retry = add it again.
- Console's Execute button = BFF stamps the label; the effect always flows
  through the funnel. There is no imperative dispatch path — gates cannot be
  bypassed because there is no second door.
- **Admission control is the executions table, not the gate check.** Funnel
  entrants race (webhook delivery ∥ sweep tick); the gate check is advisory.
  The authoritative mutex is a partial unique index on `executions`
  `(repo, issue_number, kind) WHERE status IN ('queued','running')` — dispatch
  begins with `INSERT … ON CONFLICT DO NOTHING`, and the losing entrant stops.
  Label consumption is best-effort projection, never a lock.
- **Trust boundary (deliberate):** anyone with repo write access can stamp
  command labels — repo collaborator management *is* the dispatch permission
  model. That is reactive birth working as designed, not a bypass of BFF authz.
- **Deps gating:** every `dependsOn` component's task (latest for that
  component) must derive `deployed`. Unsatisfied → Execution row `queued` with
  reason; re-evaluated on every build-Execution success and by the sweep. (A
  new delta task for a dependency re-gates its dependents until it deploys —
  intended.) Cycles are rejected at plan time (§9.3); if a human block edit
  introduces one, the sweep detects it and flags `aep:attention` — otherwise
  the cycle would sit queued forever, indistinguishable from waiting.
- **Reconciliation sweep** (required component, not an afterthought): periodically
  re-list open `aep:task` issues, re-validate machine blocks, pick up missed
  webhooks (un-consumed `aep:execute`), requeue gating checks. Also the
  disaster-recovery path — everything platform-side is rebuildable from GitHub +
  executions rows.
- GitHub Projects v2 is absent in v1 (§4). If kanban-in-GitHub demand appears,
  Projects returns as a **command surface** (column-move → the same funnel
  command, with echo suppression) plus projection together — additive, no
  redesign. It never returns as a mirror alone.

## 6. Plan generation on the new agents service

Console-triggered (button), **not** design-tag-reactive in v1 (considered,
dropped for complexity; nothing here forecloses adding auto-plan later).

- **Domain task tools, not file tools.** The generic tool-loop agent gets a
  per-turn tool set: `planTask` (create: component, title, rationale, dependsOn,
  labels/origin) and `updateTask` (patch fields and/or set body). **No close
  tool.** Tool inputs are complete, self-contained JSON — no folding anywhere.
  Behavior steered by a `task-planning` skill; same loop, skills, evals,
  playground. Author-time validation = tool input schemas + tool-side checks
  against pushed context (model self-corrects in-turn).
- **Context assembly (BFF):** spec+design at their tags, plus existing open
  Tasks listed live from GitHub (rendered with machine block + derived state) as
  read-only context. Fresh and incremental are the same flow — incremental just
  has a non-empty existing set (use cases 1, 2, 2.1, 2.2). **When existing
  Tasks' lineage differs from the current tags, the assembler also includes the
  spec and/or design diff between the lineage tag and the current tag** (GitHub
  compare API between two refs — not the deleted DB diff machinery), so
  incremental planning reasons over the actual delta: update pending tasks of
  affected components (re-stamping their lineage), delta tasks for done work,
  attention-flagged updates for in-flight work, silence for untouched
  components. The planner never invents components — a requirement no design
  component covers is flagged "regenerate the design" (skill instruction).
- **BFF executes mid-stream.** The BFF proxies the SSE (raw `StreamPart`s,
  `@aep/agent-stream` wire) to the FE verbatim AND acts on task tool-result
  frames as they pass: create/update GitHub issues. The tap consumes BEFORE
  forwarding, so a delivered ok result frame implies the GitHub write already
  landed. Survives tab close (BFF drains upstream to completion). The FE renders
  no draft cards — it refreshes the task list on each ok result frame, so the
  issue row materializes directly in the pending section (updates refresh the
  row in place); a slow ~5s poll during streaming remains as a backstop (§8).
  The legacy ad-hoc task SSE contract (`data-plan-item` etc.) dies.
- **Bodies in the same turn:** after planning, the agent writes each body via
  `updateTask` — full design + sibling tasks in context, prompt caching absorbs
  the prefix. No detail fan-out, no design slicing, no `BodySyncPending`.
  Parallel fan-out is a later optimization if plans outgrow this.
- **Authority: free rein + flags.** planTask/updateTask ops always apply, with
  audit comments; updates to in-flight/done/on-hold tasks get `aep:attention` so
  humans notice. Obsolete components (removed from design) → planner *updates*
  the task with an obsolescence note + attention flag; a human closes it.
- **No pre-creation review.** Review happens on the created issues (existing
  console pages / GitHub UI) in the gap the execute gate guarantees: nothing
  runs until someone stamps `aep:execute`.
- **Idempotency & concurrency:** issues are created with `key` in the machine
  block; before creating, the BFF dedupes against the existing set it just
  listed (crash re-run safe). One active plan turn per project (BFF in-flight
  check + service 409 `turn_in_progress` passthrough). Re-planning the same
  designTag with all tasks already created converges to no-ops by construction
  (the agent sees them in context).
- Service prerequisites are phase 0 of `agents-generation-migration.md`
  (per-request key, M2M, keep-alives) + per-turn registrable domain tools.

## 7. Executions (Postgres)

One row = one attempt of one **kind**; no row spans a human gate.

```
executions(
  id uuid pk, org_id, project_id, repo, issue_number int,
  kind text,          -- coding | build | ops
  status text,        -- queued | running | succeeded | failed | canceled
  run_name text,      -- OpenChoreo WorkflowRun / build run
  design_tag text,    -- dispatch-time lineage snapshot
  reason text,        -- queued-gating reason / error
  created_at, started_at, ended_at
)
-- admission mutex (§5): UNIQUE (repo, issue_number, kind)
--   WHERE status IN ('queued','running')
```

- Coding Execution ends at PR-opened (webhook parses `Closes #N`, as today).
- PR merged → **spawns** a build Execution (reactively).
- Retry of any kind = new row of that kind. Today's `LastBuildRunName`,
  `LastCodingAgentRunName`, `BuildAuthRetryCount`, `DispatchDeferredAt`,
  `ErrorMessage` all become row fields/rows here.
- Ops Executions: same table, `kind=ops`, no PR/build — executor TBD (§11).
- Progress (agent/build log streams) keyed by execution id; kind selects source.

## 8. Read path

**Live reads from GitHub** on demand — no cache, no read model. FE gets a manual
refresh button; the always-on 5s board poll dies. While a plan-turn SSE is
active, the FE refreshes on each ok `planTask`/`updateTask` result frame (the
tap wrote before forwarding, §6) so issues appear the moment they are created,
with a slow ~5s poll as backstop. Webhook-driven changes surface on next refresh. (If rate limits ever bite: conditional
requests, then a webhook-invalidated cache — additive later, per Q1.)

## 9. API changes

### 9.1 BFF public surface (org-scoped `/api/v1`, Huma code-first, org from verified token)

| Op | Endpoint | Notes |
|---|---|---|
| Plan | `POST /projects/{p}/tasks/plan` → SSE | Own route (not the unified turns endpoint: no FE files, BFF taps the stream, no fold). Raw `StreamPart` passthrough. |
| List | `GET /projects/{p}/tasks` | Live issues ⋈ executions → derived status; `?state=open\|closed\|all` (default open). FE groups client-side. |
| Get | `GET /projects/{p}/tasks/{issueNumber}` | One Task + full Execution history. Detail page. |
| Execute | `POST /projects/{p}/tasks/{issueNumber}/execute` | Stamps `aep:execute`; funnel does the rest. Doubles as retry. Idempotent: no-op if an Execution is already active/queued; on a held task the intent queues behind the hold gate. **No execute-all endpoint** — the console's "Execute all" button fans this out per task; dependency ordering emerges from the funnel gates, so batch dispatch logic exists nowhere. |
| Hold | `POST` / `DELETE /projects/{p}/tasks/{issueNumber}/hold` | Level-triggered hold label. |
| Progress | `GET /projects/{p}/executions/{executionId}/progress` | Unified; replaces the agent/build pair. |

Shapes (sketch-level; field bikeshedding free):

```jsonc
// POST /projects/{p}/tasks/plan
// request: empty body — the BFF composes the whole generation directive
// server-side from context (design, existing tasks, lineage diff). An optional
// user-steer field is a non-breaking later addition if a UX ever wants one.
// pre-stream: 400 no approved spec/design tag (gate as today),
//             409 {code:"plan_in_progress"}, 502 upstream
// stream: verbatim StreamPart frames + [DONE]; the BFF taps planTask/updateTask
// tool-call frames mid-stream and performs the GitHub writes (§6)
```

```jsonc
// GET /projects/{p}/tasks — one item
{
  "issueNumber": 42, "title": "Implement order-service", "issueUrl": "…",
  "executorClass": "coding", "origin": "spec-plan",
  "component": "order-service", "dependsOn": ["user-service"],
  "lineage": { "specTag": "requirements-v3", "designTag": "design-v5" },
  "derivedStatus": "ready_for_review",          // computed per §4, never stored
  "hold": false, "attention": ["stale-design"], // standing flags, [] when clean
  "executions": {                                // latest row per kind (full list on Get)
    "coding": { "id": "…", "status": "succeeded", "runName": "…", "endedAt": "…" },
    "build":  { "id": "…", "status": "running" }
  }
}
```

```jsonc
// POST …/execute → 202 {}   (stamps the label; effect is async via the funnel)
//   409 if the issue is closed (closed = no new dispatches, §4)
// POST …/hold → 204 ; DELETE …/hold → 204   (idempotent)
// GET …/executions/{id}/progress → existing ProgressResponse contract, unchanged
```

**Deleted:** `GET /board` (+ board fusion), `POST /tasks/dispatch`,
`POST /tasks/{id}/retry`, `GET /tasks/generated` + `models.Tasks`,
`GET /tasks/{id}` (old form), `GET /tasks/{id}/status`,
`POST /tasks/{id}/regenerate-body`, the ad-hoc task SSE frame contract
(`data-plan-item`, `data-task-body-delta`, …).

### 9.2 Internal S2S + webhooks

- Skills read stays runner-scoped, re-keyed:
  `GET /internal/v1/executions/{executionId}/skills` (the runner JWT's task
  claim becomes an execution claim; the coding agent's contract is otherwise
  unchanged).
- Webhook receiver endpoint and routing unchanged — **subscription is not**:
  `issues` joins gitrepo's `subscribedEvents` (today `pull_request`/`push`/
  `issue_comment` only), and `RegisterWebhook`'s already-exists path returns
  the existing hook *without updating its events*, so cutover must PATCH
  pre-existing repo hooks' event lists (app-mode: add Issues to the GitHub
  App's subscription — an ops step). Consumed events, new semantics:
  `issues` opened/labeled/unlabeled/edited/closed/reopened (task birth,
  commands, block validation/repair, close/reopen rules) and `pull_request`
  opened/closed (end coding Execution / spawn build Execution on merge).
  OpenChoreo build/deploy state keeps arriving via the existing watchers, now
  writing execution rows.
- **Echo suppression is a receiver invariant** (not just the Projects-v2
  footnote in §5): every platform write — status/attention labels,
  `aep:execute` consumption, block repair — fires `issues.*` right back.
  All `issues.*` handlers drop deliveries whose sender is the platform's own
  identity (app bot slug / machine-PAT user), and block repair writes only
  when the canonical re-serialization differs from the current body, so
  repair converges in one step (no edit ping-pong).

### 9.3 Agents service contract changes (`services/agents`)

```jsonc
// POST /conversations/:id/turns — one new field
{
  "instruction": "…", "files": { "…": "…" }, "skills": [ … ],
  "toolset": "task-plan"        // NEW, optional; default "files"
}
```

- `toolset: "files"` (default): exactly today's tool set — nothing changes for
  the migrated generation flows.
- `toolset: "task-plan"`: registers `loadSkill`(+references) + **`planTask`** +
  **`updateTask`**; no file tools. `files` still carries the read-only context
  (spec/design bundle + existing-Task renderings); nothing mutates it.
- Tool inputs (sketch): `planTask{component, title, rationale, dependsOn[],
  origin?}`; `updateTask{ref: {issueNumber}|{title}, set: {title?, rationale?,
  dependsOn?, body?}}` — `issueNumber` refs pre-existing Tasks from the context,
  `title` refs Tasks planned earlier in the same turn (the BFF resolves refs;
  the agent never sees issue numbers it didn't receive).
- Tool-side validation against pushed context (unknown component, unknown ref,
  duplicate title, `dependsOn` cycle across planned + existing tasks) returns
  tool errors → in-turn self-correction, same pattern as the `design.json`
  gate.
- Everything else (SSE wire, `[DONE]`, pre-stream statuses, conversation GET,
  phase-0 hardening) is per `agents-generation-migration.md` §12.3.

## 10. Code structure changes

Rule of thumb applied throughout: **the §1 split is a package boundary.**
GitHub-facing Task concerns and platform-owned Execution concerns never share a
package; the encoding they both speak is a pure contracts package both import.

| Decision | Structural consequence |
|---|---|
| Task/Execution split (§1) | `feature/task` = GitHub-facing surface; `feature/execution` = platform-owned half; **no task model/table anywhere** |
| Encoding is shared truth (§2) | machine-block codec + label vocabulary + derived-status algebra = one pure package (`contracts/taskmeta`); features import it, never re-implement it |
| Single funnel (§5) | exactly one dispatch code path (`execution` package); webhook handlers, sweep, and the execute endpoint all call *into* it — no sibling entry points |
| Executor registry (§3, §11) | `codingagent` shrinks to *one registered executor*; the ops executor arrives later as a sibling package + registry entry |
| BFF taps, never folds (§6) | the plan tap consumes tool-call frames only; no bundle/fold code exists in Go |
| Status derived (§4) | no package writes a task status anywhere; reads call the derive function |

### 10.1 BFF (`services/aep-api`)

```
internal/contracts/taskmeta/        # NEW — pure domain, no IO (arch-locked)
  block.go                          #   machine block schema + codec (+ repair)
  labels.go                         #   label vocabulary (marker/class/origin/commands/projections)
  derive.go                         #   derived status: (GitHub facts, executions) → status
  execution.go                      #   Execution kinds + statuses

internal/feature/task/              # Task = the GitHub-facing surface (rebuilt)
  task_huma.go                      #   plan / list / get / execute / hold routes
  reads.go                          #   live GitHub reads ⋈ executions → derived views
  commands.go                       #   execute / hold label stamping
  plan.go                           #   plan-turn context assembly (spec+design @tags,
                                    #   existing open Tasks rendered with state)
  plan_tap.go                       #   SSE proxy + mid-stream tool-frame executor
                                    #   (create/update issues, idempotency dedupe, drain)
  issue_compose.go                  #   machine block + body composition
                                    #   (absorbs gitrepo/issue_body.go)
  events.go                         #   issues.* webhook handlers: birth, block
                                    #   validate/repair, close/reopen, attention flags
  projections.go                    #   write-only projection: aep:status/* label
                                    #   (best-effort, async; the ONLY GitHub-side
                                    #   status mirror — Projects v2 is gone, §4)

internal/feature/execution/         # NEW — the platform-owned half
  model.go, repository.go           #   executions rows (replace models/component_task.go
                                    #   + repositories/task_repository.go)
  funnel.go                         #   THE dispatch path: command consumption + gates
                                    #   (hold, active-execution, deps-deployed)
  registry.go                       #   executor-class label → executor (coding wired;
                                    #   ops slot flags "no executor", §11)
  sweep.go                          #   reconciliation sweep (missed webhooks, requeue,
                                    #   disaster recovery)
  events.go                         #   pull_request handlers: PR-opened ends coding row,
                                    #   merge spawns build row ("let it finish" rules)
  progress_huma.go                  #   unified progress endpoint (existing
                                    #   contracts/progress.go shape survives)
  skills_s2s.go                     #   runner-scoped skills read, re-keyed to execution

internal/feature/codingagent/       # SHRINKS to the coding executor implementation
                                    # (job/externalsecret templates, workflowrun service,
                                    # watchers → write execution rows via ports)
```

**Deleted (BFF):** `feature/task/{board_huma,board_service,projector,
task_stream,task_service,task_diff,task_design,handlers}.go` (webhook handling
splits into the two `events.go` above), `contracts/{task_state,dispatch}.go`,
`models/{component_task,tasks}.go`, `repositories/task_repository.go`,
`feature/codingagent/on_hold_watcher.go` (hold is a funnel gate now),
`clients/agents` tech-lead plan/detail methods, `feature/gitrepo/issue_body.go`,
`clients/github/projects_v2.go` + the lazy board create/link in issue creation +
the `git_repositories.github_project_id` cache column (Projects v2 dropped, §4).
DB migration: drop `component_tasks`, create `executions`.
`internal/arch/arch_test.go` gains the locks in the table above (taskmeta purity,
task↛execution imports except ports, single-funnel writes).

### 10.2 Agents service + skills

```
services/agents/src/agents/main/
  tools/files.ts                    # today's tool.ts file tools, moved
  tools/task-plan.ts                # planTask/updateTask defs + context validation
  task-plan-accumulator.ts          # TaskPlan accumulator (FileBundle analogue)
  run-turn.ts                       # selects tool set from TurnRequest.toolset
skills/task-planning/SKILL.md       # repo-root core skill, go:embed'd like the others
services/agents/evals/              # plan-turn fixtures: skill pickup + plan quality,
                                    # fresh + incremental (K-sampled, report-not-gate)
```

### 10.3 `packages/agent-stream`

```
src/contracts/task-tools.ts         # planTask/updateTask input types + tool names
                                    # + tool error codes (UNKNOWN_COMPONENT,
                                    # UNKNOWN_REF, DUPLICATE_TITLE,
                                    # DEPENDENCY_CYCLE)
src/json-schema.ts                  # additionally exports the task-tool JSON Schemas
```

The BFF vendors the generated JSON Schemas with an anti-drift test — the exact
`componentDesignSchema` pattern (`internal/platform/designspec`). Service, evals,
console, and BFF validation all speak one definition.

### 10.4 Console (`console-legacy/console`)

- API client: delete dead methods (`getTasks`, `getTask`, `regenerateTaskBody`)
  and the board/dispatch/retry trio; add plan-SSE, tasks list/get, execute/hold,
  execution progress. Types: drop `taskDependsOn`, `ComponentTask`, `Task`,
  `ProjectBoard`; add the §9.1 shapes.
- Task pages read the new GETs (manual refresh; ~5s auto-refresh only while the
  plan SSE is active); the 8-frame ad-hoc stream parser is deleted — plan frames
  render via `@aep/agent-stream`'s SSE reader (tool frames only; no fold needed
  for display).
- Board hook (`useProjectBoard`) replaced by a tasks hook keyed to the new list.

### 10.5 agents-legacy: the whole service dies

The tech-lead plan/detail calls in the BFF's task stream are the **last live
callers of agents-legacy anywhere** — the generation-flows migration already
removed every call site of `StreamArchitect`, `StreamDocumentGeneration`,
`StreamRequirementsChat`, and `RenderDsl` (dead code in the legacy client
today), and nothing else (runners, console, tests) reaches the service. So
cutover step 5 (§12) deletes not just the tech-lead agent but **all of
`services/agents-legacy`** (architect, requirements-chat, document-generation,
dsl/render included), the entire `internal/clients/agents` package, the
`AGENTS_SERVICE_BASE_URL` config key, and the `agents-service` container in
docker-compose + its helm-chart equivalents.

## 11. Ops executor (design-ready, not built)

Executor registry keyed by class label: `aep:coding` → coding-agent dispatcher;
`aep:ops` → registered but executor TBD (use case 4: create DB, provision IDP).
Until it exists, `aep:execute` on an ops task → `aep:attention` + comment
("no executor for class ops"). Ops machine blocks carry `operation:` instead of
`component:`. Adding the executor is a registry entry + an Execution `kind=ops`
runner — no schema or API change.

## 12. Cutover

**Clean cut, no data migration** (labs-stage): new slice behind config with
legacy runnable; existing projects re-plan against their current design tag; old
unlabeled issues are inert to the new router (no `aep:task` label) and are closed
manually. `component_tasks` dropped at cutover.

Build order:
1. Agents service: per-turn domain tool registration + `task-planning` skill +
   pickup/plan evals (phase 0 hardening per the generation doc).
2. BFF: machine block codec + label vocabulary + plan endpoint with mid-stream
   executor (create/update only).
3. Executions table + webhook funnel (execute/hold, close/merge rules, deps
   gating, sweep) replacing dispatch/projector — includes the `issues` event
   subscription: extend `subscribedEvents`, PATCH pre-existing repo hooks,
   update the GitHub App subscription (§9.2).
4. FE: task pages onto new GETs + plan SSE rendering (`@aep/agent-stream`);
   manual refresh; delete dead API methods.
5. Delete: **all of `services/agents-legacy`** (tech-lead was its last caller —
   §10.5), `internal/clients/agents`, `task_stream.go`, board fusion, dead
   endpoints, `component_tasks`, compose/helm `agents-service` artifacts.

## 13. Defaults chosen without a dedicated grilling pass (flag if wrong)

Label names (§2), idempotency key recipe (§2), derived-status precedence order
(§4), queued-Execution gating mechanics (§5), sweep cadence, ops `operation:`
field shape (§11), progress re-keying (§9), `?state=` param shape (§9), tool
input/ref shapes (§9.3), package/file naming in §10, build-order phasing (§12).
