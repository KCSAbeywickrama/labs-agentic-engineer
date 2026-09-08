/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { useMemo } from "react";
import { Alert, alpha, Box, Chip, Tooltip, Typography } from "@wso2/oxygen-ui";
import { Check, Sparkles, User } from "@wso2/oxygen-ui-icons-react";
import {
  parseValidationCriteria,
  type Criterion,
  type Requirement,
  type ValidationCriteria,
} from "./parse.js";
import {
  parseValidationReport,
  type CriterionReport,
  type ValidationReport,
} from "./report.js";
import { CRITERION_STATE_LABEL } from "./counts.js";
import { shortCriterionId, shortRequirementId } from "./shortId.js";

// Visually-hidden TEXT rather than an aria-label, for the reason StatusChip
// records in the console: an aria-label on a roleless element is ignored by screen
// readers, so an accessible name has to come from content. Mirrored here rather
// than imported because this package does not depend on apps/console, and
// @wso2/oxygen-ui does not re-export MUI's `visuallyHidden`.
const VISUALLY_HIDDEN = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

const mono = { fontFamily: "monospace", fontSize: "0.875rem" } as const;

/**
 * The row's first column, which holds whichever single signal the row carries:
 * the status chip when a run is attached, the method icon when none is.
 *
 * One constant per mode, because the width has to be identical on every row for
 * the ids beside it to line up — and the failure block derives its indent from it,
 * so the two can no longer drift the way `minWidth: 92` and `ml: "108px"` did.
 *
 * Sized to the longest chip label the vocabulary can produce, which is now
 * "Not validated"; a longer one would push its own row's id out of the column. A
 * short chip therefore leaves slack after it — the price of the column, and the
 * reason DRIFT_LABEL is kept terse rather than descriptive.
 */
const GUTTER_CHIP = 108;
const GUTTER_ICON = 22;
/** The row's own flex gap, in px — theme spacing(1). */
const ROW_GAP = 8;

/**
 * The height of a row's FIRST line, shared by everything sitting on it.
 *
 * Baseline alignment cannot do this job. An MUI Chip is `inline-flex` with
 * `align-items: center`, so it has no baseline-aligned flex item and therefore no
 * in-flow line box — CSS then synthesises its baseline from its bottom margin
 * edge. `align-items: baseline` consequently sat the chip's BOTTOM on the
 * assertion's baseline instead of its label, and because the chip (24px) and the
 * id mark (~18px) are different heights, the two did not even agree with each
 * other.
 *
 * So every occupant is given this exact height and centres its own content in it,
 * and the assertion takes it as its `line-height`. The first line of the row is
 * then one band that all three sit in the middle of, by construction rather than
 * by inference — and it survives an assertion that wraps, because every later line
 * is the same height too.
 *
 * 24px is the MUI small Chip's own height, so the tallest occupant sets it and
 * nothing has to be stretched.
 */
const ROW_LINE = 24;

/**
 * A requirement number or a criterion letter, on a soft neutral ground.
 *
 * A ground rather than list punctuation (`1.`, `a)`) because these are names, not
 * positions: ids are stable by contract — a spec file is named after its criterion,
 * so renumbering one would orphan it — which means deleting a requirement leaves a
 * gap. `1, 3, 4` reads correctly as names and reads as a rendering fault as a list.
 * Neutral rather than coloured: on these rows colour belongs to the status chip and
 * to the agent glyph.
 *
 * `full` is the unabbreviated id, on hover, and only when it differs from what is
 * shown. It is the handle the reader needs elsewhere — spec filenames, report.json,
 * telling the agent which criterion to change — and the short form cannot be typed
 * back into any of them.
 */
function IdMark({ short, full }: { short: string; full: string }) {
  const mark = (
    <Box
      component="span"
      sx={(theme) => ({
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        // The row's shared band rather than padding of its own, so the mark sits
        // in the same line as the chip and the assertion — see ROW_LINE.
        height: `${ROW_LINE}px`,
        minWidth: 20,
        px: 0.75,
        borderRadius: 0.75,
        flexShrink: 0,
        bgcolor: theme.palette.action.hover,
        color: "text.secondary",
        ...mono,
      })}
    >
      {short}
    </Box>
  );
  return short === full ? mark : <Tooltip title={full}>{mark}</Tooltip>;
}

// The MUI/Oxygen Chip color union — kept local so the state map stays typed.
type ChipColor =
  | "default"
  | "primary"
  | "secondary"
  | "error"
  | "info"
  | "success"
  | "warning";

// report.json status → the chip colour shown on a criterion when a run report is
// joined in. The LABEL comes from CRITERION_STATE_LABEL (counts.ts), which the
// consumer's own tally line reads too — so a row's chip and the verdict tile above
// this view can never call the same status by two different names. Unknown statuses
// fall through to a neutral chip labelled verbatim.
const STATE_COLOR: Record<string, ChipColor> = {
  pass: "success",
  fail: "error",
  not_run: "default",
  not_validated: "warning",
  manual: "default",
};

/**
 * Whether a validation run answers this method at all.
 *
 * `e2e` is the only one it does. generate-report.mjs gives an e2e criterion the
 * test's own result and decides every other method from the method alone —
 * `manual` for a manual criterion, `not_validated` for anything else it cannot
 * automate — so what will become of those rows is knowable before the run starts.
 *
 * One predicate, read by all three places that need it: which glyph the Spec view
 * shows, whether a live status may speak for a row, and whether "Pending" is a
 * promise the run can keep. Shared deliberately — with the glyph claiming a person
 * checks a `scenario` criterion while the awaiting branch still promised "Pending"
 * for it, the two surfaces contradicted each other about the same row.
 */
function runAnswers(method: string): boolean {
  return method === "e2e";
}

/**
 * Who checks a criterion — a mark, not a word.
 *
 * `e2e` is the only method an agent drives, so it takes the console's agent glyph:
 * the same Sparkles at the same primary.main that the agent chat, the "ask the
 * agent" action and the nav already carry, so the row inherits a meaning the
 * reader arrives with instead of teaching a new one.
 *
 * Everything else falls to the person. `manual` by definition; the legacy
 * `scenario` and the `"unknown"` parse.ts assigns a criterion with no method
 * because neither is ever automated, which leaves them somebody's to check in
 * practice. That is also why one sentence covers all three: the icon is already
 * claiming a human does the work, so the tooltip says exactly that much.
 */
function methodMark(method: string): {
  Icon: typeof Sparkles;
  color: string;
  title: string;
} {
  return runAnswers(method)
    ? {
        Icon: Sparkles,
        color: "primary.main",
        title: "Validated automatically by the agent.",
      }
    : {
        Icon: User,
        color: "text.secondary",
        title: "Requires manual validation.",
      };
}

/**
 * The gutter's occupant when no run is attached — the Spec view's whole case, and
 * a validation view whose report would not parse.
 *
 * Icon-only, so the sentence is repeated as hidden text. Tooltip does put its
 * title on the child as an `aria-label`, but the child is a bare span: an
 * aria-label on a roleless element is ignored, which is the same trap StatusChip
 * documents for a Chip with no onClick. Content-based naming works whatever the
 * role, so that is what this uses.
 */
function MethodIcon({ method }: { method: string }) {
  const { Icon, color, title } = methodMark(method);
  return (
    <Tooltip title={title}>
      {/* No vertical handling here: the gutter centres this in the row's shared
          band (ROW_LINE), which is the same thing that puts a status chip on the
          line. `flex` so the svg is not an inline box with its own leading. */}
      <Box component="span" sx={{ display: "flex", color, flexShrink: 0 }}>
        <Icon size={16} aria-hidden />
        <Box component="span" sx={VISUALLY_HIDDEN}>
          {title}
        </Box>
      </Box>
    </Tooltip>
  );
}

/**
 * What the report says qualifies a verdict, as one sentence — or nothing.
 *
 * The two flags are independent in generate-report.mjs: `flaky` is only set on a
 * pass, but `healed` is set before the status is decided. So a failure the agent
 * tried to repair is a real row, and so is a pass that was both repaired and
 * flaky — which is why all four readings are spelled out rather than concatenated
 * from fragments that would read as a list of tags.
 */
function verdictNote(
  status: string,
  report: CriterionReport | undefined,
): string | undefined {
  const flaky = report?.flaky ?? false;
  const healed = report?.healed ?? false;
  if (!flaky && !healed) return undefined;
  const verdict = CRITERION_STATE_LABEL[status] ?? status;
  if (flaky && healed) {
    return `${verdict}, but the test was flaky, and the agent repaired it.`;
  }
  if (flaky) return `${verdict}, but the test was flaky.`;
  return status === "fail"
    ? `${verdict}. The agent tried to repair the test.`
    : `${verdict} after the agent repaired the test.`;
}

/**
 * The per-criterion run-state chip (only rendered when a report is joined in).
 *
 * `note` is the report's qualifier on this verdict — flaky, healed, or both — and
 * it rides the chip as a single `*` rather than as its own chips beside it. Those
 * qualify THIS word, and as separate chips they read as independent facts and push
 * the verdict out of the row's one aligned column. One mark covers every
 * combination, because distinguishing them is all a second mark would buy and none
 * of them changes what the reader does next.
 *
 * Declared `string | undefined` rather than optional: `exactOptionalPropertyTypes`
 * is on, so a caller with nothing to say passes it explicitly.
 */
function StateChip({ status, note }: { status: string; note: string | undefined }) {
  const label = CRITERION_STATE_LABEL[status] ?? status;
  const chip = (
    <Chip
      size="small"
      variant="outlined"
      color={STATE_COLOR[status] ?? "default"}
      {...(status === "pass" ? { icon: <Check size={14} /> } : {})}
      label={
        note === undefined ? (
          label
        ) : (
          <>
            <span aria-hidden>{`${label}*`}</span>
            <Box component="span" sx={VISUALLY_HIDDEN}>
              {note}
            </Box>
          </>
        )
      }
      sx={{ flexShrink: 0 }}
    />
  );
  return note === undefined ? chip : <Tooltip title={note}>{chip}</Tooltip>;
}

/**
 * What the RUN is doing to a criterion right now, keyed by criterion id.
 *
 * Carried as a plain map rather than folded here, because this package renders
 * and the consumer streams: the console builds it from the run's progress feed
 * (`progress_item` events), and the Spec view — which shows the same oracle with
 * no run attached — simply passes nothing.
 */
export type LiveStatuses = Readonly<Record<string, string>>;

// The in-flight vocabulary, LOCAL for the same reason "Pending" below is: these
// words describe work happening, and report.json can only describe work in the
// past tense, so none of them belongs in CRITERION_STATE_LABEL. Its two terminal
// words (`pass`/`fail`) DO arrive on the live feed, and deliberately fall through
// to StateChip — a criterion that has passed reads the same whether the news came
// from the feed or from the report, because it is the same fact.
const LIVE_LABEL: Record<string, string> = {
  planned: "Planned",
  exploring: "Exploring…",
  authoring: "Authoring…",
  running: "Running…",
  healing: "Healing…",
};

// Only `healing` is coloured. It is the run saying a criterion that WORKED has
// stopped working — the one live status that changes what a reader thinks is
// happening. Colouring ordinary progress would spend attention on the common case
// and leave nothing to spend on this one.
const LIVE_COLOR: Record<string, ChipColor> = { healing: "warning" };

/** The chip for a criterion the pinned report predates — see CriterionChip. */
const DRIFT_LABEL = "Out of run";
const DRIFT_TOOLTIP =
  "Authored after the last validation run, so it has no result yet.";

// The per-criterion chip while the run is still working on it.
function LiveChip({ status }: { status: string }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      color={LIVE_COLOR[status] ?? "info"}
      label={LIVE_LABEL[status] ?? status}
      sx={{ flexShrink: 0 }}
    />
  );
}

/**
 * The one chip a criterion's row carries, in precedence order.
 *
 * `manual` is the exception that shapes the order: such a criterion is answered
 * by a person, so a run signal must not speak for it. It skips the live status
 * and lands on the report's own `manual`, or on the same final word `awaiting`
 * would otherwise have given it.
 *
 * Otherwise live beats report, and that ordering is the whole point: a repeat
 * attempt carries the PREVIOUS attempt's report, so ranking the report higher
 * would freeze a criterion on the last run's verdict for the entire time the
 * current run spends re-working it. The report wins again the moment the cycle
 * settles, because the consumer stops supplying live statuses then.
 *
 * Only called when a run IS attached, so unlike its predecessor it always returns
 * a chip. CriterionRow handles the no-run case, which shows who checks the
 * criterion instead of what happened to it.
 */
function CriterionChip({
  criterion,
  report,
  live,
  awaiting,
}: {
  criterion: Criterion;
  report: CriterionReport | undefined;
  live: string | undefined;
  awaiting: boolean;
}) {
  // A criterion the run does not answer never takes a live status. The run
  // reports one — its test plan names every criterion, not only the ones an agent
  // will work — but it will never ANSWER this row, so a chip reading "Planned"
  // promises a result nobody is going to produce. It is the only status such a
  // row can receive, and nothing supersedes it: every later status needs a spec
  // file it will never have.
  if (live && runAnswers(criterion.method)) {
    // pass/fail arrive on the live feed too — report.json's own words, so its chip.
    return LIVE_LABEL[live] ? (
      <LiveChip status={live} />
    ) : (
      <StateChip status={live} note={undefined} />
    );
  }
  if (report) {
    return (
      <StateChip status={report.status} note={verdictNote(report.status, report)} />
    );
  }

  // A criterion the run does not answer gets its final word rather than
  // "Pending": no result is coming, so a chip promising one is a claim the report
  // will contradict. Which final word is decided by the method alone, which is
  // why it can be said this early.
  //
  // "Pending" itself is local rather than a sixth CRITERION_STATE_LABEL entry:
  // that map is report.json's vocabulary, and a criterion with no report has no
  // status to name.
  if (awaiting) {
    if (!runAnswers(criterion.method)) {
      return (
        <StateChip
          status={criterion.method === "manual" ? "manual" : "not_validated"}
          note={undefined}
        />
      );
    }
    return (
      <Chip size="small" variant="outlined" label="Pending" sx={{ flexShrink: 0 }} />
    );
  }

  // A settled run whose report has no row for this criterion. The consumer reads
  // the criteria at the branch tip and the report at the merge commit of the
  // attempt that wrote it, so a criterion authored since then cannot have a
  // result — which is the ordinary authoring loop (run, read a failure, ask the
  // agent for another criterion), not a fault. Hence a neutral chip and not a
  // `warning`: colouring the expected state teaches the reader to discount the
  // colour. Local wording for the same reason "Pending" above is local — this
  // criterion is absent from report.json, so report.json has no word for it.
  return (
    <Tooltip title={DRIFT_TOOLTIP}>
      <Chip
        size="small"
        variant="outlined"
        label={DRIFT_LABEL}
        sx={{ flexShrink: 0 }}
      />
    </Tooltip>
  );
}

// One acceptance criterion: its single signal in the gutter — the status chip when
// a run is attached, otherwise who checks it — then its letter, the atomic
// assertion, and, for a failure, the spec path and message beneath.
//
// One signal and not two. A manual criterion used to carry a purple MANUAL badge
// here AND a neutral "Manual" status chip at the far end of the row, saying the
// same thing twice at opposite margins; and flaky/healed were two more chips
// competing with the verdict they qualify. The gutter now holds exactly one thing,
// which is what lets it be a fixed width and the letters beside it line up.
function CriterionRow({
  criterion,
  requirementId,
  report,
  live,
  awaiting,
  hasRun,
}: {
  criterion: Criterion;
  /** The card this row sits in, so the letter can drop the prefix it repeats. */
  requirementId: string;
  report: CriterionReport | undefined;
  live: string | undefined;
  awaiting: boolean;
  hasRun: boolean;
}) {
  const failed = report?.status === "fail";
  return (
    // RequirementCard draws the rule that separates rows; it lands on THIS box, so
    // a failure block stays inside the criterion it belongs to instead of being cut
    // off from its own assertion.
    <Box sx={{ py: 1 }}>
      {/* `flex-start`, so the marks stay on the FIRST line of an assertion that
          wraps rather than drifting to the middle of it. Alignment within that
          line is ROW_LINE's job, not this property's. */}
      <Box
        sx={{ display: "flex", gap: `${ROW_GAP}px`, alignItems: "flex-start" }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            height: `${ROW_LINE}px`,
            minWidth: hasRun ? `${GUTTER_CHIP}px` : `${GUTTER_ICON}px`,
            flexShrink: 0,
          }}
        >
          {hasRun ? (
            <CriterionChip
              criterion={criterion}
              report={report}
              live={live}
              awaiting={awaiting}
            />
          ) : (
            <MethodIcon method={criterion.method} />
          )}
        </Box>
        <IdMark
          short={shortCriterionId(criterion.id, requirementId)}
          full={criterion.id}
        />
        <Typography
          variant="body2"
          sx={{ flexGrow: 1, lineHeight: `${ROW_LINE}px` }}
        >
          {criterion.must}
        </Typography>
      </Box>
      {/* Failure detail sits full-width beneath the row, indented to where the
          criterion's letter starts, so a long trace never crowds the assertion. A
          failure only exists with a report attached, so the chip gutter is the
          right one to measure from. */}
      {failed && (report?.failureLocation || report?.spec || report?.failure) && (
        <Box sx={{ mt: 0.75, ml: `${GUTTER_CHIP + ROW_GAP}px` }}>
          {/* Prefer the reporter's `<file>:<line>`, which points at the failing
              assertion rather than merely the spec that contains it. The gate
              above admits it on its own: a reporter can hand back a location with
              an empty message, and dropping the block then would throw away the
              only pointer to the failing assertion the run produced. */}
          {(report?.failureLocation || report?.spec) && (
            <Typography variant="caption" color="text.secondary" sx={mono}>
              {report.failureLocation || report.spec}
            </Typography>
          )}
          {report?.failure && (
            <Box
              component="pre"
              sx={{
                // `m: 0` first: it is a shorthand, so declaring it after `mt`
                // silently overrode the gap this block is supposed to keep.
                m: 0,
                mt: 0.5,
                p: 1,
                borderRadius: 1,
                // A wash, not a saturated fill. The state chip on the row above
                // already says "failed", so the surface's job is to be READABLE —
                // a stack trace is the longest text on the page and it was set in
                // monospace on solid error.main. The tint composites over
                // whichever surface is beneath it, so it holds in both themes;
                // same idiom as StatusChip's soft tones.
                bgcolor: (theme) => alpha(theme.palette.error.main, 0.08),
                color: "text.primary",
                fontFamily: "monospace",
                fontSize: "0.75rem",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 220,
                overflow: "auto",
              }}
            >
              {report.failure}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

function RequirementCard({
  requirement,
  statuses,
  live,
  awaiting,
  hasRun,
}: {
  requirement: Requirement;
  statuses: ValidationReport | undefined;
  live: LiveStatuses | undefined;
  awaiting: boolean;
  hasRun: boolean;
}) {
  const count = requirement.criteria.length;
  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: 2,
        // Twice the gap between two criteria (16px). These were both 12px, so a
        // requirement boundary carried the same weight as a row boundary and the
        // nesting was invisible in the rhythm.
        mb: 3,
      }}
    >
      {/* The number leads the statement, echoing the rows below where the letter
          leads the assertion — so the card reads the same way at both levels. The
          "N criteria" caption that used to sit up here is gone: it counted a list
          the reader is looking at. */}
      {/* The same shared-band idiom as the rows below, so the number sits on the
          statement's first line and stays there when the statement wraps. */}
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-start",
          gap: `${ROW_GAP}px`,
          mb: count > 0 ? 1.5 : 0,
        }}
      >
        <IdMark
          short={shortRequirementId(requirement.id)}
          full={requirement.id}
        />
        <Typography
          variant="body1"
          sx={{ fontWeight: 500, lineHeight: `${ROW_LINE}px` }}
        >
          {requirement.statement}
        </Typography>
      </Box>
      {count === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No criteria.
        </Typography>
      ) : (
        // A rule on the TOP of every row, not between rows. Bottom-of-all-but-last
        // left the first criterion as the only one with no boundary above it, so it
        // read as belonging to the statement in a way its siblings did not — and it
        // made a one-criterion requirement render with no rule at all. This way the
        // statement is the card's header, every criterion is bounded the same, and
        // the card's own border closes the list at the bottom.
        //
        // Owned here rather than by CriterionRow because it is a property of the
        // LIST; the rows get their own box because the badge row and the statement
        // above are their siblings.
        <Box sx={{ "& > *": { borderTop: 1, borderColor: "divider" } }}>
          {requirement.criteria.map((c) => (
            <CriterionRow
              key={c.id}
              criterion={c}
              requirementId={requirement.id}
              report={statuses?.get(c.id)}
              live={live?.[c.id]}
              awaiting={awaiting}
              hasRun={hasRun}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

function ValidationBody({
  criteria,
  statuses,
  live,
  noPadding,
  fullWidth,
  hideDescription,
  awaitingReport,
}: {
  criteria: ValidationCriteria;
  statuses: ValidationReport | undefined;
  live: LiveStatuses | undefined;
  /** Required, not optional: `exactOptionalPropertyTypes` is on, so the public
   *  props are defaulted at the boundary rather than forwarded as `undefined`. */
  noPadding: boolean;
  fullWidth: boolean;
  hideDescription: boolean;
  awaitingReport: boolean;
}) {
  const { requirements } = criteria;
  /**
   * Whether a RUN is attached, which decides what every row's gutter holds: its
   * status chip, or — with no run to report — who checks it.
   *
   * Read from `statuses`, NOT from the `report` prop. The prop is raw text and
   * parsing it can fail, which leaves `statuses` undefined while a report WAS
   * supplied; keying off the prop would then hand every row the drift chip,
   * announcing that all of them were authored after the last run when the truth is
   * that the file is unreadable. This way such a view degrades to the plain
   * oracle, with the warning Alert above it naming the real problem.
   */
  const hasRun = statuses !== undefined || awaitingReport;
  const reqCount = requirements.length;
  return (
    // `height`/`overflow` are the file-pane contract and stay unconditional: on a
    // page they are inert (PageContent's inner box has auto height, so the
    // percentage resolves to auto and nothing ever scrolls here). Only `p: 3`
    // renders differently between the two consumers, so only it is switched.
    <Box
      sx={{
        height: "100%",
        overflow: "auto",
        ...(noPadding ? {} : { p: 3 }),
      }}
    >
      <Box sx={fullWidth ? undefined : { maxWidth: 960, mx: "auto" }}>
        <Typography variant="h4" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
          Validation Criteria
        </Typography>

        {/* What this document is, where it comes from, and what happens to it.
            Nothing else in the spec workspace says so, and the reader meets the
            criteria here before any run has produced a result to learn from. */}
        {!hideDescription && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Each criterion represents one thing your software must do, based on your
            requirements. After every deployment they are checked against the running
            software, and the results appear under Validations. To change one, ask the
            agent.
          </Typography>
        )}

        {/* No summary line here. It read "N requirements · M criteria" over a
            per-method tally, and on the Validations page it sat directly beneath a
            tile already printing both — the same numbers twice, a screen apart.
            The counts that a reader acts on belong with the verdict that explains
            them, which the consumer renders above this view.

            The gap it used to leave below itself now belongs to the list, which is
            what it was separating the heading from. */}
        <Box sx={{ mt: 3 }}>
          {reqCount === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No validation criteria.
            </Typography>
          ) : (
            requirements.map((r) => (
              <RequirementCard
                key={r.id}
                requirement={r}
                statuses={statuses}
                live={live}
                awaiting={awaitingReport}
                hasRun={hasRun}
              />
            ))
          )}
        </Box>
      </Box>
    </Box>
  );
}

export interface ValidationViewProps {
  /** Raw validation-criteria.json text (the acceptance oracle). */
  criteria: string;
  /**
   * Raw tests/validation/report.json text. When present, per-criterion run
   * state is joined onto the oracle by criterion id and rendered as state chips
   * plus failure detail. Absent → the plain oracle (the Spec-view preview).
   */
  report?: string;
  /**
   * The consumer owns the padding. Default off, because this view's first home is
   * the Spec view's file pane, which hands each renderer an unpadded box — the
   * same contract OpenApiView is written to. A PAGE owns its own edges and its own
   * rhythm, so a page consumer opts out instead of the view guessing.
   */
  noPadding?: boolean;
  /**
   * Fill the consumer's width instead of centring the criteria in a 960px reading
   * column. Default off, for the same reason as `noPadding`: in the Spec view this
   * is a file preview beside a 280px file list, where a measured column reads
   * better than prose stretched across the pane. A console PAGE is the opposite —
   * no page in this app caps its body (see BuildsPage, DeploymentsPage), and
   * PageContent already supplies the outer 1400px cap and the centring.
   *
   * Separate from `noPadding` on purpose: a prop named for padding should not also
   * govern width. Oxygen's own PageContent draws the same line.
   */
  fullWidth?: boolean;
  /**
   * Drop the paragraph explaining what the criteria are. Default off, same reason
   * as the two above: the Spec view is where a reader first meets this document,
   * with nothing else on the page to say what it is for. The Validations page is
   * the opposite — the reader arrived there to read run results, and a sentence
   * telling them results appear under Validations is redundant on the page that
   * holds them.
   */
  hideDescription?: boolean;
  /**
   * Chip every criterion with what is ABOUT to happen to it, for a consumer showing
   * the oracle while a validation attempt is in flight: "Pending" for the ones an
   * agent will drive, "Manual" for the ones only a person can judge.
   *
   * Off by default, like its neighbours, and ignored for any criterion that
   * HAS a report — the Spec view's file preview shows the plain oracle with no run
   * attached to it, and chips there would name a run that does not exist.
   *
   * Named for the state rather than `pending`: a boolean prop by that name reads as
   * react-query's `isPending` — "still loading" — which is the opposite of what this
   * means. The criteria are loaded; the RESULTS are not.
   */
  awaitingReport?: boolean;

  /**
   * What the run is doing to each criterion right now — see LiveStatuses.
   *
   * Ranked ABOVE `report`, so a repeat attempt shows what it is re-working
   * instead of the last attempt's verdict. Supply it only while a cycle is
   * actually in flight: a stale map would keep overriding a settled report with
   * statuses nothing is still producing.
   */
  live?: LiveStatuses;
}

export function ValidationView({
  criteria,
  report,
  noPadding = false,
  fullWidth = false,
  hideDescription = false,
  awaitingReport = false,
  live,
}: ValidationViewProps) {
  const parsed = useMemo(() => parseValidationCriteria(criteria), [criteria]);
  // The report is optional and tolerant: a bad report never blocks the oracle —
  // it degrades to a non-blocking warning below and the criteria still render.
  const parsedReport = useMemo(
    () => (report ? parseValidationReport(report) : undefined),
    [report],
  );
  const reportError =
    parsedReport && "kind" in parsedReport ? parsedReport : undefined;
  const statuses =
    parsedReport && !("kind" in parsedReport) ? parsedReport : undefined;

  if ("kind" in parsed) {
    return (
      <Box sx={noPadding ? {} : { p: 3 }}>
        <Alert severity="error">
          Couldn't parse validation-criteria.json: {parsed.message}
        </Alert>
      </Box>
    );
  }
  return (
    <>
      {reportError && (
        <Box sx={noPadding ? {} : { px: 3, pt: 2 }}>
          <Alert severity="warning">
            Couldn't parse the validation report: {reportError.message}
          </Alert>
        </Box>
      )}
      <ValidationBody
        criteria={parsed}
        statuses={statuses}
        live={live}
        noPadding={noPadding}
        fullWidth={fullWidth}
        hideDescription={hideDescription}
        awaitingReport={awaitingReport}
      />
    </>
  );
}
