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

import {
  Alert,
  Box,
  ButtonBase,
  Chip,
  Collapse,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import {
  ChevronDown,
  ChevronRight,
  CircleMinus,
  ClipboardCheck,
} from "@wso2/oxygen-ui-icons-react";
import { useMemo, useState } from "react";
import {
  featureScenarios,
  parseFeatureFile,
  type AcceptanceFeature,
  type AcceptanceRule,
  type AcceptanceScenario,
  type AcceptanceStep,
} from "./parseFeature.js";
import {
  NO_RESULT_LABEL,
  NO_RESULT_NOTE,
  OUTCOME_ICON,
  outcomeLabel,
  outcomeTone,
  tallyOutcomes,
  tallySentence,
} from "./outcomes.js";
import {
  decidingStep,
  isReportParseError,
  parseAcceptanceReport,
  scenarioKey,
  type AcceptanceReport,
  type ReportScenario,
  type ReportStep,
} from "./report.js";

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

const mono = { fontFamily: "monospace" } as const;

/** The disclosure column. Every row has one, so it is never slack. */
const CHEVRON = 20;
/** The flex gap, in theme spacing units. */
const ROW_GAP = 1;
/** The shared band a row's first line occupies — the small Chip's own height. */
const ROW_LINE = 24;
/**
 * Where a row's CONTENT starts, and therefore where everything hanging off it
 * lines up: the reason line, the steps. Derived from the two constants above so
 * the column and the indent cannot drift apart.
 */
const INDENT = `${CHEVRON + 8}px`;

/** The keyword column. Wide enough for `Given`, which is the longest of them. */
const KEYWORD = 52;

/** A refusal, closing the sentence it qualifies. */
function NegativeMark() {
  return (
    <Tooltip title="A negative scenario — the product refuses, rejects or limits.">
      <Box component="span" sx={{ display: "inline-flex", alignItems: "center", ml: 0.75 }}>
        <Box
          component="span"
          sx={{ display: "inline-flex", color: "text.secondary", opacity: 0.55, verticalAlign: "-3px" }}
        >
          <CircleMinus size={14} />
        </Box>
        {/* Tooltip puts an aria-label on a bare span, and an aria-label on a
            roleless element is ignored — the same trap StatusChip documents for
            a Chip with no onClick. The name has to come from content. */}
        <Box component="span" sx={VISUALLY_HIDDEN}>
          Negative scenario
        </Box>
      </Box>
    </Tooltip>
  );
}

function OutcomeChip({ outcome }: { outcome: string }) {
  const Icon = OUTCOME_ICON[outcome];
  const tone = outcomeTone(outcome);
  return (
    <Chip
      size="small"
      variant="outlined"
      color={tone}
      {...(Icon ? { icon: <Icon size={14} /> } : {})}
      label={outcomeLabel(outcome)}
      sx={{ flexShrink: 0, "& .MuiChip-icon": { ml: 1 } }}
    />
  );
}

function NoResultChip() {
  return (
    <Tooltip title={NO_RESULT_NOTE}>
      <Chip size="small" variant="outlined" label={NO_RESULT_LABEL} sx={{ flexShrink: 0 }} />
    </Tooltip>
  );
}

interface RenderedStep {
  readonly keyword: string;
  readonly text: string;
  readonly command?: string;
  readonly exit?: number;
  readonly observed?: string;
  /** The run stopped before this step — it is spec, not evidence. */
  readonly unreached: boolean;
}

/**
 * Pairs the specification's steps with what the run did.
 *
 * The report's steps win where it has them: they carry the evidence and their
 * own `text`. Anything the specification has beyond them was never reached,
 * which is how a blocked scenario visibly STOPS partway — the thing the raw
 * JSON hides.
 */
function renderedSteps(
  spec: readonly AcceptanceStep[],
  reported: ReportScenario | undefined,
): readonly RenderedStep[] {
  if (reported === undefined) {
    return spec.map((s) => ({ keyword: s.keyword, text: s.text, unreached: false }));
  }
  const ran: RenderedStep[] = reported.steps.map((s) => ({ ...s, unreached: false }));
  const rest = spec.slice(ran.length).map((s) => ({
    keyword: s.keyword,
    text: s.text,
    unreached: true,
  }));
  return [...ran, ...rest];
}

function StepRow({ step }: { step: RenderedStep }) {
  return (
    <Box sx={{ display: "flex", gap: ROW_GAP, alignItems: "flex-start", py: 0.625, opacity: step.unreached ? 0.45 : 1 }}>
      <Typography
        variant="body2"
        sx={{ width: KEYWORD, flexShrink: 0, lineHeight: `${ROW_LINE}px`, color: "text.secondary", opacity: 0.72 }}
      >
        {step.keyword}
      </Typography>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="body2">{step.text}</Typography>
        {step.command !== undefined && (
          // Clamped, because a real one runs to 400 characters of `--fn`
          // predicate. It is provenance; `observed` below is the payload, and
          // that is never clamped.
          <Tooltip title={step.command}>
            <Typography
              variant="caption"
              sx={{
                ...mono,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                mt: 0.375,
                color: "text.secondary",
                opacity: 0.6,
                wordBreak: "break-word",
              }}
            >
              {step.command}
            </Typography>
          </Tooltip>
        )}
        {step.observed !== undefined && (
          <Typography variant="body2" sx={{ mt: 0.375, opacity: 0.82 }}>
            {step.observed}
          </Typography>
        )}
      </Box>
      {step.unreached ? (
        <Typography
          variant="caption"
          sx={{ flexShrink: 0, lineHeight: `${ROW_LINE}px`, color: "text.secondary" }}
        >
          not reached
        </Typography>
      ) : (
        // Only a nonzero exit is worth a mark. A green tick on every step would
        // put one on the very step that blocked a scenario, whose command
        // succeeded at proving the control was absent.
        step.exit !== undefined &&
        step.exit !== 0 && (
          <Typography
            variant="caption"
            sx={{ ...mono, flexShrink: 0, lineHeight: `${ROW_LINE}px`, color: "error.main" }}
          >
            {`exit ${step.exit}`}
          </Typography>
        )
      )}
    </Box>
  );
}

interface ScenarioRowProps {
  readonly scenario: AcceptanceScenario;
  readonly reported: ReportScenario | undefined;
  readonly hasRun: boolean;
  readonly awaiting: boolean;
  readonly open: boolean;
  readonly onToggle: () => void;
}

function ScenarioRow({ scenario, reported, hasRun, awaiting, open, onToggle }: ScenarioRowProps) {
  const steps = renderedSteps(scenario.steps, reported);
  const why =
    reported !== undefined && reported.outcome !== "passed"
      ? decidingStep(reported)?.observed
      : undefined;

  return (
    <Box sx={{ py: 1 }}>
      <ButtonBase
        onClick={onToggle}
        aria-expanded={open}
        sx={{
          width: "100%",
          display: "flex",
          gap: ROW_GAP,
          alignItems: "flex-start",
          textAlign: "left",
          px: 1,
          mx: -1,
          borderRadius: 1,
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: ROW_LINE,
            width: CHEVRON,
            flexShrink: 0,
            color: "text.secondary",
            opacity: 0.45,
          }}
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </Box>
        <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0, lineHeight: `${ROW_LINE}px` }}>
          {scenario.name}
          {scenario.negative && <NegativeMark />}
        </Typography>
        {hasRun && (
          <Box sx={{ display: "flex", alignItems: "center", height: ROW_LINE, flexShrink: 0 }}>
            {reported !== undefined ? (
              <OutcomeChip outcome={reported.outcome} />
            ) : awaiting ? null : (
              <NoResultChip />
            )}
          </Box>
        )}
      </ButtonBase>

      {/* With nothing open by default this is the only thing on the page saying
          WHY, so a reader can triage without opening anything. */}
      {!open && why !== undefined && (
        <Typography
          variant="body2"
          sx={{
            ml: INDENT,
            mt: 0.25,
            opacity: 0.72,
            display: "-webkit-box",
            WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {why}
        </Typography>
      )}

      <Collapse in={open} unmountOnExit>
        <Box sx={{ ml: INDENT, mt: 0.75 }}>
          {steps.length === 0 ? (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              This scenario records no steps.
            </Typography>
          ) : (
            steps.map((s, i) => <StepRow key={`${s.keyword}-${i}`} step={s} />)
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

interface RuleCardProps {
  readonly feature: AcceptanceFeature;
  readonly rule: AcceptanceRule;
  readonly report: AcceptanceReport | undefined;
  readonly awaiting: boolean;
  readonly openKeys: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
}

function RuleCard({ feature, rule, report, awaiting, openKeys, onToggle }: RuleCardProps) {
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2, mb: 3 }}>
      {(rule.text !== "" || rule.tags.length > 0) && (
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: ROW_GAP, mb: 1.5 }}>
          <Typography
            variant="body1"
            sx={{ fontWeight: 500, flexGrow: 1, minWidth: 0, lineHeight: `${ROW_LINE}px` }}
          >
            {rule.text}
          </Typography>
          {rule.tags.length > 0 && (
            <Box sx={{ display: "flex", gap: 0.75, flexShrink: 0 }}>
              {rule.tags.map((t) => (
                <Typography
                  key={t}
                  variant="caption"
                  sx={{ ...mono, lineHeight: `${ROW_LINE}px`, color: "text.secondary", opacity: 0.65 }}
                >
                  {t}
                </Typography>
              ))}
            </Box>
          )}
        </Box>
      )}
      <Box sx={{ "& > *": { borderTop: 1, borderColor: "divider" } }}>
        {rule.scenarios.map((scenario) => {
          const key = scenarioKey(feature.name, rule.text, scenario.name);
          return (
            <ScenarioRow
              key={key}
              scenario={scenario}
              reported={report?.byKey.get(key)}
              hasRun={report !== undefined}
              awaiting={awaiting}
              open={openKeys.has(key)}
              onToggle={() => onToggle(key)}
            />
          );
        })}
      </Box>
    </Box>
  );
}

function FeatureSection({
  feature,
  report,
  awaiting,
  openKeys,
  onToggle,
}: Omit<RuleCardProps, "rule">) {
  const all = featureScenarios(feature);
  const meta = useMemo(() => {
    if (report !== undefined) {
      const reported = all
        .map(({ rule, scenario }) => report.byKey.get(scenarioKey(feature.name, rule.text, scenario.name)))
        .filter((s): s is ReportScenario => s !== undefined);
      return tallySentence(tallyOutcomes(reported));
    }
    const refusals = all.filter(({ scenario }) => scenario.negative).length;
    const parts = [
      `${feature.rules.length} ${feature.rules.length === 1 ? "rule" : "rules"}`,
      `${all.length} ${all.length === 1 ? "scenario" : "scenarios"}`,
    ];
    if (refusals > 0) parts.push(`${refusals} ${refusals === 1 ? "refusal" : "refusals"}`);
    return parts.join(" · ");
  }, [all, feature, report]);

  return (
    <Box sx={{ mb: 5 }}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 2, mb: 1.75 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {feature.name}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", opacity: 0.7 }}>
          {meta}
        </Typography>
      </Box>
      {feature.background.length > 0 && (
        <Box sx={{ mb: 2, ml: INDENT }}>
          <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 700, letterSpacing: "0.08em" }}>
            BACKGROUND
          </Typography>
          {feature.background.map((s, i) => (
            <StepRow key={`bg-${i}`} step={{ keyword: s.keyword, text: s.text, unreached: false }} />
          ))}
        </Box>
      )}
      {feature.rules.map((rule, i) => (
        <RuleCard
          key={`${rule.text}-${i}`}
          feature={feature}
          rule={rule}
          report={report}
          awaiting={awaiting}
          openKeys={openKeys}
          onToggle={onToggle}
        />
      ))}
    </Box>
  );
}

/** Scenarios the run answered that the specification no longer declares. */
function OrphanSection({
  orphans,
  openKeys,
  onToggle,
}: {
  readonly orphans: readonly ReportScenario[];
  readonly openKeys: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
}) {
  return (
    <Box sx={{ mb: 5, opacity: 0.75 }}>
      <Typography
        variant="caption"
        sx={{ display: "block", mb: 1, fontWeight: 700, letterSpacing: "0.08em", color: "text.secondary" }}
      >
        NOT IN THE CURRENT SPECIFICATION
      </Typography>
      <Typography variant="body2" sx={{ mb: 1.5, color: "text.secondary", maxWidth: 720 }}>
        {orphans.length === 1
          ? "This run answered one scenario that has since been rewritten or removed. It is kept so the run's record stays complete."
          : `This run answered ${orphans.length} scenarios that have since been rewritten or removed. They are kept so the run's record stays complete.`}
      </Typography>
      <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}>
        <Box sx={{ "& > * + *": { borderTop: 1, borderColor: "divider" } }}>
          {orphans.map((s) => {
            const key = scenarioKey(s.feature, s.rule, s.scenario);
            return (
              <ScenarioRow
                key={key}
                scenario={{ name: s.scenario, line: s.line ?? 0, tags: [], negative: false, steps: [] }}
                reported={s}
                hasRun
                awaiting={false}
                open={openKeys.has(key)}
                onToggle={() => onToggle(key)}
              />
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

export interface AcceptanceFeatureSource {
  /** Repo-relative, e.g. `specs/acceptance/bought-items.feature`. */
  readonly path: string;
  readonly content: string;
}

export interface AcceptanceViewProps {
  readonly features: readonly AcceptanceFeatureSource[];
  /** Raw `tests/acceptance/report.json`. Omit for the specification alone. */
  readonly report?: string;
  readonly noPadding?: boolean;
  readonly fullWidth?: boolean;
  readonly hideDescription?: boolean;
  /**
   * An attempt is in flight, so a scenario the report does not cover is not yet
   * a scenario the run declined to cover — it gets no chip rather than
   * `No result`.
   */
  readonly awaitingReport?: boolean;
}

export function AcceptanceView({
  features,
  report: rawReport,
  noPadding = false,
  fullWidth = false,
  hideDescription = false,
  awaitingReport = false,
}: AcceptanceViewProps) {
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const parsed = useMemo(
    () =>
      features
        .map((f) => parseFeatureFile(f.path, f.content))
        .filter((f): f is AcceptanceFeature => f !== null),
    [features],
  );

  const reportResult = useMemo(
    () => (rawReport === undefined ? undefined : parseAcceptanceReport(rawReport)),
    [rawReport],
  );
  const reportError =
    reportResult !== undefined && isReportParseError(reportResult) ? reportResult.error : undefined;
  const report =
    reportResult !== undefined && !isReportParseError(reportResult) ? reportResult : undefined;

  const orphans = useMemo(() => {
    if (report === undefined) return [];
    const known = new Set(
      parsed.flatMap((f) =>
        featureScenarios(f).map(({ rule, scenario }) => scenarioKey(f.name, rule.text, scenario.name)),
      ),
    );
    return report.scenarios.filter(
      (s) => !known.has(scenarioKey(s.feature, s.rule, s.scenario)),
    );
  }, [parsed, report]);

  const totals = useMemo(() => {
    const all = parsed.flatMap(featureScenarios);
    const refusals = all.filter(({ scenario }) => scenario.negative).length;
    const rules = parsed.reduce((n, f) => n + f.rules.length, 0);
    const parts = [
      `${parsed.length} ${parsed.length === 1 ? "capability" : "capabilities"}`,
      `${rules} ${rules === 1 ? "rule" : "rules"}`,
      `${all.length} ${all.length === 1 ? "scenario" : "scenarios"}`,
    ];
    if (refusals > 0) parts.push(`${refusals} ${refusals === 1 ? "refusal" : "refusals"}`);
    return parts.join(" · ");
  }, [parsed]);

  const body =
    parsed.length === 0 && orphans.length === 0 ? (
      <Box
        sx={{
          textAlign: "center",
          py: 8,
          px: 2,
          border: 1,
          borderStyle: "dashed",
          borderColor: "divider",
          borderRadius: 2,
        }}
      >
        <Box sx={{ display: "flex", justifyContent: "center", opacity: 0.3, mb: 2 }}>
          <ClipboardCheck size={48} />
        </Box>
        <Typography variant="h6" gutterBottom>
          No acceptance criteria yet
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 480, mx: "auto" }}>
          They are written from your requirements when the design is generated.
        </Typography>
      </Box>
    ) : (
      <>
        {parsed.map((feature) => (
          <FeatureSection
            key={feature.file}
            feature={feature}
            report={report}
            awaiting={awaitingReport}
            openKeys={openKeys}
            onToggle={toggle}
          />
        ))}
        {orphans.length > 0 && (
          <OrphanSection orphans={orphans} openKeys={openKeys} onToggle={toggle} />
        )}
      </>
    );

  return (
    <Box sx={{ height: "100%", overflow: "auto", ...(noPadding ? {} : { p: 3 }) }}>
      <Box sx={fullWidth ? undefined : { maxWidth: 960, mx: "auto" }}>
        {/* The heading belongs to the specification view. On the Validations
            page the page title already says Validations, and a second heading
            under the verdict would repeat it — which is naming rule 1. */}
        {report === undefined && reportError === undefined && (
          <>
            <Typography variant="h4" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              Acceptance criteria
            </Typography>
            {!hideDescription && (
              <Typography variant="body2" sx={{ mt: 1, maxWidth: 720, color: "text.secondary" }}>
                Each scenario is one concrete example of a rule your product must follow, taken from
                your requirements alone. After every deployment they are driven against the deployed
                system and the results appear under Validations. To change one, ask the agent.
              </Typography>
            )}
            <Typography variant="caption" sx={{ display: "block", mt: 0.5, mb: 4, color: "text.secondary", opacity: 0.7 }}>
              {totals}
            </Typography>
          </>
        )}

        {reportError !== undefined && (
          <Alert severity="warning" sx={{ mb: 3 }}>
            {`The last run's report could not be read (${reportError}), so this is the specification alone.`}
          </Alert>
        )}

        {report !== undefined && <ReportProvenance report={report} />}

        {body}
      </Box>
    </Box>
  );
}

function ReportProvenance({ report }: { report: AcceptanceReport }) {
  const [open, setOpen] = useState(false);
  const facts = [
    report.commit?.slice(0, 7),
    report.baseUrl,
    report.generatedAt,
  ].filter((f): f is string => f !== undefined && f !== "");

  return (
    <Box sx={{ mb: 3.5 }}>
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
        <Typography
          variant="caption"
          sx={{ ...mono, flexGrow: 1, minWidth: 0, color: "text.secondary", opacity: 0.7, wordBreak: "break-all" }}
        >
          {facts.join(" · ")}
        </Typography>
        {report.isolation !== undefined && (
          <ButtonBase
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            sx={{ flexShrink: 0, gap: 0.5, borderRadius: 1, px: 0.5, color: "text.secondary", opacity: 0.8 }}
          >
            <Typography variant="caption">How the scenarios were kept apart</Typography>
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </ButtonBase>
        )}
      </Box>
      {report.isolation !== undefined && (
        <Collapse in={open} unmountOnExit>
          {/* A neutral tint with no border: a rule down a leading edge means
              "this needs reading", and provenance is not that. */}
          <Box sx={{ mt: 1, p: 2, borderRadius: 1, bgcolor: "action.hover" }}>
            <Typography variant="body2" sx={{ opacity: 0.85 }}>
              {report.isolation}
            </Typography>
          </Box>
        </Collapse>
      )}
    </Box>
  );
}

export type { ReportStep };
