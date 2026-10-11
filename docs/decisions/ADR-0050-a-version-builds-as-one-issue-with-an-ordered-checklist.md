# ADR-0050 — A version builds as one issue with an ordered checklist

**Status:** Accepted · 2026-10-11
**Replaces:** [ADR-0041](ADR-0041-a-build-is-a-selection-of-features.md)
decision 4 (Tasks per feature per component). Every other decision of ADR-0041
stands.
**Related:** [ADR-0011](ADR-0011-milestone-is-the-unit-of-execution.md),
[ADR-0025](ADR-0025-a-web-application-is-verified-before-it-is-committed.md),
[ADR-0042](ADR-0042-a-prototype-is-react-on-a-fixed-kit-in-a-sandbox.md)

## Context

ADR-0041 cut a build into one Task per feature per component, plus a
foundation Task per component, linked in dependency order. Run
`asdlc-repos/hello-world-webapp436512` (2026-10-10) showed the cost. Two
features on two components became four issues (#2 to #5). The planner wrote
the story-to-flow mapping and the "Depends on" links into each issue body, and
it inferred them again on every plan. The coding agent then read four bodies
that restated the specs, and worked a feature in two halves, one per issue.

The unit a user picks, reviews and validates is the feature (ADR-0039,
ADR-0041). The unit the issues cut was the component.

## Decision

1. **One build issue per version.** The plan mints one `development` issue,
   title `Build <version>`, labels `aep` and `development`, in the version's
   milestone. Its body is an ordered checklist of items. Gate (`provision`),
   `validation`, `bug` and `conflict` issues stay separate.
2. **The body is thin.** It holds the facts the platform owns and one line per
   item: the version and its tag, the items, then `Product-wide:` and
   `Held back:` when the version has them (`taskplan.BuildIssue`). An item line
   is `` - [ ] **<item>** <name>: `<components>`. <note> ``. The body holds no
   scope, acceptance, screens, flows or references: the coding agent reads
   those from the specs.
3. **A light plan turn writes the checklist.** The design agent's plan turn has
   one tool, `planBuild({ items: [{ item, components, note }] })`. An item is
   `foundation`, a carried feature (`F2`), or `spec` when the version carries
   no features. The plan scope is the features with the features each needs,
   the product-wide items and the held-back stories. It carries no list of the
   carried stories and no coverage. The accumulator refuses an unknown component, an item the
   version does not carry, a carried feature left out, an item twice, and an
   item out of order (Foundation after a feature, a feature before one it
   needs). Foundation is optional: a later version that adds features to
   existing components needs none. A later ok call replaces the earlier one.
   aep-api's plan tap keeps the last ok `planBuild` and mints the issue only
   when the turn completes; a completed turn with none fails the plan.
4. **The lead coding agent decomposes.** It reads the specs at the tag (the
   feature file, the acceptance file, each component's `design.json` and
   `openapi.yaml`, `security.json`, and the prototype of each web application)
   and maps the item's stories to screens itself. The prototype manifest
   carries no story ids.
5. **Items in sequence, components in parallel.** The lead works `bug` and
   `conflict` issues first, then the build issue's items from the top. Per
   item it dispatches one build subagent per component the item names, in one
   wave, against the agreed `openapi.yaml`. A wave builds its own item and
   nothing of a later one. For each web application the item changed, the lead
   then dispatches a mock walk of the prototype flows of the item and of
   earlier items, since regressions land in shared chrome (ADR-0025). Then it
   commits, pushes and ticks the item's line.
6. **One PR per cycle, one commit per item.** A commit message ends
   `(#<issue> <item>)`, for example `(#10 foundation)` or `(#10 F1)`. A
   restarted cycle on the same branch skips the items whose commit is there.
7. **A partial cycle ships what is done.** The PR carries `Resolves #N` for the
   build issue only when every item is ticked. Otherwise it carries
   `Advances #N`: the merge policy admits it, GitHub does not close the issue,
   and the next cycle works the unticked items. The run's no-progress rule
   counts the unticked items (`OpenBuildItems`), so a cycle that ticks one item
   and leaves the issue open has progressed.

## Consequences

- **The merge policy admits three references** (`eventcore/policy.go`): a
  closing keyword on an armed issue, `Validates #N` on the validation task, and
  `Advances #N` on the milestone's `development`-kind issue. `Advances` is
  scoped to that kind for the same reason `Validates` is scoped to its kind.
- **No-progress compares progress units** (`run/policy.go`): the working set
  plus the open build items. The poll reads the build issue's body only when
  the counts show open `development` work. The new snapshot field decodes to
  zero from older history, so a run in flight across the upgrade keeps the old
  rule.
- **Dedupe key `build:<project>:<milestone>`** (`DedupeKeyBuildIssue`). A crash
  re-run of the plan finds the open issue. The key matches open issues only, so
  a same-tag rebuild does not plan: the milestone already holds a `development`
  issue, and `reopenIncrement` reopens it with its ticks.
- **Gone with the per-component cut:** per-task dedupe by title, the
  dependency links (`linksFor`), the Serves-stories stamp, the task context
  file, and the existing-Tasks section of the plan prompt.
- **The playground has parity.** `play <dir> tasks --features F1,F3` selects
  and renders through aep-api's own code (`cmd/build-plan`) and writes
  `issues/<n>.md`. The local `aep` overlay ticks that file, and a later run
  resumes at the first unticked item (playground ADR-0001, ADR-0003, as
  amended).
- **The console's stage strip reads the lead's task list.** The Build card's
  middle chips come from the lead's task list (`work_item` events). Leads often
  keep none, so the strip can show Plan for a whole run.
- **Known gap: the shell screens.** No item owns Account and Settings, and
  Foundation builds no feature, so a run can leave them as placeholders.
- A feature that touches two web applications is one item with one subagent
  per web application.

## Alternatives considered

**Keep one issue per feature per component** (ADR-0041 decision 4). Rejected:
it is the cut the context describes. A feature is split across issues, the
order is a set of links the planner infers each time, and each body restates
the specs.

**One issue per feature.** It keeps the feature as the unit, but the order is
still links between issues, a partial cycle needs one PR reference per issue,
and the resume key is spread over N issues. One checklist holds the order in
one place, and the commit trailer is the resume key.

**Features in parallel.** Rejected for now: features share code (the
Foundation, a shared screen, a shared operation), and parallel waves on one
branch would edit the same files. The sequence is revisited if wide builds are
slow.
