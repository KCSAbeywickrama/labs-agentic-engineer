# Project status stage aggregates — one poll for the overview pipeline

**Status: BUILT + LIVE-VERIFIED** (grilled, built test-first,
review-hardened, and e2e-verified on a fresh local cluster, all 2026-07-11 —
§7 has the record). Implements the backend of issue #184. The contract half is already merged (PR #186:
`SpecStage`/`BuildStage`/`DeployStage` in `packages/contracts/api/v1/openapi.yaml`,
all three **required** on `ProjectStatus`), and the console overview (#183)
already renders from it — `apps/console/src/features/projects/lib/pipeline.ts`
pins the display semantics, polling adaptively (5s while moving, 30s idle).
This doc pins the Go side: where each nested field comes from and why.

Companion docs: `temporal-devflow-orchestration.md` (the dev run this reports
on), `task-log-stream.md` (per-task detail — deliberately NOT this endpoint's
job).

## 1. Goal and non-goals

One `GET /projects/{projectName}/status` cheap enough to poll at 5s serves the
whole overview pipeline. Hard budget for the poll path: **no GitHub API, no
Temporal query, no origin `git fetch`** — only local-mirror git reads, DB row
reads, and one OpenChoreo API call.

Non-goals: the flat fields keep their contract semantics (unchanged outputs);
`GET /build/{tag}` and `GET /tags` are untouched (the former is expected to be
retired by this endpoint eventually, but that removal is not part of this
change); per-task fidelity stays on the tasks page / task-log stream.

## 2. Decisions

### D1 — Fetch-free git reads: one local snapshot per request

Every symbolic (branch-name) read in `gitfs` fetches origin first
(`engine.go freshenFor`), so today's flat-field status already does **4**
network fetches per poll (2 bundle reads + 2 `ListTags`). Instead: resolve
the local mirror's main SHA once (`HeadLocal` — new engine primitive, sibling
of `ListTagsLocal`: `ensureMirror` + shared flock + `resolveCommit`, no
fetch), then do every read SHA-addressed. Validated nuances (Phase 0): SHA
reads skip the fetch only for **full lowercase 40-hex** SHAs whose objects
exist locally (both hold here — the SHAs come from local resolution);
`ensureMirror` still clones on a repo's first-ever access, same as
`ListTagsLocal`.

Correctness argument: under committed-truth, aep-api is the **sole writer of
`specs/`** — generation auto-commits and `v<N>` tags are cut through the shared
bare mirror, so the mirror is always current for spec content. Runner merges
move origin main past the mirror, but they touch app code, not `specs/`, and
the platform's own write path fetches before pushing. Out-of-band GitHub edits
to `specs/` lag until some other fetching read refreshes the mirror — accepted.

Knock-on: the flat fields (`hasSpec`, `specStatus`, `hasDesign`, …) are
recomputed from the same snapshot — identical outputs, minus today's per-poll
fetches.

### D2 — Build stage: denormalized onto the `workflow_runs` row

`build.version` = row `Tag`, `build.status` = row status mapped
(`running→running`, `completed→succeeded`, `failed|canceled→failed`, no
row→`idle`) from the newest `kind=dev` row (`ListByProject` is already
newest-first). Task counts are **written to the same row by the dev workflow**:

- `tasks_total` once after plan (post cycle-check, pre fan-out),
- `tasks_done` / `tasks_failed` written as **absolute values** from the
  workflow's own deterministic counters at each task transition — never
  SQL increments, because the count activity inherits the server-default
  unlimited retry policy and an increment that commits but fails to report
  would double-count (Phase 0, F1),
- `active` is **computed** (`total − done − failed`), never stored.

Write mechanics (as built, review-hardened): the tally is **derived** inside
`scheduleTasks` by folding `status.Tasks` — `setTaskRef` is the single
transition seam, so a future transition site cannot desync the tally.
Flushes run in the loop body (a Selector callback must not block), only when
the tally changed, with retries **bounded at 3 attempts** (the
server-default policy is unlimited; a DB outage must never stall task
dispatch — a dropped write is healed by the next transition's absolute
values). Writes are scoped to the **execution** (`workflow_id, run_id`): a
same-tag rebuild reuses the deterministic workflow id, and the prior run's
frozen tally must survive it. `Record`'s upsert `DoUpdates` column list must
NOT include the count columns — `Record` runs twice per run (endpoint +
workflow first activity) and would zero them.

Why not a live Temporal query while running: the query only works while the
run is live, so a terminal snapshot write is needed *anyway* for the steady
state ("built · 5/5") — at which point per-transition row updates are the same
mechanism minus a second read path, a worker-liveness fallback, and a per-poll
RPC. ~N+1 tiny writes per build (N = task count) buys a poll path of exactly
one DB row read that survives Temporal archival/downtime.

Semantics: `build.tasks` reports **the run's own progress, frozen at
terminal** — coherent with version/status from the same row. The tasks page
remains the live per-task derivedStatus truth (out-of-band retries after a run
show there, not here). The contract's "derivedStatus buckets" phrasing is
honored as bucket vocabulary (done/failed/active), sourced from the run.

### D3 — Deploy stage: one OpenChoreo call

One org-scoped `ListReleaseBindings` call per poll, filtered client-side to
`rb.Spec.Owner.ProjectName == project` and `Environment == "development"` (the
platform's fixed dev environment name). No per-component fan-out.

### D4 — `deploy.components`: design-at-deployed-tag denominator, binding readiness numerator

`total` = component count in `design.json` read **at `deploy.version`'s tag**
(local SHA-addressed read; the tag snapshots the validated requirements+design
pair the build actually implemented, whereas HEAD may hold mid-build spec
edits no build has seen). `ready` = project's dev bindings whose conditions
say ready. `version == ""` → skip the read entirely (status is `none`,
counts 0/0).

Two review-settled edges: a tag missing from the local mirror (deleted
out-of-band, or a stale run row) is a **data state, not an outage** — the
denominator degrades to 0 instead of failing the poll (D7 carve-out). And
`ready`/`total` come from independent sources, so `ready > total` is
possible transiently (a component removed from the design between builds) —
informational counts, deliberately not reconciled.

### D5 — `deploy.status`: condition-driven, counts informational

Derived from binding conditions alone, precedence:

1. no bindings → `none`
2. any binding failed → `failed`
3. any binding progressing → `deploying`
4. all existing bindings ready → `deployed`

The design denominator never gates the status: a designed-but-never-built
component shows `deployed · 2/3` (console renders counts only in the
`deploying` state), not forever-`deploying`.

Predicates (Phase 0 — vocabulary verified against OpenChoreo v1.1.1
controller source, stable across the client's spec pin): key off the
**aggregate `Ready`-typed condition** (the same pattern as the provisioning
readiness watcher's `IsReady`), never `latestConditionReason` (last array
entry, ordering not guaranteed):

- ready: `Ready.Status == "True"`;
- failed: `Ready.Status != "True"` with reason in the explicit failure set
  (`RenderingFailed`, `ResourceApplyFailed`, `ResourcesDegraded`,
  `ResourcesNotReady`, `JobFailed`, `InvalidReleaseConfiguration`,
  `ReleaseUpdateFailed`, `ReleaseOwnershipConflict`, the `*NotFound` config
  errors);
- progressing: everything else not-True — unknown/new reasons and a missing
  `Ready` condition deliberately read as `deploying`, not `failed` (forgiving
  default; OC itself reports `ResourcesProgressing` while evaluating).

Bindings with `Spec.State == Undeploy` (reason `ResourcesUndeployed`) are
intentionally not deployed — excluded from both counts and status
derivation. The org-scoped list paginates (`Limit`/`Cursor`) — the client
call loops pages.

### D6 — `deploy.version`: newest succeeded dev run's tag

No OC resource carries the spec tag today. `version` = `Tag` of the newest
`kind=dev, status=completed` row — read from the same `ListByProject` call D2
already makes, zero extra cost. Timeline checks out: v2 build succeeds →
"deploying v2" while bindings roll; v2 fails after v1 shipped → build stage
shows failed v2, deploy keeps "v1 live in dev". Known limit: manual
per-component builds outside the dev flow change reality without changing
this field (parked; a future impl-complete tag would add true provenance).

### D7 — Failure mode: strict

Any stage-source failure (git, DB, OC) fails the whole request. The console's
poller keeps last-good data on error and retries in 5s, so a blip is
invisible and an outage shows stale-but-true data. The endpoint never
fabricates emptiness — a zero-valued deploy stage during an OC outage would
render as "nothing deployed", a lie. All three nested objects are required in
the contract; there is no partial-result shape.

Review hardening around this rule: (1) the ONE carve-out is
`deploy.version`'s tag vanishing from the mirror — a data state, degraded
per D4, where strict-500 would brick every poll permanently; (2) gitfs
`resolveCommit` now maps only a genuinely missing ref/object (rev-parse
`--verify --quiet` exit 1) to `ErrRefNotFound` — repo-level failures
(trashed/corrupt mirror, killed subprocess, exit 128) stay plain errors, so
the snapshot's empty-repo tolerance can never turn an infrastructure failure
into a fabricated-empty 200; (3) `DeleteProject` now purges the project's
`workflow_runs` rows, so a recreated same-named project cannot resurrect
stale runs.

### D8 — Repo not ready: zero-value stages

When the repo row short-circuits (`pending`/`cloning`/`error`), the nested
stages are present (required) but zero-valued: `spec{false,"",false,false}`,
`build{"",idle,0/0/0/0}`, `deploy{"",none,0/0}`.

## 3. Stage derivation reference

| Field | Source | Definition |
|---|---|---|
| `spec.exists` | git local | requirements files present under `specs/requirements/` at snapshot (same predicate as flat `hasSpec`) |
| `spec.version` | git local | highest `v<N>` tag on the mirror (`ListTagsLocal` + `parseRequirementsTag`); `""` if none |
| `spec.dirty` | git local | `specs/` subtree path→blob-SHA at snapshot ≠ at latest tag (reuses `specTreesEqual`); `false` when no tag |
| `spec.design` | git local | root design file present at snapshot (same predicate as flat `hasDesign`) |
| `build.version` | DB | newest dev run row's `Tag`; `""` if no row |
| `build.status` | DB | row status mapped: running→`running`, completed→`succeeded`, failed/canceled→`failed`, none→`idle` |
| `build.tasks` | DB | row counts (D2); `active = total − done − failed`; zeros when no row / pre-migration rows |
| `deploy.version` | DB | newest **succeeded** dev run row's `Tag`; `""` if none |
| `deploy.status` | OC | condition-driven precedence (D5) |
| `deploy.components.total` | git local | `design.json` component count at `deploy.version` tag; 0 when versionless |
| `deploy.components.ready` | OC | dev bindings passing the readiness predicate |

## 4. Read path anatomy

Per request, three independent source groups run concurrently (errgroup):

1. **git** — resolve local main SHA; bundle/tag reads (spec stage + deploy
   denominator), all SHA-addressed;
2. **DB** — repo row (existing) + one `workflow_runs.ListByProject(kind=dev)`
   (serves build version/status/counts AND deploy version);
3. **OC** — one `ListReleaseBindings(org)` filtered client-side.

Strict join (D7). Expected cost: two local git ops + two DB queries + one
HTTP call; the OC call is the only network hop.

## 5. Write path (counts)

- `devflow.WorkflowRunStore` port gains `SetTaskCounts(ctx, workflowID,
  runID, total, done, failed)` (absolute values, execution-scoped);
  satisfied by `repositories.WorkflowRunRepository`; exposed to the workflow
  as a new activity beside `SetWorkflowRunStatus`, with retries bounded at 3
  attempts (D2 write mechanics).
- Call sites: flushed from `scheduleTasks` on every tally change; the first
  flush (after the first start pass) publishes the plan size with a zero
  tally.
- Schema: three `int` columns with gorm `not null;default:0` on
  `models.DevflowRun` — AutoMigrate adds them at boot, no `RunAll` step
  needed (nothing to backfill; historical builds read `0/0` — accepted).
  dbtest's `baseModels` gained `&models.DevflowRun{}` (it had drifted from
  main.go) and `schemaVersion` was bumped.

## 6. Placement

All in `internal/feature/project` (`GetProjectStatus` extension) + structs in
`models/project.go` mirroring the contract exactly (required fields
non-omitempty). Mirroring rules (Phase 0/4): Go types named exactly
`SpecStage`/`BuildStage`/`DeployStage` (huma derives schema names from type
names); `tasks`/`components` are anonymous structs (huma registers them as
synthesized `*Struct` schemas — structurally identical to the contract's
inline objects; the comparison artifact was never byte-identical anyway, it
carries no schema descriptions repo-wide); counts are `int64`
(`format: int64`); stage `status` fields carry huma `enum:"..."` tags.
Verified in Phase 4: properties/required/enums of all four schemas match the
contract exactly. No new
feature→feature edges for the arch allowlist:
`project→artifacts` already exists (spec reads), `repositories` is shared
kernel (run rows), and the bindings read lands as a narrow consumer-side port
on `projectService` wired at the composition root over the OC client — the
house pattern. The `gitfs` local-head primitive lands in the engine beside
`ListTagsLocal`.

Test-first per repo practice: component-level tests on `feature/project` with
fake ports pinning the derivation table (§3) and edge matrix (D8, no-spec,
no-tag, no-build, mixed bindings), plus a dbtest for the migration + counts
round-trip.

## 7. Implementation record (built + reviewed 2026-07-11)

Built test-first in six phases — a validation pass, four implementation
phases each carrying its own tests, one review pass, then live
verification. Phase 0 validated six load-bearing assumptions (all held;
deltas folded into D1/D2/D5/§5/§6 above). The console needed **zero code
changes**: the generated TS types, `pipeline.ts`, `queries.ts`, and
`pipeline.test.ts` already consume the final contract shapes — #183 was
built against MSW fixtures, so shipping this server change IS the plug-in.

What each phase landed:

- **gitfs `HeadLocal`** — the fetch-free local-head primitive; tests pin
  no-fetch under origin-ahead via the exec-hook fetch counter, first-access
  clone, engine-write visibility, missing-repo error.
- **Counts write path** — count columns via gorm defaults (no `RunAll`
  step), execution-scoped `SetTaskCounts`, `DeleteByProject` purge; dbtests
  pin absolute-rewrite (never sum), re-Record survival, same-tag-rebuild
  isolation, newest-first/kind read, purge. The workflow tally is derived
  from `status.Tasks` (single seam) and pinned by Temporal-testsuite tests:
  plan-size first write, absolute monotone writes, terminal freeze, dep-skip
  counts as failed.
- **Stage assembly** — contract-mirroring models (verified
  property-identical to the contract via the openapigen artifact), the
  three-source concurrent read, component tests pinning the §3 table and
  edge matrix (per-source strict failures, zero-value stages, vanished-tag
  degrade, the deploy condition matrix, flat-field parity incl. blank
  design.md and design-without-spec gating).
- **Review pass** (xhigh: 10 finder angles → adversarial verify → sweep)
  fixed: `resolveCommit` error discrimination (missing-ref vs repo failure);
  blank-design.md flat parity; execution-scoped counts; bounded count-write
  retries; a pagination progress guard on the org binding list; the
  vanished-tag degrade + `DeleteProject` workflow_runs purge; helper reuse
  (`latestRequirementsTagInfo`/`latestDesignTag`); deletion of the dead
  `ListRequirements`/`ListRequirementFiles` surface; one shared
  `models.DevEnvironmentName` (previously four copies of "development").

Consciously NOT changed in review:

- No `workflow.GetVersion` gate on the new counts activity — every prior
  devflow workflow change shipped unversioned (dev runs are disposable
  pre-GA; an in-flight run across a deploy wedges and is terminated).
- `bindingFailureReasons` stays in `feature/project` per D5's grilled
  decision; the vocabulary is pinned to OC v1.1.1 — revisit if the client's
  spec pin moves.
- Full-tree `ls-tree` listings per poll (up to 3 on a versioned+deployed
  project) — bounded absolute cost today; a `specs/`-pathspec List variant
  is the ready optimization if poll cost ever shows in practice. Same for
  the duplicate repo-row/credential resolve inside the two artifact reads.

Live verification (fresh teardown→setup cluster, Playwright-driven console):
the full lifecycle rendered from the single poll — create (zero-valued
stages, "Generate spec" CTA) → spec+design generated → v1 published
(`spec {v1, clean, design:true}`) → build (`running · 0/1, active 1` →
`succeeded · 1/1`, tally frozen) → `deploy {v1, deployed, 1/1}`. Poll
cadence measured at 5.0–5.2s while building and steady 30.1s idle. Zero
console crashes, zero aep-api errors across the run.

## 8. Found during design — explicitly out of scope

Parked (file separately; none block this endpoint, and the counts design does
not paper over them):

1. Provision-class tasks are scheduled as coding children → funnel refuses →
   2h `SigPROpened` timeout → false `failed` + dependents `skipped-dep-failed`;
   provision fulfillment (issue close) never signals the child.
2. The dev workflow completes `Done` regardless of task outcomes
   (`devflowValidator` is a stub) — "succeeded · 0/3 done" is possible.
3. `RunPlan` reads back ALL open tasks (not tag-scoped) — stale open tasks are
   scheduled and counted into a run.
4. Provision issues carry no `aep:spec/<tag>` label — tag-scoped task lists
   exclude them, inconsistent with the all-open plan read-back.
5. No impl-complete tag: `v<N>` snapshots specs only, at build start; the
   platform should cut a second tag when a run finishes deployed (code-state
   provenance; would also harden D6).
6. Contract wording: `SpecStage.dirty` says "moved on GitHub" — under
   committed-truth the platform mirror is the truth for `specs/`.
7. Overview payload coherence: the flat `phase` derives from the git
   snapshot alone — a project whose `specs/` were emptied after a deploy
   reports phase "prompt" alongside true build/deploy history in the same
   payload. Each stage is per-source truth and the console renders them
   independently; accepted, not reconciled.
8. Deploy stage is caller-credential-scoped (found in live e2e): the BFF
   forwards the inbound user JWT to OpenChoreo, and OC silently
   RBAC-filters the releasebindings list — a caller whose token can't read
   bindings (e.g. the local-dev seeder client) gets a 200 with
   `deploy {none, 0/N}` while an authorized user sees `deployed N/N` at the
   same instant. Console users are unaffected; an S2S consumer of /status
   would be misled. Pre-existing property of every OC-backed BFF read (the
   component deployments endpoint behaves identically), not a #184
   regression.
