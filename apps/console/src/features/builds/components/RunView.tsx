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

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDuration } from "@aep/progress-view";
import { Alert, Box, Button, ButtonBase, LinearProgress, Skeleton, Typography } from "@wso2/oxygen-ui";
import { ChevronRight } from "@wso2/oxygen-ui-icons-react";
import type { components } from "../../../generated/aep-api";
import { PHONE } from "../../shell/layout";
import { refreshBuilds } from "../api/builds";
import { deliveryRun, isTerminalRun, useBuildRuns } from "../api/runs";
import { useBuildOutcome } from "../hooks/useBuildOutcome";
import { useNextInterview } from "../hooks/useNextInterview";
import { useRunProgress } from "../hooks/useRunProgress";
import { fixedBy, isBuilding, type VersionRow } from "../model/ledger";
import { nextSteps } from "../model/nextSteps";
import { runStatus, runSteps, type RunPhase } from "../model/phases";
import { NextStepsBar } from "./NextStepsBar";
import { LogTail, StepIcon } from "./RunParts";
import { ValidationByFeature, ValidationToCome } from "./ValidationByFeature";

// One version's build, live: its steps in order, each opening to its log;
// then its validation, grouped by feature; then, once it has finished, what it
// offers next. Copied in spirit from the old console's Builds page (BuildsPage,
// BuildDetailPage, RunNowPanel), keeping their transport: the run rows poll
// (useBuildRuns), the run itself streams (useRunProgress), and the validation
// attempt's report is read at its commit (useValidationSnapshot).

type MilestoneRunView = components["schemas"]["MilestoneRunView"];

function Heading({ title, sub }: { title: string; sub: string }) {
  return (
    <Typography component="h3" sx={{ fontSize: "0.9375rem", fontWeight: 600, mt: 1, display: "flex", gap: 1, alignItems: "baseline", flexWrap: "wrap" }}>
      {title}
      <Typography component="span" variant="caption" color="text.secondary">
        {sub}
      </Typography>
    </Typography>
  );
}

function PhaseMeta({ phase }: { phase: RunPhase }) {
  if (phase.state === "done") {
    return <>{phase.durationMs !== null ? formatDuration(phase.durationMs) : "done"}</>;
  }
  if (phase.state === "live") {
    const count = phase.count;
    return count && count.total > 0 ? (
      <LinearProgress variant="determinate" value={(count.done / count.total) * 100} aria-label={`${phase.label}: ${count.done} of ${count.total}`} />
    ) : (
      <LinearProgress aria-label={`${phase.label} running`} />
    );
  }
  return <>{phase.state === "failed" ? "failed" : "queued"}</>;
}

function PhaseRow({ phase, open, onToggle }: { phase: RunPhase; open: boolean; onToggle: () => void }) {
  return (
    <Box sx={{ "& + &": { borderTop: 1, borderColor: "divider" } }}>
      <ButtonBase
        onClick={onToggle}
        aria-expanded={open}
        sx={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "20px minmax(0, 1fr) minmax(60px, 140px) 16px",
          [PHONE]: { gridTemplateColumns: "20px minmax(0, 1fr) 52px 16px", gap: 1 },
          gap: 1.25,
          alignItems: "center",
          textAlign: "start",
          px: 1.5,
          py: 1.125,
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <StepIcon state={phase.state} />
        <Typography component="span" variant="body2" color={phase.state === "queued" ? "text.secondary" : "text.primary"} sx={{ minWidth: 0 }}>
          {phase.label}
        </Typography>
        <Box component="span" sx={{ fontFamily: "monospace", fontSize: "0.75rem", color: "text.secondary", textAlign: "end" }}>
          <PhaseMeta phase={phase} />
        </Box>
        <ChevronRight
          size={14}
          aria-hidden
          style={{ transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "none" }}
        />
      </ButtonBase>
      {open && <LogTail lines={phase.log} empty={phase.state === "queued" ? "Not started." : "Starting…"} />}
    </Box>
  );
}

const TONE_COLOUR = { primary: "primary.main", success: "success.main", warning: "warning.main", error: "error.main" } as const;

function Section({ children }: { children: ReactNode }) {
  return <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>{children}</Box>;
}

export function RunView({ projectName, row, rows }: { projectName: string; row: VersionRow; rows: VersionRow[] }) {
  const runs = useBuildRuns(projectName, row.version);
  const run = runs.data ? deliveryRun(runs.data.runs) : undefined;
  const progress = useRunProgress(projectName, run?.id);
  const steps = useMemo(() => runSteps(run, progress.cycles), [run, progress.cycles]);
  const liveValidation = progress.cycles.filter((c) => c.cycle.kind === "validation").at(-1)?.cycle;
  const result = useBuildOutcome(projectName, row.version, liveValidation);
  const nextInterview = useNextInterview(projectName);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // The stream's `done` frame says the run's terminal state before the run rows' next poll does.
  const runState = (progress.settledState as MilestoneRunView["state"] | undefined) ?? run?.state;
  // The stream's end is the run's end: the ledger, the run rows, the builds
  // list (and so the track and the picker) are read again at once rather than
  // at their next poll.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (progress.phase === "ended" && run && !isTerminalRun(run.state)) refreshBuilds(queryClient, projectName);
  }, [progress.phase, run, queryClient, projectName]);

  if (runs.isError) {
    return (
      <Alert severity="error" action={<Button onClick={() => void runs.refetch()}>Retry</Button>}>
        Couldn't load {row.version}'s build: {runs.error.message}
      </Alert>
    );
  }
  if (runs.isPending) return <Skeleton variant="rounded" height={160} />;

  const settled = runState !== undefined && isTerminalRun(runState);
  // The run has cycles the stream has not replayed yet: its steps are not known until it has.
  const replaying = progress.cycles.length === 0 && (run?.cycles.length ?? 0) > 0;
  const status = runStatus(runState, steps, result.outcome);
  const fix = fixedBy(rows, row.version);
  const next =
    settled && result.outcome
      ? nextSteps({
          version: row.version,
          outcome: result.outcome,
          fixedBy: fix ? { version: fix.version, building: isBuilding(fix.status) } : null,
          latest: rows[0]?.version ?? row.version,
          nextInterview,
        })
      : null;

  return (
    <Box sx={{ maxWidth: 860, display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
        <Typography variant="caption" sx={{ letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, color: "text.secondary" }}>
          {row.fixes ? `Build · fixes ${row.fixes}` : "Build"}
        </Typography>
        <Typography component="h2" sx={{ fontFamily: "monospace", fontSize: "1.375rem", fontWeight: 600, lineHeight: 1.2 }}>
          {row.version}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {row.features.join(", ")} · spec frozen as {row.version}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
          <Typography role="status" variant="body2" sx={{ fontWeight: 600, color: status.tone ? TONE_COLOUR[status.tone] : "text.secondary" }}>
            {status.text}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={settled ? 100 : steps.fraction * 100}
            aria-label="Build progress"
            sx={{ flex: 1, maxWidth: 320, minWidth: 120 }}
          />
        </Box>
      </Box>

      <Section>
        <Heading title="Steps" sub="open one for its log" />
        {replaying ? (
          <Skeleton variant="rounded" height={120} aria-label="Loading the run's steps" />
        ) : (
          <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2.5, overflow: "hidden" }}>
            {steps.phases.map((phase) => (
              <PhaseRow
                key={phase.key}
                phase={phase}
                open={open[phase.key] ?? phase.state === "live"}
                onToggle={() => setOpen((o) => ({ ...o, [phase.key]: !(o[phase.key] ?? phase.state === "live") }))}
              />
            ))}
          </Box>
        )}
      </Section>

      <Section>
        <Heading title="Validation" sub={`scenarios tagged by story, run against ${row.version}`} />
        {result.groups ? (
          <ValidationByFeature
            projectName={projectName}
            groups={result.groups}
            version={row.version}
            builtHere={row.fixes ? [] : row.featureIds}
            baseline={result.baseline}
            settled={Boolean(result.outcome)}
            failingActions={next && <NextStepsBar projectName={projectName} next={next} />}
          />
        ) : (
          <ValidationToCome features={row.features} />
        )}
      </Section>

      {next && (
        <Box sx={{ borderTop: 1, borderColor: "divider", pt: 1.75 }}>
          <NextStepsBar projectName={projectName} next={next} />
        </Box>
      )}
    </Box>
  );
}
