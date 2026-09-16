# Design notes — `@aep/ui-acceptance-view`

This package renders `specs/acceptance/*.feature` — the Gherkin acceptance
criteria — optionally joined against a run's `tests/acceptance/report.json`. Two
consumers, one component:

| Consumer | What it passes | What the reader is doing there |
|---|---|---|
| Spec view's file pane (`SpecView.tsx`) | `features` (one file) | Reading the document, before any run exists |
| Validations page (`ValidationPage.tsx`) | `features` (all of them), `report`, `awaitingReport` | Reading run results |

ADR-0029 shipped the Gherkin path and deferred this deliberately — *"the console
renders the report raw … a shaped view is real design work, and the right time
for it is after reading a real report."* This is that work, designed against the
p55/p56 reports and the `shopping-list` playground pair.

## One tree, two sources

The feature file and the report describe the same thing:

```text
Feature: Bought items
└─ Rule: A bought item is locked from further edits      @story-6
   ├─ Scenario: Marking an item bought                    → Passed
   └─ Scenario: Editing a bought item is refused ⊖        → Blocked
      ├─ Given the list has a bought item named "Eggs"
      ├─ When Dev tries to change the quantity            ← the blocking reason
      └─ Then the quantity is still "1"                   (not reached)
```

The feature file supplies the **structure** — features, rules, scenarios, steps,
tags, line numbers. The report supplies, per scenario, an **outcome**, and per
step the **evidence**: `command`, `exit`, `observed`. So this is one renderer
with an optional prop, not two components.

**The features are the spine, not the report**, and that is the load-bearing
choice. Rendering from the report alone would be simpler and would make DRIFT
INVISIBLE: the features are read at the branch tip and the report at the merge
commit of the attempt that wrote it, so a scenario authored since has no entry.
That is the ordinary authoring loop — read a failure, ask the agent for one more
scenario — and it has to show. It gets a neutral `No result`, for the same
reason `validation-view` gives one to a drifted criterion: colouring the expected
state teaches a reader to discount the colour.

## The vocabulary is the report's own

`outcomes.ts` title-cases whatever word the report carries. There is no
translation table, so there is no fifth vocabulary to keep in step with
`report.go`, `check-report.mjs`, the skill and the ADR — and an outcome word the
console has never heard of renders verbatim and neutral rather than falling
through to a wrong label. That agrees, without either side knowing about the
other, with the Go ladder counting an unrecognised outcome as a gap rather than
as coverage.

Tone and mark DO need a table, and at four outcomes they need one more than they
did at two. ADR-0016 gave `Passed` and `Failed` marks because as outlined chips
they otherwise differ by hue alone; adding `Blocked` and `Unjudgeable` creates
two more such pairs, so every outcome carries its own glyph.

| Outcome | Tone | Glyph | Why |
|---|---|---|---|
| `passed` | success | `Check` | |
| `failed` | error | `X` | |
| `blocked` | **warning** | `Ban` | ADR-0029 files no repair issue for it, because only a person can tell a product that correctly refuses from one too broken to act. It is the one row on the page carrying a call to action. |
| `unjudgeable` | default | `CircleHelp` | An honest answer about truth living outside the running app — not a defect. |
| *(absent)* | default | — | `No result`: the console's own word, because the scenario is absent from the report and the report has none for it. |

## The row: chevron first, mark inline, chip flush right

```text
›  Editing a bought item is refused ⊖                        [⊘ Blocked]
   On a bought row the Edit button is not disabled, it is absent — …
```

- **The chevron leads**, on every row including passed ones. It is what a reader
  reaches for, so it earns the left column — and because every row has one, the
  column is never slack. It also indents the scenarios under their rule by
  `INDENT`, which reads as the tree it is.
- **`INDENT` is derived** from `CHEVRON + the row gap`, so the column and
  everything hanging off it — the reason line, the steps — cannot drift apart.
  Same trick `validation-view` uses with `GUTTER`.
- **The refusal mark closes the sentence.** `@negative` was a gutter glyph first,
  in the column `validation-view` puts its method glyph in. It moved inline
  because the gutter was empty on the rows that were not refusals while the
  chevron had nowhere to go. The cost is real and worth stating: refusals no
  longer line up in a scannable column, and "everything is a happy path" is the
  commonest defect in a generated spec. The per-feature count (`3 rules · 4
  scenarios · 3 refusals`) carries the fact; it is no longer visual.
- **Tooltip AND visually-hidden text.** A `Tooltip` puts an `aria-label` on a bare
  span, and an `aria-label` on a roleless element is ignored — the same trap
  `StatusChip` documents for a Chip with no `onClick`.
- **Nothing opens by default.** Which makes the one clamped line under a
  non-passed row load-bearing: it is the only thing on the page saying *why*. It
  is the **deciding step's** `observed`, and "deciding" is `deciding()` from
  `validation/report.go` — first step with a nonzero exit, else first with
  anything observed — so the console's summary and a repair issue quote the same
  step.

## The step: three text roles, and only one of them is mono

```text
Then   the quantity of "Eggs" is still "1"
       agent-browser get count "tbody tr"
       2 — the list holds "Milk" and " milk "                     exit 1
```

- **13px** — the step. The specification sentence.
- **11px mono, clamped to two lines** — the command. A real one runs to 400
  characters of `--fn` predicate, and it is often not a command at all (`n/a`,
  `(already signed in from prior scenario)`), so it is never dressed as a
  terminal. Provenance, not payload.
- **13px, never clamped** — `observed`. THE payload. A blocked one runs past 400
  characters and is what a person reads to settle "refuses correctly" against
  "broken". Caption type would bury the one thing the outcome cannot say.
- **`exit` shows only when present AND nonzero.** Absent is not zero: the Go
  struct uses `*int` for exactly this, and a blocked `Then` has neither. There is
  no per-step success tick either — a green mark on every step would put one on
  the very step that blocked a scenario, whose command succeeded at proving a
  control was absent.
- **Steps the report does not reach render de-emphasised, `not reached`**, so a
  blocked scenario visibly STOPS partway. That is the story the report tells and
  the raw JSON hides.

## The join is identity, never the line

`scenarioKey` is feature + rule + scenario — what `check-report.mjs` keys on and
what `reportScenario.id()` builds in Go, so all three agree on what "the same
scenario" means. **Not the line number**: the two sides are read at different
commits, so any edit above a scenario moves its line while leaving the scenario
untouched. `line` is kept only for a "go to it" affordance.

A scenario in the report with no counterpart in the features gets its own
trailing group rather than being dropped — a removed scenario must not silently
vanish from a run's record.

## Why a line scanner and not `@cucumber/gherkin`

`parseFeature.ts` is deliberately the same scanner the run is checked with
(`skills/acceptance-run/scripts/check-report.mjs`). That file has no dependencies
because it runs in a validation pod; this one has none because a parser
generator is a lot of bytes to put in a console bundle for a grammar whose whole
surface here is `Feature` → `Rule` → `Scenario`.

The two MUST agree on identity, because the report joins on it: a scenario the
checker counts and this file does not would render as though the run had skipped
it, while the run's own contract gate stayed green. `parseFeature.test.ts` loads
`scanFeature` OUT OF the shipped checker — sliced from the file rather than
copied, because a copy keeps agreeing with itself after the original moves on —
and compares every feature file in the repo.

`Background:` is parsed although the authoring skill discourages it and no
generated file has ever carried one. Not to render it well, but so that a file
which does grow one cannot silently hang its steps off whatever scenario came
before.

## Tests

`AcceptanceView.test.tsx` covers the rendering in-package (jsdom via a per-file
`// @vitest-environment jsdom` pragma, matching `validation-view`);
`parseFeature.test.ts` pins the agreement with the checker; `report.test.ts`
covers the tolerant parse and `decidingStep`; `outcomes.test.ts` the vocabulary.
`vitest.config.ts` scopes `include` to `src/` because `build` compiles the tests
into `dist/` and the default glob would run those stale copies.
