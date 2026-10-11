# ADR-0003: `code` derives the design's platform facts with aep-api's own Go derivation

**Status:** Accepted (2026-10-04)

## Context

Before POST /build cuts a version tag, aep-api runs a derivation over the design
and commits the result into each `design.json`:

- `exposesAPI.auth: end-user-required` on a service or AI agent that depends on a
  resource type with the `aep.wso2.com/role: end-user-auth` label;
- `wiring` on every dependency: `{ref, envBindings}` for a platform resource
  (from the resource type's declared outputs) or an external one (from its
  config keys), and `wiring.endpoint` for a sibling component.

The coding agent copies that wiring into `workload.yaml`. The `aep` skill
(`references/workload-and-wiring.md`) calls a platform resource without wiring
broken input and stops the run.

The playground never builds, so it never ran this step. Every playground-designed
project gave the coding agent a design that production never sends. The evals
showed the result: the `evals/codegen` sweep of 2026-10-03 hard-failed
`onboarding-tracker` because the agent omitted the `thunder-app` binding.

## Decision

**`play <dir> code` runs the same Go code, not a port of it.** Directly after the
mandatory undo snapshot and before the coding agent starts, the playground spawns
`go run ./cmd/design-derive` in `services/aep-api`
(`engine/design-derive.ts`). The project id is `projectSlug(projectDir)`, the name
the playground already uses for the project.

The CLI is a thin shell over production code. Only the transport is different:

| step | production (POST /build) | `cmd/design-derive` |
|---|---|---|
| read the design | `ArtifactStore.AssembleDesignFrom` over the files at HEAD | the same function, over the files in `specs/design/` |
| resource types | `ListClusterResourceTypes` from the OC API | `openchoreo.ResourceTypeDir`, which decodes `deployments/single-cluster/resource-types/*/resourcetype.yaml` into the same struct |
| catalog projection | `dependencies.ResourceTypeCatalog` → `crtcatalog` | the same two |
| derivation | `spec.DerivePlatformResourceFacts` | the same function |
| output | the changed files, committed with CAS | the same changed files, written to disk |

`spec.DerivePlatformResourceFacts` is the seam. It checks resource-type
membership, derives auth and wiring in production's order, and returns only the
files whose derived state changed, rendered by `SplitDesign`. Production's
`persistPlatformResourceDerivation` commits that list, and the CLI writes it.
Thus a second run changes nothing, and the files have the same bytes that
production commits. `cmd/design-derive`'s oracle test checks this against two
`design.json` files taken from a project on the platform.

**A refusal refuses the run.** An unknown resource type or an auth conflict exits
1 with production's error text, and `code` stops with that message, as a
production build does. If `go` is not on the PATH, or the derivation fails for
another reason, `code` also stops. Running the agent on a design that was not
derived is the defect that this step removes.

## Consequences

- `code` needs Go on the PATH. `go run` caches the binary, so a rerun costs
  under a second. The first run compiles a small part of aep-api.
- The undo snapshot is taken before the derivation. Thus `--restore` returns the
  design as the engineer left it, and the next run derives it again.
- `wire` finds `wiring.ref` on each platform resource, which `plan.ts`
  `bindingsOf` already uses first to join a dependency to its `workload.yaml`
  entry.
- The catalog is the repo's local one. A cluster whose platform engineer
  installed other resource types derives differently. A design that names a type
  the repo does not have is refused here, as the local cluster would refuse it.
- The derivation does not add skills to `skillsPinned` from the
  `aep.wso2.com/skill` annotation, because production does not do it either.
  `dependencies/markers.go` says that design save does it, but no code does. The
  design agent writes `skillsPinned` itself.
- Steps after the tag are not part of this ADR: provisioning, the org-service
  endpoint channel that is resolved at dispatch, and the platform comments.

## Amendment (2026-10-11): `tasks` selects and renders with aep-api's code

The same rule covers planning. A version is one build issue (root ADR-0050),
and its selection and its body are production code:

- `play <dir> tasks [--features F1,F3] [--product-wide P1]` spawns
  `go run ./cmd/build-plan scope` (`engine/build-plan.ts`). It runs POST
  /build's selection (`reqspec.PlanBuild`) over `specs/requirements/` and the
  earlier versions, then the same hard gate (`spec.GatedSelection`) over the
  requirements, design and acceptance files. It refuses as production does,
  and returns the plan turn's scope.
- The playground then runs the Plan turn on the design agent's Turn socket and
  keeps its last ok `planBuild`, as aep-api's plan tap does.
- `cmd/build-plan issue` renders the issue with `taskplan.BuildIssue`, so
  `issues/<n>.md` (frontmatter, then the body) holds the bytes the plan
  service would mint.
- No tag records what a version built, so `tasks` records each version in
  `.aep-playground/project.json` (`versions`). A later `--features` reads it as
  production reads the earlier tags' annotations. A new `tasks` waits until
  the earlier build issue's items are all ticked.
