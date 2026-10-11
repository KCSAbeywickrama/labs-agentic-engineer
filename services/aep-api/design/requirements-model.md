# The requirements model in aep-api

How aep-api reads per-feature requirements and builds and validates by
feature. Decisions: ADR-0039, ADR-0040, ADR-0041, ADR-0050. Terms:
`CONTEXT.md` § Requirements model, `docs/glossary.md` § Build issue.

## Reading the requirements — `internal/platform/reqspec`

- `Parse(files)` → `Spec`: features (stories, needs, assumed count, blocking
  questions, retired IDs), product-wide items, retired features and P items,
  and the problems the save gate reports (`Problems()`).
- `Basis(files, F)` — what a feature's design reads. `FeatureLines(files, F)` —
  a feature's lines as a build keeps them. `PlanBuild(spec, built, pick,
  unavailable)` — what a selection carries and what it refuses.
- Held to `packages/contracts/requirements/acme-expenses` (`expected.json`,
  `feature-lines.json`, `basis.json`), which the console's reader shares.
- Every line reads as the console reads it from the collab room, where inline
  markup is a mark and not text (`inline.go`): code spans, emphasis, strong,
  strikethrough, links and autolinks read as their words, escapes and
  entities as their characters. A closing `*assumed*`/`*blocking*` is kept for
  `parseLine`. The room's parser (`marked`, via @tiptap/markdown) is the
  reference, not the CommonMark spec: the console has no markdown source to
  re-derive markup from, and the basis is compared by string equality. Both
  sides are held to `packages/contracts/requirements/inline-markup-cases.json`.
- The reader is linear in a line's length (one pairing pass for brackets,
  parentheses and code spans; emphasis paired with CommonMark's
  `openers_bottom`): files are user-written and every basis reads them all.

## The save gate — `internal/spec`

`SaveSpec` (the build click's tag cut) reads requirements, design and
acceptance at one commit and refuses the tag on: requirement ID problems;
designs or roles citing a feature instead of its stories, or stale stories; an
acceptance file missing a carried story's tag; a feature out of date
(`staleFeatures`: its basis now vs at its last design run, from
`CompletedFlows`); a pick it cannot carry (`build_selection.go`). A design
run's scope is the feature IDs its ledger row's `Summary` holds ("F1 F2",
from the pod's `designFeatures`; empty = every designable feature), read by
`DesignedFeatures`; `Summary` holds nothing else for a design turn. The tag's
annotation records the plan (`scopeBody` / `parseScope`).

- `BuildScopeAtTag` — what a version carries: its features with the carried
  features each needs, its P items and its held-back stories (the plan
  turn's scope). `BuildScope.Issue` joins it with the planner's checklist into
  the build issue.
- `ListVersions` (`GET /versions`) — what each version built, with each
  feature's lines at its tag.
- `ValidationScope` — what a version validates (built so far, minus held back)
  and the versions before it.
- `TagRepair` — a repair version `<of>.<n>` at the fixed version's commit.
- `SpecState` (`GET /spec/state`) — each designed feature's basis at design
  time, and the attached documents.

## Building — `internal/delivery/build`, `delivery/task`

`build.Service.Run` carries the pick into the tag; `dependencyGate` blocks the
features an open external dependency's component serves. The build gate
(`spec/build_gate.go`) asks a service for `openapi.yaml`. It does not require
a web application's prototype; one that is present must be both files, pass
the save gate's prototype rules, and offer only roles `security.json`
declares. The click also derives the provision payload from the design
(`InputsCoordinator.BuildProvisionInputs`): one approved input per platform
resource not yet provisioned or in flight.

The plan turn reads `tags/<version>` and writes the version's checklist with
`planBuild` (ADR-0050):

- `task/plan.go` sends the scope (`planScopeFor`) and starts the Plan turn in
  the org's AE Studio pod. `plan_tap.go` keeps the last ok `op: build`
  `task-op`. Once the turn completes, `mintBuildIssue` mints one issue: title
  `Build <version>`, labels `aep` and `development`, the milestone, dedupe key
  `build:<project>:<milestone>`. A completed turn without a plan fails
  (`errNoBuildPlan`); a failed turn mints nothing.
- `platform/taskplan/build_issue.go` renders the body: the version line, one
  `` - [ ] **<item>** <name>: `<components>`. <note> `` line per item, then
  `Product-wide:` and `Held back:`. `UncheckedItems` counts the lines the
  coding agent has not ticked.
- The run's poll (`run/activities.go` `openBuildItems`) reads the open build
  issue's body only when the counts show open `development` work. The
  no-progress rule compares the working set plus those items
  (`progressUnits`), so a cycle that ticks an item has progressed.
- The merge policy (`eventcore/policy.go`) admits `Advances #N` on the
  milestone's build issue beside `Resolves` and `Validates`, so a cycle that
  finished some items lands them and leaves the issue open. The poll and the
  policy name the build issue with one predicate, `delivery.IsBuildIssue`
  (its dedupe label).
- `cmd/build-plan` runs the selection (`scope`) and the render (`issue`) for
  the playground, with this code.

`Repair` files the fixed version's final failures into the repair milestone
and starts the run without planning.

## Validating — `internal/delivery/validation`, `app/run_adapters.go`

`runValidation.judge` reads one attempt's report within the version's scope
(`Scope`, story tags read from the acceptance files at the same commit) and
against the previous validated version's final attempt (`Baseline`). The
verdict, digest and regression count come from it; repair issues are filed by
standing (regression / still failing / plain). Office uploads are converted
to markdown by `internal/platform/officetext` while the references upload
streams them to the pod (`spec/files/references.go`).
