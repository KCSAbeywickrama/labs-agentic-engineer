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

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Stack,
  Typography,
  alpha,
} from "@wso2/oxygen-ui";
import { X } from "@wso2/oxygen-ui-icons-react";
import { StatusChip } from "../../../components/StatusChip";
import type { components } from "../../../generated/aep-api";
import { useCancelRun, useCycleBuilds } from "../api/queries";
import { useRunProgress } from "../hooks/useRunProgress";
import { provisioningStage } from "../lib/provisioning";
import { buildGlance } from "../lib/runGlance";
import {
  BUILD_CYCLE_KINDS,
  buildSessionLabel,
  isTerminalRun,
  runHold,
  runOriginLabel,
  runStateChip,
  spentBudgets,
  terminalReasonText,
} from "../lib/runView";
import { sessionIssues, sessionStages } from "../lib/sessionSpine";
import { runDuration, runStamp } from "../lib/format";
import { EarlierSessions } from "./EarlierSessions";
import { ProvisioningGates } from "./ProvisioningGates";
import { RunDelivered } from "./RunDelivered";
import { RunGlanceStrip } from "./RunGlanceStrip";
import { RunHoldNotice } from "./RunHoldNotice";
import { RunNowPanel } from "./RunNowPanel";

type MilestoneRunView = components["schemas"]["MilestoneRunView"];
type TaskView = components["schemas"]["TaskView"];


/**
 * One run of the version's milestone loop, NOW-FIRST.
 *
 * The flow is a strip — every stage on one line, the current one badged — and
 * only that stage gets words. This replaced a rail that rendered all six stages
 * expanded, each with its note, issues and a 420px log: correct for reading a
 * finished run end to end, and far too much for the question a reader actually
 * arrives with, which is what is happening right now.
 *
 * What is NOT lost: every stage keeps its note in the strip's tooltip, the
 * agent's log is one click down in the NOW panel's drawer, and each issue links
 * to its own page. What IS lost is reading every stage's detail at once — the
 * deliberate trade the redesign makes.
 *
 * Cancel is PROMINENT on a waiting run, quiet on a running one, and ABSENT
 * while planning: cancel is a signal to the supervisor, and during the plan
 * window there is no supervisor yet to receive it.
 */
export function RunStory({
  projectName,
  tag,
  run,
  milestone,
}: {
  projectName: string;
  tag: string;
  run: MilestoneRunView;
  /** The milestone's issue plane, or undefined while it is still loading. */
  milestone?: { gates: TaskView[]; work: TaskView[] };
}) {
  const cancel = useCancelRun(projectName, tag);
  const chip = runStateChip(run);
  const terminal = isTerminalRun(run.state);
  const waiting = run.state === "waiting";
  const planning = run.state === "planning";
  const work = milestone?.work ?? [];
  const gates = milestone?.gates ?? [];

  const hold = runHold(
    run,
    milestone && {
      gates: milestone.gates,
      openWork: milestone.work.filter((t) => t.derivedStatus === "pending").length,
    },
  );
  const reason = terminalReasonText(run.terminalReason ?? "");
  const spent = spentBudgets(run.budgets);
  const started = runStamp(run.startedAt ?? run.createdAt);
  const ended = runStamp(run.endedAt);
  // How long it has been going, or took — the design's "· 18 min". A live run
  // re-renders this on the runs poll, so it stays honest without a timer.
  const span = runDuration(run.startedAt ?? run.createdAt, run.endedAt);
  // A spent budget on a succeeded run is a footnote, not an alarm.
  const tone = run.state === "succeeded" ? "text.secondary" : "error.main";

  // Validation is not this surface's session — the deployment is what gets
  // validated, and its verdict renders there.
  const cycles = run.cycles.filter((c) =>
    (BUILD_CYCLE_KINDS as readonly string[]).includes(c.kind),
  );
  // The glance narrates the CURRENT build session. Earlier sessions of the same
  // run are history the strip cannot show without becoming the rail again — the
  // session label says which one the reader is looking at.
  const current = cycles.at(-1);
  const sessionIndex = cycles.length - 1;

  // A settled run opens no stream until asked; a live one streams unprompted,
  // because it is what the reader came to watch.
  const [logRequested, setLogRequested] = useState(false);
  const showLog = !terminal || logRequested;
  const progress = useRunProgress(projectName, run.id, showLog);
  const { data: builds } = useCycleBuilds(
    projectName,
    tag,
    current?.id ?? "",
    Boolean(current?.mergeSha),
  );

  const provisioning = provisioningStage(gates);
  const stages = current ? sessionStages({ cycle: current, work, builds }) : [];
  // Numbered WITHIN the strip, not across the run. The rail this replaced
  // counted straight through every session (…6, 7, 8) because all of them were
  // on screen at once; the strip shows one session, so run-wide numbering read
  // as "step 7 of 5". Which session it is comes from the label above instead.
  const glance = buildGlance(stages);
  const issues = current ? sessionIssues(current, work) : undefined;
  const lines = current
    ? (progress.cycles.find((c) => c.cycle.id === current.id)?.lines ?? [])
    : [];

  // The card carries the run's state in its EDGE, not in a fill: a live run is
  // ringed in its own tone so the eye lands on it before reading a word, while
  // the surface stays quiet enough for the strip and the log to sit on it.
  const edge = chip.tone === "neutral" ? null : chip.tone;

  return (
    <Card
      variant="outlined"
      sx={{
        bgcolor: (t) => alpha(t.palette.text.primary, 0.02),
        ...(edge && {
          borderColor: (t) => alpha(t.palette[edge].main, 0.35),
        }),
      }}
    >
      <CardContent sx={{ "&:last-child": { pb: 2.5 } }}>
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
        >
          <Typography variant="h6">{run.milestoneTitle}</Typography>
          <StatusChip label={chip.label} tone={chip.tone} appearance="soft" dot />
          <StatusChip label={runOriginLabel(run.origin)} tone="neutral" appearance="soft" />
          <Typography variant="body2" color="text.secondary">
            {started ? `Started ${started}` : ""}
            {ended ? ` → ${ended}` : ""}
            {span ? ` · ${span}` : ""}
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          {!terminal && !planning && (
            // Quiet by design: cancelling a run is a destructive escape hatch,
            // not the thing a reader came to do. A filled button here competed
            // with the stage strip for the eye and read as the page's primary
            // action. Waiting keeps a warning outline — the state where cancel
            // is most often what you want — without shouting.
            <Button
              size="small"
              color={waiting ? "warning" : "inherit"}
              variant="outlined"
              startIcon={<X size={16} />}
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(run.id)}
              sx={{ borderRadius: 999 }}
            >
              {cancel.isPending ? "Cancelling…" : "Cancel run"}
            </Button>
          )}
        </Stack>

        {hold && (
          <RunHoldNotice
            tone={hold.tone}
            title={hold.title}
            body={hold.body}
            busy={hold.kind === "planning"}
          />
        )}

        {cancel.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {cancel.error instanceof Error ? cancel.error.message : "Failed to cancel the run"}
            . Nothing was cancelled — you can retry.
          </Alert>
        )}

        {(reason || spent.length > 0) && (
          <Stack spacing={0.5} sx={{ mt: 2 }}>
            {reason && (
              <Typography variant="body2" color={tone}>
                {reason}
              </Typography>
            )}
            {spent.length > 0 && (
              <Typography variant="caption" color={tone} sx={{ fontVariantNumeric: "tabular-nums" }}>
                {`Budget spent: ${spent.map((b) => `${b.label} ${b.text}`).join(" · ")}`}
              </Typography>
            )}
          </Stack>
        )}

        {/* A planning run has provably no build sessions — the supervisor that
            dispatches them has not been started yet. */}
        {!planning && (
          <>
            <Divider sx={{ my: 2 }} />

            {/* Open gates hold every session, so they stay expanded: "why is
                nothing moving" is answered where movement stopped. */}
            {provisioning && provisioning.state !== "done" && (
              <Box sx={{ mb: 2 }}>
                <ProvisioningGates
                  projectName={projectName}
                  gates={gates}
                  state={provisioning.state}
                />
              </Box>
            )}

            {current ? (
              <Stack spacing={2}>
                {/* Sessions behind the current one — the loop, kept visible. */}
                <EarlierSessions cycles={cycles.slice(0, -1)} />
                {sessionIndex > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    {buildSessionLabel(current, sessionIndex)}
                  </Typography>
                )}
                <RunGlanceStrip stages={glance.stages} nowIndex={glance.nowIndex} />
                {/* A succeeded run whose flow actually finished has no "now" to
                    narrate: what it produced, and where that now lives, is the
                    whole story. The nowIndex check is not redundant — a run can
                    be marked succeeded while a stage is still unreadable (the
                    console cannot see this merge's builds yet), and claiming
                    "all done" over a strip that says "Builds · now" would be
                    the surface contradicting itself. */}
                {run.state === "succeeded" && glance.nowIndex === null ? (
                  <RunDelivered
                    projectName={projectName}
                    milestoneTitle={run.milestoneTitle}
                    cycles={cycles}
                    work={work}
                    {...(run.endedAt ? { endedAt: run.endedAt } : {})}
                  />
                ) : (
                  <RunNowPanel
                    glance={glance}
                    issues={issues?.issues ?? []}
                    {...(issues?.caption ? { issuesCaption: issues.caption } : {})}
                    lines={lines}
                    logPhase={progress.phase}
                    showLog={showLog}
                    onOpenLog={() => setLogRequested(true)}
                  />
                )}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No build session has been dispatched yet — the run is waiting on
                its dispatch predicate.
              </Typography>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
