# ADR-0029 — Validation drives scenarios, it does not compile tests

**Status:** Accepted, **on the `vld-redesign` branch only** · **Replaces, on this branch,**
[ADR-0010](../../runners/remote-worker/design/decisions/ADR-0010-a-validation-report-is-an-accumulation.md)
(the report's shape) and the Playwright half of
[ADR-0012](ADR-0012-one-debian-runner-image-for-both-task-kinds.md) (what the image carries a browser
for). The ADRs that describe the compiled path are left standing rather than rewritten: they record
what main still does, and this branch is an experiment that may be reverted whole.

## Context

The incumbent validation phase compiles each `method: e2e` criterion from
`specs/validation/validation-criteria.json` into a committed Playwright spec at
`tests/e2e/specs/<AC-ID>.spec.ts`, runs the suite, heals what fails, and reports. That seam — a plan
row joined to a spec file by an id — is the thing this branch removes.

A playground experiment measured the alternative on one app, four ways (two oracles × two execution
methods). Two results shaped this decision. The **oracle**, not the execution method, was what moved
the verdicts: the same app judged against Gherkin scenarios and against the JSON criteria disagreed,
while the same oracle executed two different ways agreed. And the agent path was about **40% cheaper
on a first run** (9.6 min / 78k tokens against 16.4 / 129k) and roughly **4.5× more expensive by run
eight**, because a compiled suite is authored once and replayed while an agent re-derives its path
every time.

## Decision

On this branch, a validation run **drives the scenario text directly**. There is no generated test
code and no plan↔code seam, because the scenario IS the test.

- The oracle is `specs/acceptance/<slug>.feature` — Gherkin, authored from the PRD alone by the
  `acceptance-criteria` skill.
- The runner loads `acceptance-run` (always-on) and `agent-browser` (on demand) where it used to load
  `aep-validation` and `playwright-cli`.
- The report is `tests/acceptance/report.json`, keyed by scenario rather than by criterion id.
- `specs/validation/validation-criteria.json` is **still generated**, and deliberately unexecuted. It
  is the comparison's other arm; deleting either oracle by hand isolates one path.

### Four outcomes, not five

The report answers `passed` / `failed` / `blocked` / `unjudgeable` per scenario. The platform's six
run verdicts are unchanged; only their inputs are.

`blocked` is the one that earns its place. It says the agent could not carry out the `When` — the
control was `[disabled]` or absent — and it is NOT merged with `failed`, because the two are opposite
claims: one says the behaviour is wrong, the other says the behaviour was never reached. A compiled
suite cannot report this at all; a timed-out locator looks like a failure.

**`blocked` files no repair issue.** It lands on `partial`, and stops there. The agent cannot tell an
app that correctly refuses an action (a bought item has no edit control *because* bought items cannot
be edited) from one too broken to perform it. Auto-filing would send a coding run to add an affordance
the requirement never asked for — a repair loop that makes the product worse, confidently. A person
tells the two apart in seconds; the run reports and leaves it to them.

### Evidence, not assertion

A pass is only worth the thing that could have said no. Every `Then` records the command that settled
it and that command's exit code, and `observed` is **required wherever the exit code is not the
verdict**: a nonzero exit, a step with no command at all, or a value-returning command like
`get count`, which exits 0 because the command *ran* while the agent did the judging.

This is the single most important property of the approach and the one most easily lost. It is
checked by a script the run invokes — deliberately not yet by the platform, which is an open question
this branch does not close.

### Isolation is functional, not a reset

The app under test is deployed and keeps its data: there is no process to restart and no database to
truncate. Scenarios isolate by **creating the thing they assert about** — a round, a board, a list —
so "the list is empty" is true by construction. Where a product has no such container, a scenario
asserts on the *change* instead of the total.

This is Meszaros's Database Partitioning Scheme and Farley's functional isolation; the fallback is his
Delta Assertion. The incumbent has **no isolation guidance at all**, so this is a gap the new path
names rather than one it introduces.

## Consequences

- **The console renders the report raw.** The acceptance run answers per scenario and the criteria are
  a different decomposition of the same requirement, so there is no id to join them on. A shaped view
  is real design work, and the right time for it is after reading a real report. Passing the report
  through the criteria-joining path would render `Not validated` on every row — a verdict, where the
  truth is that the report does not speak about criteria.
- **Real-time progress is dark.** The matchers that drove it keyed on Playwright file writes and spec
  names, so against an agent driving a browser they matched nothing. Deleted rather than rewritten;
  the redesign is its own piece of work.
- **The image keeps `@playwright/test`.** Not as a test runner — nothing runs `playwright test` any
  more — but as the delivery mechanism for the chromium `agent-browser` launches. The second chromium
  that `playwright-cli` pinned is gone.
- **The phase is still called Validation.** Validation is the objective, acceptance testing the
  activity that serves it, and an acceptance criterion the unit it grades — different axes, all three
  correct at once (`docs/glossary.md`). Nothing user-facing is renamed.
