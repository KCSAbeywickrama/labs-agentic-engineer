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
import { Alert, alpha, Box, Chip, Typography } from "@wso2/oxygen-ui";
import { Check } from "@wso2/oxygen-ui-icons-react";
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

// Solid background per verification method. Text color is computed for contrast
// (getContrastText), so labels stay readable in both themes — the same approach
// as the DesignView type badges and the OpenAPI viewer's method badges.
const METHOD_COLOR: Record<string, string> = {
  e2e: "#1976d2",
  scenario: "#ed6c02",
  manual: "#7b1fa2",
};
// Fixed display order for the summary tally; unknown methods sort after these.
const METHOD_ORDER = ["e2e", "scenario", "manual"];
// Requirement ids are structural, so a muted slate keeps them from competing
// with the colored method badges.
const REQ_COLOR = "#546e7a";
const FALLBACK = "#616161";

const mono = { fontFamily: "monospace", fontSize: "0.875rem" } as const;

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
// consumer's tally line reads too — so a criterion's chip and the summary above
// it can never call the same status by two different names. Unknown statuses fall
// through to a neutral chip labelled verbatim.
const STATE_COLOR: Record<string, ChipColor> = {
  pass: "success",
  fail: "error",
  not_run: "default",
  not_validated: "warning",
  manual: "default",
};

function SolidBadge({ label, color }: { label: string; color: string }) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        px: 1,
        py: 0.5,
        borderRadius: 1,
        flexShrink: 0,
        fontFamily: "monospace",
        fontSize: "0.6875rem",
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        bgcolor: color,
        color: theme.palette.getContrastText(color),
      })}
    >
      {label}
    </Box>
  );
}

function MethodBadge({ method }: { method: string }) {
  return <SolidBadge label={method} color={METHOD_COLOR[method] ?? FALLBACK} />;
}

// The per-criterion run-state chip (only rendered when a report is joined in).
function StateChip({ status }: { status: string }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      color={STATE_COLOR[status] ?? "default"}
      {...(status === "pass" ? { icon: <Check size={14} /> } : {})}
      label={CRITERION_STATE_LABEL[status] ?? status}
      sx={{ flexShrink: 0 }}
    />
  );
}

// One acceptance criterion: method badge, its id, the atomic assertion, and —
// when a run report is joined in — its run-state chip plus healed/flaky markers
// and (for a failure) the spec path and failure message beneath.
function CriterionRow({
  criterion,
  report,
}: {
  criterion: Criterion;
  report: CriterionReport | undefined;
}) {
  const failed = report?.status === "fail";
  return (
    // RequirementCard draws the rule that separates rows; it lands on THIS box, so
    // a failure block stays inside the criterion it belongs to instead of being cut
    // off from its own assertion.
    <Box sx={{ py: 1 }}>
      <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-start" }}>
        <Box sx={{ minWidth: 92, flexShrink: 0, pt: "1px" }}>
          <MethodBadge method={criterion.method} />
        </Box>
        <Typography component="span" sx={{ ...mono, flexShrink: 0 }}>
          {criterion.id}
        </Typography>
        <Typography variant="body2" sx={{ flexGrow: 1 }}>
          {criterion.must}
        </Typography>
        {report?.flaky && (
          <Chip size="small" variant="outlined" color="warning" label="flaky" sx={{ flexShrink: 0 }} />
        )}
        {report?.healed && (
          <Chip size="small" variant="outlined" label="healed" sx={{ flexShrink: 0 }} />
        )}
        {report && <StateChip status={report.status} />}
      </Box>
      {/* Failure detail sits full-width beneath the row (indented past the
          method badge) so a long trace never crowds the assertion. */}
      {failed && (report?.failureLocation || report?.spec || report?.failure) && (
        <Box sx={{ mt: 0.75, ml: "108px" }}>
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
}: {
  requirement: Requirement;
  statuses: ValidationReport | undefined;
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
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
        <SolidBadge label={requirement.id} color={REQ_COLOR} />
        <Typography variant="caption" color="text.secondary">
          {count} {count === 1 ? "criterion" : "criteria"}
        </Typography>
      </Box>
      <Typography
        variant="body1"
        sx={{ fontWeight: 500, mb: count > 0 ? 1.5 : 0 }}
      >
        {requirement.statement}
      </Typography>
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
            <CriterionRow key={c.id} criterion={c} report={statuses?.get(c.id)} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function ValidationBody({
  criteria,
  statuses,
  noPadding,
  fullWidth,
}: {
  criteria: ValidationCriteria;
  statuses: ValidationReport | undefined;
  /** Required, not optional: `exactOptionalPropertyTypes` is on, so the public
   *  props are defaulted at the boundary rather than forwarded as `undefined`. */
  noPadding: boolean;
  fullWidth: boolean;
}) {
  const { requirements } = criteria;
  // Per-method tally for the summary header, kept in a stable order. The
  // per-run-state tally is deliberately NOT here: it belongs with the verdict it
  // explains, which the consumer renders above this view (tallyCriterionStates in
  // counts.ts), and duplicating it here would put the same numbers on the page
  // twice.
  const { total, orderedMethods, methodCounts } = useMemo(() => {
    const methods = new Map<string, number>();
    let n = 0;
    for (const r of requirements) {
      for (const c of r.criteria) {
        n += 1;
        methods.set(c.method, (methods.get(c.method) ?? 0) + 1);
      }
    }
    const orderedM = [
      ...METHOD_ORDER.filter((m) => methods.has(m)),
      ...[...methods.keys()].filter((m) => !METHOD_ORDER.includes(m)).sort(),
    ];
    return { total: n, orderedMethods: orderedM, methodCounts: methods };
  }, [requirements]);

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

        {/* Summary — totals plus a colored tally per verification method */}
        <Box
          sx={{
            mt: 1,
            mb: 3,
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            flexWrap: "wrap",
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {reqCount} {reqCount === 1 ? "requirement" : "requirements"} ·{" "}
            {total} {total === 1 ? "criterion" : "criteria"}
          </Typography>
          {orderedMethods.map((m) => (
            <SolidBadge
              key={m}
              label={`${m} ${methodCounts.get(m) ?? 0}`}
              color={METHOD_COLOR[m] ?? FALLBACK}
            />
          ))}
        </Box>

        {reqCount === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No validation criteria.
          </Typography>
        ) : (
          requirements.map((r) => (
            <RequirementCard key={r.id} requirement={r} statuses={statuses} />
          ))
        )}
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
}

export function ValidationView({
  criteria,
  report,
  noPadding = false,
  fullWidth = false,
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
        noPadding={noPadding}
        fullWidth={fullWidth}
      />
    </>
  );
}
