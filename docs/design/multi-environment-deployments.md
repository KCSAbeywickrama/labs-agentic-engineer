# Multi-Environment Deployments — Design

**Status:** approved design, not yet implemented
**Date:** 2026-09-17
**Supersedes in part:** ADR-0027 (Deployments is an environment board), ADR-0032 (the Development card is the flow)
**Decision record to write during implementation:** ADR-0033, amending ADR-0032

---

## 1. Why

The Deployments page assumes exactly two environments. `ENVIRONMENTS = ["development","production"]`
is a literal in [`deploymentLedger.ts`](../../apps/console/src/features/projects/lib/deploymentLedger.ts),
`environmentLabel` is a ternary over those two words, and roughly thirty console files
spell one or both of them. A platform whose pipeline is Dev → Staging → UAT → Production
cannot be shown at all.

The platform has never had that limit. A project references an OpenChoreo
`DeploymentPipeline`, whose `promotionPaths` are an ordered graph of environments, and the
BFF already walks them in promotion order — `PipelineEnvironments` in
[`project_cell_client.go`](../../services/aep-api/internal/clients/openchoreo/project_cell_client.go),
used by `project_service.go` to seed one `ProjectReleaseBinding` per environment. The
console is the only layer that hardcodes the pair.

Three further asks came with the rework:

1. The single bottom ledger of every version leaves the board and becomes a **Past
   deployments** section on each environment's own page — because rollback is
   per-environment, and OpenChoreo keeps the built release that a rollback would re-pin.
2. The environment cards become a **horizontal, left-to-right flow**, so the page shows
   how deployment actually moves.
3. An org-level **Deployment Environments** settings tab.

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **OpenChoreo owns environment membership and order.** `DeploymentPipeline.promotionPaths` is the single source of truth; the console reads it and never invents an order. | One truth. A promote the console believes is legal is a promote the platform has a path for. |
| D2 | **Per-environment console config lives as annotations on the OC `Environment` object.** `openchoreo.dev/display-name` for the label (existing convention) and `aep.wso2.com/validation: "on" \| "off"` for whether the validation step runs there. | No new table, one object to read, and the config cannot outlive the environment it describes. |
| D3 | **This project is a console redesign.** The only platform write it makes is the validation annotation (D2). Promote stays unwired, exactly as today. Rollback is drawn and disabled. | The `ProjectReleaseBinding.spec.projectRelease` pin is platform-touching work with its own unanswered questions (§10). |
| D4 | **Per-environment history shows only what exists.** Development lists the build ledger — genuinely every version that passed through it. Every other environment shows the version running now and a line saying no earlier history is recorded. | The platform records no deployment history (§4.3). Inventing rows would be a lie the page cannot back. |
| D5 | **The per-version page is retired.** `/deployments/$env/$version` and `DeploymentVersionPage` are deleted; a past version is a row in Past deployments. | A superseded version's story is four facts, not a page. The row carries them, plus the (disabled) Roll back. |
| D6 | **The settings tab reads the pipeline and toggles validation. Nothing else.** It lists the environments in promotion order and switches `aep.wso2.com/validation` per environment. It does **not** create environments, edit them, or reorder them — those controls are not built, not drawn, and not disabled-with-a-tooltip. | Decided on a call, 2026-09-17, superseding an earlier design that drew all three as disabled affordances. A control that can never work is worse than no control: it invites the question every time it is seen. The feasibility research behind the removed controls is kept in §8 so nobody re-litigates it. |
| D7 | **"Connections" is renamed "dependencies"** everywhere in this surface. | One word for one concept; the design and the BFF already say dependency. |

## 3. The environment model

### 3.1 Where each fact lives

| Fact | Home | Read via |
|---|---|---|
| Which environments exist, in what order | `DeploymentPipeline.spec.promotionPaths` | `PipelineEnvironments` (exists) |
| Identity (`metadata.name`) | `Environment` object — **immutable** | `GetEnvironment` |
| Display name | `openchoreo.dev/display-name` annotation | same |
| Is production | `Environment.spec.isProduction` | same |
| Runs validation | `aep.wso2.com/validation` annotation — **new, ours** | same |
| What runs there now | `ProjectReleaseBinding` + component `Deployment` rows | existing deployment reads |

Nothing about an environment lives anywhere but the environment. There is no console-side
table, and therefore nothing to reconcile.

### 3.2 The step model

An environment card's steps are a **consequence**, never a stored number:

```
steps(env) = [ Deployment ]
           + [ Validation ]          if annotation aep.wso2.com/validation == "on"
           + [ Promote to <next> ]   if env is not last in promotion order
```

Three steps for a validating, non-final environment; two when either is false. Production
with validation off shows two. Nobody ever types "3". Turning Staging's switch on adds a
step to its settings card *and* its deployments card from the same annotation.

### 3.3 Promotion direction

Promotion is left to right along `promotionPaths`, always. The promote step names its
target — *Promote v4 to Staging* — and the last environment has no promote step, replaced
by the line *Last environment in the pipeline — nothing to promote to.*

Fan-out (one source, several targets) exists in the CR and is **not** supported by this
design: the console renders the de-duplicated linear order `PipelineEnvironments` already
returns. A fan-out pipeline will render as a line. Recorded as a known limitation (§10).

## 4. Contract and BFF changes

All reads except the validation toggle.

### 4.1 Environment list — extend `EnvironmentDTO`

`ListOrgEnvironments` today returns `[{name}]` only
([`handlers.go`](../../services/aep-api/internal/dependencies/provisioning/handlers.go)).
It grows to carry what the surfaces need:

```jsonc
{
  "name": "staging",              // identity, immutable
  "displayName": "Staging",       // openchoreo.dev/display-name, falls back to a titlecased name
  "isProduction": false,
  "validation": "on" | "off",     // aep.wso2.com/validation, default "off" when absent
  "position": 1,                  // 0-based index in promotion order
  "promotesTo": "uat"             // next environment, omitted on the last
}
```

Order is the array order; `position` and `promotesTo` are conveniences so the console never
re-derives the flow.

**Default for a missing annotation:** `validation: "off"`. An environment nobody has
configured does not silently start running validation. Development's seed sets it `"on"`
so existing behaviour is preserved on upgrade.

### 4.2 Per-environment version — a real gap

`DeployStage.version` is documented as *"Spec tag live in dev"*. It answers for development
only, which is why `environmentRows` attaches a version to the development row and to no
other. The new card shows **Version: xxx** prominently on every environment, so the gap has
to close.

**Chosen fix:** the BFF resolves the version for each environment from that environment's
`ProjectReleaseBinding` pin and returns it on the component `Deployment` DTO as `version`.

**Fallback, if the pin cannot be resolved:** parse it from `releaseName`, which is
`<component>-<version>-<sha>` (`claims-api-v1-4e8a0d6`). This is explicitly a fallback —
it is string-shaped and will break if the release naming changes — and a card whose version
cannot be determined says *Version unknown*, never a guess.

### 4.3 What the platform does not record

There is no deployment history anywhere in the contract. `Deployment` is the current binding
— `componentName`, `environment`, `releaseName`, `createdAt`, `status` — and nothing else.
This is the whole basis of D4. Past deployments is therefore:

- **Development:** the build ledger, as today — every version built, newest first.
- **Every other environment:** one row for what runs now, then
  *No earlier deployments are recorded for this environment.*

### 4.4 The one write

`PUT` the validation annotation via `UpdateEnvironment`. A new BFF endpoint
`set-environment-validation` takes `{environment, validation}`, reads the Environment,
sets `aep.wso2.com/validation`, and writes it back. Read-modify-write on annotations only —
it must never touch `spec`, and must fail loudly rather than blanking a field it did not
understand.

## 5. The Deployments page

A horizontal, scrollable row of **full-detail** environment cards, one per environment in
promotion order, with `→` between them. The bottom ledger is removed entirely.

**Card anatomy**

- **Header:** display name at full weight, the word *Environment* small and grey beside it.
- **Step 1 — Deployment.** Status chip and stamp; then a highlighted block with
  **Version vN · Milestone #N** (linking to GitHub) and built-at/commit; then the
  Components list and the Dependencies list; then **Try it out**.
- **Step 2 — Validation** (only when the annotation says so). The verdict detail exactly as
  it reads today — counts, *View validations*, and the "no verdict — run validation again"
  line for cancelled.
- **Step 3 — Promote to `<next>`** (only when not last). Button labelled
  *Promote vN to `<Next>`*.

**Layout rules**

- All cards stretch to the tallest card's height; component and dependency lists are the
  variable part, so the tallest environment sets the row.
- The trailing step is pinned to the card's bottom, so every promote row lines up across the
  pipeline and the slack falls in the middle.
- **One primary action per card** — the furthest-along thing that is actually possible.
  Promote takes primary the moment it is legal; until then Try it out holds it. A deployed
  final environment keeps Try it out as primary, having no promote step.
- **The whole card is a click target** for the environment page. Because a card contains
  buttons it cannot be an `<a>` wrapper: it is a click handler on the card, a real link on
  the environment name for keyboard and middle-click, and `stopPropagation` on the inner
  buttons.

**A failed deployment** reads on step 1, and names the cause when the cause is a dependency
missing values on that environment — the state that exists today, now per-environment.

## 6. The environment page

Route: `/projects/$projectName/deployments/$environment`. The bare environment URL no longer
redirects to `try-out`; it *is* the page. Four sections, in this order:

1. **Deployment** — version, milestone (GitHub link), commit, validation verdict, built and
   deployed stamps, live count.
2. **Try it out** — the existing panels, web applications first, then services.
3. **Dependencies** — the existing table, renamed, with Edit where values are collected.
4. **Past deployments** — version, milestone, validation, deployed, until. The live row is
   marked *Running now*. Every other row carries a **Roll back** button, **disabled**, with a
   stated reason.

Section 4 is where D4's honesty lives: on a non-development environment the table holds the
current row and the no-history line.

## 7. Settings › Deployment Environments

A horizontal strip of small cards in promotion order, `→` between them. Read-only,
with one control.

Each card: the display name with *Environment* faded beside it, `First · 3 steps` /
`Second · 2 steps` …, the steps themselves (a disabled validation step struck
through), the **Run validation here** switch, and a *Production* flag read from
`isProduction`.

**The only control is the validation switch.** There is no drag grip, no edit pencil,
and no **+ Add environment** card. An environment is created, renamed and reordered
by a platform admin against OpenChoreo directly; the console reads that and says so
in a banner naming the pipeline it read.

The step count remains a consequence, never a setting (§3.2): turning a switch on
adds a step to that environment's settings card *and* its deployments card, from the
same annotation.

## 8. Feasibility of the controls we deliberately do not build

### 8.1 Verified against the generated OpenChoreo client

Kept because the research is real and settled. None of the first three are built
(D6); this table exists so nobody re-opens the question of whether they *could* be.

| Control | API | Verdict |
|---|---|---|
| Add environment | `CreateEnvironment(ns, body)` | Feasible. Spec is optional — `dataPlaneRef` defaults to a DataPlane named `default`. Add is really two writes: create the Environment, then weave it into `promotionPaths`. |
| Reorder (**Save order**) | `UpdateDeploymentPipeline(ns, name, body)` | Feasible. Rewrites `promotionPaths` beneath projects already bound and running. The drag itself ships; only the save is deferred. |
| Edit display name | `UpdateEnvironment(ns, name, body)` | Feasible **for the annotation only**. |
| Run validation here | `UpdateEnvironment(ns, name, body)` | Feasible, and enabled. |

### 8.2 Why rename is display-name only

`metadata.name` is the environment's identity: every `ProjectReleaseBinding`, every cell
namespace, and every running workload references it, and Kubernetes does not rename objects.
A true rename is delete-and-recreate, which orphans all of it. The control therefore says
**display name** and never **name**. Anything else would be a button that cannot do what its
label promises.

## 9. What is deleted, renamed, changed

**Deleted**

- `DeploymentVersionPage.tsx` and its test (D5).
- Route `projects.$projectName.deployments.$environment.$version.tsx`.
- Route `projects.$projectName.deployments.$environment.try-out.tsx` — its page moves to
  `$environment.index`, which stops being a redirect and becomes the environment page.
- `DeploymentsLedger.tsx` as a page-level component — its table logic moves into the
  environment page's Past deployments section.

**Changed**

- `ENVIRONMENTS` / `EnvironmentKey`: the union becomes a plain `string` identity with the
  environment list fetched. Every `environment === "development"` branch has to be re-read —
  some are genuinely "is this the first environment", some "does this environment collect
  values", some "does the aggregate speak for it". They are not the same question and must
  not be replaced by one helper.
- `parseEnvironment`: cannot validate synchronously against a fetched list. The route accepts
  any segment and the page renders *No environment called `x`* once the list has answered —
  the same dead-end-with-a-way-out pattern the version page used.
- `environmentLabel`: reads `displayName` from the fetched environment.
- `environmentRows`: one row per environment in the list, not a hardcoded two.
- `DeploymentTryOutPage` becomes the environment page (§6) served at `$environment.index`,
  gaining sections 1 and 4.
- `PromoteDialog`: target environment becomes a parameter; copy names it.

**Renamed** — connections → dependencies, in copy, component names and test names.

## 10. Known limits and deferred work

- **Promote is still unwired.** The dialog collects values and shows the same honest snackbar
  it does today. Unchanged by this project.
- **Rollback is drawn, disabled.** The write is one `ProjectReleaseBinding.spec.projectRelease`
  move. What the follow-up must answer before it ships: what a half-repinned project looks
  like mid-flight; what happens to per-environment dependency values on a rollback; whether
  rolling back an environment that a later one already promoted off is legal.
- **Add, reorder and rename are not built at all** (D6) — not as controls, not as
  disabled controls. They are feasible (§8.1); what is deferred is the risk of writing
  shared platform objects, and the judgement that a console is the right place to do it.
  Until then these are platform-admin operations against OpenChoreo directly.
- **`moveEnvironment` in `lib/environments.ts` is now unused.** It was built and tested
  in plan 1 to serve the drag-to-reorder D6 removed. It is correct and covered, and
  `apps/*` is outside knip's scope so nothing fails because of it. Left in place for the
  whole-branch review to triage — delete it, or keep it against the day reordering
  is on the table.
- **Fan-out pipelines render linearly** (§3.3).
- **History starts empty** for every environment but development, and stays empty until
  promote records something.
- **Sibling cascade:** the deployed-task cascade re-emits `cors.allowedOrigins` and
  `env-config.js` per environment. With N environments this runs per environment; it is
  believed to already be environment-scoped, and **must be verified during implementation**
  rather than assumed.

## 11. Testing

Per `docs/design/testing.md` and the repo's TDD practice.

- **Unit (vitest):** the step model — three steps when validating and not last, two otherwise,
  none beyond the last; promote target naming; equal-height and bottom-pinned trailing step;
  primary/secondary demotion across all validation verdicts; `validation` annotation absent →
  `off`; version unknown → *Version unknown*, never a guess.
- **Page tests:** N-environment rendering at 1, 2 and 4 environments; card click reaching the
  environment page and inner buttons not triggering it; Past deployments showing real rows on
  development and the no-history line elsewhere; every disabled control carrying its tooltip.
- **Settings:** the switch writing; add and rename remaining inert; and the reorder —
  `move(list, from, to)` as a pure function, then the strip's derived consequences after a
  drop (arrow order, position labels, each card's promote target, the "no promote step"
  moving with the last position), the unsaved line appearing only when the order differs,
  Undo restoring the platform order, and Save staying disabled.
- **E2E (Playwright):** against the local cluster's real pipeline, which is
  development + production — so the N > 2 cases are covered by unit and page tests until a
  multi-environment pipeline exists locally.
- **API integration (vitest):** the extended `EnvironmentDTO`, and the annotation
  read-modify-write leaving `spec` untouched.

## 12. Open question for implementation

Whether `position` and `promotesTo` belong on the DTO or are derived in the console from array
order. The DTO is proposed (§4.1) so the flow is stated once, by the layer that read the
pipeline. If the BFF work argues otherwise, deriving from order is acceptable — the console
must not, in either case, re-derive the *order itself* from anything but the list it was given.
