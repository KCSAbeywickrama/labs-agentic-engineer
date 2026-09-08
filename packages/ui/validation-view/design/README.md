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

Three things this replaced, each because it said something twice or said nothing:

- **A summary line.** `N requirements · M criteria` over `AUTO 9` / `MANUAL 3`
  badges. On the Validations page it sat directly beneath a tile already printing
  both figures. Counts belong with the verdict that explains them, which the
  consumer renders above this view.
- **A method badge on every row.** A manual criterion carried a purple `MANUAL`
  badge at the left margin *and* a neutral `Manual` status chip at the right — the
  same fact at opposite ends of one row. Where there are results, the status chip
  is sufficient; where there are none, the glyph is.
- **Separate `flaky` / `healed` chips.** They qualify the verdict, so they now ride
  it as a single `*` with the detail on hover. Both flags are independent in
  `generate-report.mjs` (`flaky` only on a pass, `healed` set before the status is
  decided), so `Failed*` is a real row and so is a pass that was both.

Collapsing to one chip per row is what lets the gutter be one width for every row,
which is what keeps the ids beside it aligned. `GUTTER_CHIP` / `GUTTER_ICON` /
`ROW_GAP` are single constants and the failure block derives its indent from them;
they were previously two unrelated magic numbers (`minWidth: 92`, `ml: "108px"`).

`GUTTER_CHIP` has to fit the longest label the vocabulary can produce
(`Not validated`), so a short chip like `Failed` leaves visible slack before the id.
That is a deliberate trade, taken twice: the alternatives are right-aligning the
chip in the column (constant gap, ragged chip left edges) or dropping the column
(constant gap, ragged ids), and the aligned column won both times. It is also why
the drift chip's label is kept terse — a descriptive one would widen every row.

### Vertical alignment is a shared band, not a baseline

`ROW_LINE` (24px, the MUI small Chip's own height) is the height of a row's first
line. The gutter, the id mark and the requirement number are each given exactly
that height and centre their own content in it, and the assertion takes it as its
`line-height`. All three then sit in the middle of one band by construction, and it
holds for an assertion that wraps because every later line is the same height.

`align-items: baseline` was tried first and is the wrong tool. An MUI Chip is
`inline-flex` with `align-items: center`, so it has no baseline-aligned flex item
and therefore no in-flow line box — CSS synthesises its baseline from its bottom
margin edge. Baseline alignment consequently sat the chip's *bottom* on the
assertion's baseline rather than its label, and since the chip (24px) and the id
mark (~18px) had different heights, the two did not even agree with each other. The
glyph had the same defect for the same reason and needed its own workaround; under
the shared band it needs none, because its parent centres it.

The row itself is `align-items: flex-start`, which keeps the marks on the first
line of a wrapping assertion. `center` would drift them into the middle of it.

## `runAnswers` is the one predicate

`e2e` is the only method a run answers. `generate-report.mjs` gives an e2e
criterion its test's result and decides every other method from the method alone —
`manual` for manual, `not_validated` for anything else.

That single fact drives three decisions, so it lives in one predicate rather than
three inlined method comparisons: which glyph a row shows, whether a live status
may speak for a row, and whether `Pending` is a promise the run can keep. Splitting
them is how the glyph came to claim a person checks a legacy `scenario` criterion
while the awaiting branch still promised it an agent result.

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
