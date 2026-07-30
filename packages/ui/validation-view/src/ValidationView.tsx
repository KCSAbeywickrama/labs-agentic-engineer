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
import { Alert, Box, Chip, Typography } from "@wso2/oxygen-ui";
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

// report.json status → the state chip shown on a criterion when a run report is
// joined in. Unknown statuses fall through to a neutral chip labelled verbatim.
const STATE_CHIP: Record<string, { label: string; color: ChipColor }> = {
  pass: { label: "Passed", color: "success" },
  fail: { label: "Failed", color: "error" },
  not_run: { label: "Not run", color: "default" },
  not_validated: { label: "Not validated", color: "warning" },
  manual: { label: "Manual", color: "default" },
};

// Order the outcome tally so a failure reads first.
const STATE_ORDER = ["fail", "pass", "not_run", "not_validated", "manual"];

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
  const chip = STATE_CHIP[status] ?? { label: status, color: "default" as const };
  return (
    <Chip
      size="small"
      variant="outlined"
      color={chip.color}
      {...(status === "pass" ? { icon: <Check size={14} /> } : {})}
      label={chip.label}
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
    <Box sx={{ py: 0.75 }}>
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
      {failed && (report?.spec || report?.failure) && (
        <Box sx={{ mt: 0.75, ml: "108px" }}>
          {/* Prefer the reporter's `<file>:<line>`, which points at the failing
              assertion rather than merely the spec that contains it. */}
          {(report?.failureLocation || report?.spec) && (
            <Typography variant="caption" color="text.secondary" sx={mono}>
              {report.failureLocation || report.spec}
            </Typography>
          )}
          {report?.failure && (
            <Box
              component="pre"
              sx={{
                mt: 0.5,
                m: 0,
                p: 1,
                borderRadius: 1,
                bgcolor: "error.main",
                color: (theme) => theme.palette.getContrastText(theme.palette.error.main),
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
        mb: 1.5,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
        <SolidBadge label={requirement.id} color={REQ_COLOR} />
        <Typography variant="caption" color="text.secondary">
          {count} {count === 1 ? "criterion" : "criteria"}
        </Typography>
      </Box>
      <Typography variant="body1" sx={{ fontWeight: 500, mb: count > 0 ? 1 : 0 }}>
        {requirement.statement}
      </Typography>
      {count === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No criteria.
        </Typography>
      ) : (
        requirement.criteria.map((c) => (
          <CriterionRow key={c.id} criterion={c} report={statuses?.get(c.id)} />
        ))
      )}
    </Box>
  );
}

function ValidationBody({
  criteria,
  statuses,
}: {
  criteria: ValidationCriteria;
  statuses: ValidationReport | undefined;
}) {
  const { requirements } = criteria;
  // Per-method tally for the summary header (kept in a stable order), plus a
  // per-run-state tally when a report is joined in.
  const { total, orderedMethods, methodCounts, orderedStates, stateCounts } =
    useMemo(() => {
      const methods = new Map<string, number>();
      const states = new Map<string, number>();
      let n = 0;
      for (const r of requirements) {
        for (const c of r.criteria) {
          n += 1;
          methods.set(c.method, (methods.get(c.method) ?? 0) + 1);
          const st = statuses?.get(c.id)?.status;
          if (st) states.set(st, (states.get(st) ?? 0) + 1);
        }
      }
      const orderedM = [
        ...METHOD_ORDER.filter((m) => methods.has(m)),
        ...[...methods.keys()].filter((m) => !METHOD_ORDER.includes(m)).sort(),
      ];
      const orderedS = [
        ...STATE_ORDER.filter((s) => states.has(s)),
        ...[...states.keys()].filter((s) => !STATE_ORDER.includes(s)).sort(),
      ];
      return {
        total: n,
        orderedMethods: orderedM,
        methodCounts: methods,
        orderedStates: orderedS,
        stateCounts: states,
      };
    }, [requirements, statuses]);

  const reqCount = requirements.length;
  return (
    <Box sx={{ height: "100%", overflow: "auto", p: 3 }}>
      <Box sx={{ maxWidth: 960, mx: "auto" }}>
        <Typography variant="h4" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
          Validation Criteria
        </Typography>

        {/* Summary — totals plus a colored tally per verification method */}
        <Box
          sx={{
            mt: 1,
            mb: statuses ? 1.5 : 3,
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

        {/* Run-outcome tally — only when a report is joined in */}
        {statuses && orderedStates.length > 0 && (
          <Box
            sx={{
              mb: 3,
              display: "flex",
              alignItems: "center",
              gap: 1,
              flexWrap: "wrap",
            }}
          >
            {orderedStates.map((s) => {
              const chip = STATE_CHIP[s] ?? { label: s, color: "default" as const };
              return (
                <Chip
                  key={s}
                  size="small"
                  variant="outlined"
                  color={chip.color}
                  label={`${chip.label} ${stateCounts.get(s) ?? 0}`}
                />
              );
            })}
          </Box>
        )}

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
}

export function ValidationView({ criteria, report }: ValidationViewProps) {
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
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Couldn't parse validation-criteria.json: {parsed.message}
        </Alert>
      </Box>
    );
  }
  return (
    <>
      {reportError && (
        <Box sx={{ px: 3, pt: 2 }}>
          <Alert severity="warning">
            Couldn't parse the validation report: {reportError.message}
          </Alert>
        </Box>
      )}
      <ValidationBody criteria={parsed} statuses={statuses} />
    </>
  );
}
