# Design notes — `@aep/ui-validation-view`

This package renders `specs/validation/validation-criteria.json` — the acceptance
oracle — optionally joined against a run's `tests/validation/report.json`. Two
consumers, one component:

| Consumer | What it passes | What the reader is doing there |
|---|---|---|
| Spec view's file pane (`SpecView.tsx`) | `criteria` only | Reading the document, before any run exists |
| Validations page (`ValidationPage.tsx`) | `criteria`, `report`, `live`, `awaitingReport` | Reading run results |

## One gutter, one signal

Every criterion row leads with a fixed-width column holding exactly one mark, and
which mark depends on whether a run is attached:

```text
SPEC VIEW — no run                    VALIDATIONS — a run
 ✦  a  A registered email …            [Passed]   a  A registered email …
 ○  b  The reset copy reads …          [Manual]   b  The reset copy reads …
                                       [Failed*]  c  A short password …
```

`✦` is `Sparkles` at `primary.main`, the glyph this console already means "the
agent" by in nine other places; `○` is `User` at `text.secondary`. Both are
icon-only, with the explanation on hover and repeated as visually-hidden text —
`Tooltip` does add an `aria-label`, but its child is a bare span and an aria-label
on a roleless element is ignored, the same trap `StatusChip` documents for a Chip
with no `onClick`.

Three rules hold the column to one mark:

- **No tally in this view.** Counts belong with the verdict that explains them,
  which the consumer renders above; a second copy here says the same numbers twice.
- **Never a method mark beside a status chip.** The chip already says `Manual`, so
  a mark next to it states the same fact at the other margin of the row. Where
  there are results the chip is sufficient; where there are none the glyph is.
- **Qualifiers ride the verdict.** `flaky` and `healed` become a single `*` with
  the detail on hover, rather than chips competing with the word they qualify. The
  two flags are independent in `generate-report.mjs` (`flaky` only on a pass,
  `healed` decided before the status), so `Failed*` is a real row and so is a pass
  that was both.

One mark per row is what lets the gutter be one width, which is what keeps the ids
beside it aligned. `GUTTER_CHIP` / `GUTTER_ICON` / `ROW_GAP` are single constants
and the failure block derives its indent from them, so the column and the indent
cannot disagree.

`GUTTER_CHIP` has to fit the longest label the vocabulary can produce
(`Not validated`), so a short chip like `Failed` leaves visible slack before the id.
That is a deliberate trade: the alternatives are right-aligning the chip in the
column (constant gap, ragged chip left edges) or dropping the column (constant gap,
ragged ids), and the aligned column is worth more than either. It is also why the
drift chip's label is kept terse — a descriptive one would widen every row.

### Vertical alignment is a shared band, not a baseline

`ROW_LINE` (24px, the MUI small Chip's own height) is the height of a row's first
line. The gutter, the id mark and the requirement number are each given exactly
that height and centre their own content in it, and the assertion takes it as its
`line-height`. All three then sit in the middle of one band by construction, and it
holds for an assertion that wraps because every later line is the same height.

`align-items: baseline` is the wrong tool here, and worth knowing why. An MUI Chip
is `inline-flex` with `align-items: center`, so it has no baseline-aligned flex
item and therefore no in-flow line box — CSS then synthesises its baseline from its
bottom margin edge. Baseline alignment therefore sits the chip's *bottom* on the
assertion's baseline rather than its label, and since the chip (24px) and the id
mark (~18px) are different heights, the two do not even agree with each other. A
bare glyph has the same defect for the same reason; under the shared band it needs
no special handling, because its parent centres it.

The row itself is `align-items: flex-start`, which keeps the marks on the first
line of a wrapping assertion. `center` would drift them into the middle of it.

## Two predicates, because a run gets asked two questions

Both live in `counts.ts` (`runAnswers`, `runWorksOn`) so every caller reads the
same answer:

- **`runAnswers(method)`** — will the run produce a *verdict* for this row? `e2e`
  only. `generate-report.mjs` gives an e2e criterion its test's result and decides
  every other method from the method alone, `manual` for manual and
  `not_validated` for anything else. Read by the glyph and by the `awaiting`
  branch, which is why a criterion the run cannot answer gets its final word
  instead of a `Pending` the report would contradict.
- **`runWorksOn(method)`** — is the run *working on* this row, and so emitting live
  progress naming it? Everything but `manual`. A run explores, authors and runs a
  legacy `scenario` criterion and still reports `not_validated` for it. Read by the
  live-status guard, and by the console's run-wide progress line
  (`liveLine.ts`), which counts exactly this set.

The gap between them is the whole point, and there is a mistake waiting on each
side of it. Inline the comparison per call site and the glyph can claim a person
checks a `scenario` criterion while the `awaiting` branch promises it an agent
result. Collapse all three onto `runAnswers` and a row refuses a live status that
the progress line above it has already counted. `liveLine.ts` reads `runWorksOn`
from this package rather than repeating the comparison, so the two cannot
disagree.

## Drift is a normal state, so it has a chip

`ValidationPage` reads the criteria at the **branch tip** and the report at the
**merge commit** of the attempt that wrote it (deliberately — reading the tip would
show an older attempt the newest run's results). The join is by criterion id, so a
criterion authored since that commit has no row in that report.

That is the ordinary authoring loop: run validation, read a failure, ask the agent
for another criterion. It gets a neutral `Out of run` chip. Neutral and not
`warning`, because colouring the expected state teaches the reader to discount the
colour; and locally worded, because `CRITERION_STATE_LABEL` is `report.json`'s
vocabulary and this criterion is absent from `report.json`.

The chip is a claim about a run that FINISHED without covering the row, so it is
gated on no attempt being in flight. `awaitingReport` therefore means "any attempt
is in flight", not "this version's first" — narrowed to the first, the page told a
reader that a criterion authored since the last run was out of that run while the
current run was on its way to answering it. Widening it is safe because `report`
outranks the pending fallback: a covered row keeps the previous attempt's verdict,
and only uncovered rows read the flag.

The `hasRun` flag that chooses gutter contents is read from the **parsed**
`statuses`, never from the `report` prop. The prop is raw text and parsing can
fail; keying off it would hand every row the drift chip, announcing that all of
them post-date the last run when the truth is that the file is unreadable. Read
from `statuses`, such a view degrades to the plain oracle with the existing warning
Alert above it.

Reachable in the console's mock mode via
`localStorage.setItem('aep:mock:validation-criteria', 'drifted')`.

## Short ids (`shortId.ts`)

`skills/validation-criteria/SKILL.md` fixes both shapes: `REQ-NNN` and
`AC-<req-number>-<letter>`. Inside a requirement's own card the `AC-001-` half is
already on the page, so rows print `a` and cards print `1`.

Both sit on a soft `action.hover` ground rather than taking list punctuation
(`1.`, `a)`), because they are names and not positions. Ids are stable by contract
— a spec file is named `tests/e2e/specs/<AC-ID>.spec.ts`, so renumbering one would
orphan it — which means a deleted requirement leaves a gap. `1, 3, 4` reads
correctly as names and reads as a rendering fault as a list.

Shortening is conditional, not cosmetic: `parse.ts` takes ids as arbitrary strings,
and a criterion whose number names a *different* requirement keeps its full id,
because that number is the only part of it that says it is filed in the wrong card.
The full id stays one hover away — it is the handle for spec filenames,
`report.json`, and telling the agent which criterion to change.

## Tests

`ValidationView.test.tsx` covers the rendering in-package (jsdom via a per-file
`// @vitest-environment jsdom` pragma, matching `design-view`); `shortId.test.ts`
covers the id fallbacks. `vitest.config.ts` scopes `include` to `src/` because
`build` compiles the tests into `dist/` and the default glob would run those stale
copies against whatever the source was at build time.
