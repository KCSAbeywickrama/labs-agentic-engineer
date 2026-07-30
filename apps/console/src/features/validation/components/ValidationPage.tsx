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
  Button,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
} from "@wso2/oxygen-ui";
import { FileText, GitPullRequest, ScrollText } from "@wso2/oxygen-ui-icons-react";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  parseValidationCriteria,
  parseValidationReport,
  tallyCriterionStates,
  ValidationView,
  type CriterionTally,
} from "@aep/ui-validation-view";
import { PageHeader, type PageHeaderStatus } from "../../../components/PageHeader";
import type { StatusTone } from "../../../components/StatusChip";
import { EmptyState } from "../../../components/EmptyState";
import { useProjectStatus } from "../../projects/api/queries";
import { useBuildRuns } from "../../builds/api/queries";
import { RunFeed } from "../../builds/components/RunFeed";
import { validationView, type StageTone } from "../../projects/lib/pipeline";
import { useValidationCriteria, useValidationReport } from "../api/queries";
import { VerdictTile } from "./VerdictTile";

// Validation lives on the DEPLOYMENT surface because the deployment is what is
// being validated. Its verdict is a RUN property — read from the version's run
// story (list-build-runs), which is the only place the platform keeps it; there
// is no validation endpoint. The page joins that verdict with the authored
// oracle (specs/validation/validation-criteria.json) and the runner's committed
// report, both read at HEAD through the Files API.

// The validation cycle is the phase of the run this page owns; the rest of the
// loop is the Builds page's story.
const VALIDATION_CYCLE = ["validation"] as const;

// StageTone → StatusTone. The two unions differ only in `ghost`, which the shared
// validation mapper never returns; it is mapped for exhaustiveness only.
const TONE_TO_STATUS: Record<StageTone, StatusTone> = {
  ghost: "neutral",
  neutral: "neutral",
  info: "info",
  warning: "warning",
  success: "success",
  error: "error",
};

// Header chip for the run's verdict, falling back to the coarse lifecycle state
// while no verdict exists yet. DERIVED from the shared mapper rather than
// restating its cases, so this page's chip cannot drift from the deployments
// board's — the drift that left `partial`, `inconclusive` and `unreported`
// chipless here while the board named them correctly.
function headerChip(
  verdict: ReturnType<typeof validationView>,
  running: boolean,
): PageHeaderStatus | undefined {
  if (verdict) {
    return {
      // The shared labels are lowercase for mid-sentence use; the chip leads.
      label: verdict.label.charAt(0).toUpperCase() + verdict.label.slice(1),
      tone: TONE_TO_STATUS[verdict.tone],
    };
  }
  return running ? { label: "Validating", tone: "info" } : undefined;
}

// The oracle joined with the run's report, as counts. Parsed here rather than
// reaching into ValidationView's internals: the tile's copy names run concepts
// (`validation-unreported`, the milestone staying open) that the shared view
// package knows nothing about, and a second JSON.parse of a few-KB file inside a
// useMemo is a cheaper price than teaching that package about runs.
function useTally(
  criteria: string | undefined,
  report: string | undefined,
): CriterionTally | undefined {
  return useMemo(() => {
    if (!criteria) return undefined;
    const oracle = parseValidationCriteria(criteria);
    if ("kind" in oracle) return undefined;
    const parsed = report ? parseValidationReport(report) : undefined;
    const statuses = parsed && !("kind" in parsed) ? parsed : undefined;
    return tallyCriterionStates(oracle, statuses);
  }, [criteria, report]);
}

/**
 * The Validation page: a read-only report of the deployed system against its
 * acceptance criteria, plus the validation cycle's live log. No writes.
 */
export function ValidationPage({
  projectName,
  view,
  onViewChange,
}: {
  projectName: string;
  view: "logs" | undefined;
  onViewChange: (view: "logs" | undefined) => void;
}) {
  const status = useProjectStatus(projectName);
  const deploy = status.data?.deploy;
  const version = deploy?.version ?? "";
  const running = deploy?.validation === "running";

  // The deployed version's runs: the newest is the one that landed it, and its
  // validation record is this page's subject.
  const runs = useBuildRuns(projectName, version || undefined);
  const run = runs.data?.runs?.[0];
  // The verdict VALUE drives every decision below. Deriving them from the chip's
  // rendered label instead (as this page used to) breaks silently the moment the
  // copy changes — and swapping in the shared mapper changes its casing.
  const rawVerdict = run?.validation?.verdict ?? "";
  const verdict = validationView(rawVerdict);
  const reportPath = run?.validation?.reportPath ?? "";
  const validationCycle = run?.cycles?.find((c) => c.kind === "validation");
  // The cycle carries the pull request's page as the webhook reported it. This
  // page used to build one from the project's repoUrl and the number, which is a
  // CLONE url — a `.git` suffix produced a link that 404s.
  const prUrl = validationCycle?.prUrl;

  // The run reached an ANSWER — which is not the same as "everything passed", and
  // not the same as "there is a report". Hooks stay unconditional; `enabled` gates
  // them.
  const settled = rawVerdict !== "" && rawVerdict !== "skipped";
  // `unreported` MEANS no report was committed at that commit, and the server
  // omits reportPath for it. Requesting the file anyway would 404 to rediscover
  // what the verdict already told us, and land the reader on a vague "wasn't
  // found" note instead of the tile that explains the breach.
  const missingReport = rawVerdict === "unreported";
  const criteria = useValidationCriteria(projectName, version, settled);
  // Pinned to THIS run's validation-cycle merge commit. Reading the branch tip
  // would show whichever run last overwrote the path — so an older run in the story
  // would display the newest run's results, and a run that committed no report
  // would silently inherit its predecessor's.
  const report = useValidationReport(
    projectName,
    version,
    settled && !missingReport,
    reportPath,
    validationCycle?.mergeSha,
  );
  const tally = useTally(criteria.data?.content, report.data?.content);

  // Body rule: the log shows while there is no report to show (running, failed
  // mechanically, nothing settled yet) OR the user toggled ?view=logs.
  const showLogs = !settled || view === "logs";

  // The verdict tile stays visible in BOTH bodies — a verdict does not stop being
  // true because the reader switched to the log.
  const tile = settled ? (
    <VerdictTile verdict={rawVerdict} {...(tally ? { tally } : {})} />
  ) : null;

  const chip = headerChip(verdict, running);
  const header = (
    <PageHeader
      title="Validation"
      backTo={{
        link: <Link to="/projects/$projectName" params={{ projectName }} />,
        label: "Back to Overview",
      }}
      {...(chip ? { status: chip } : {})}
      actions={
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          {prUrl && (
            <Tooltip title="Open the validation PR">
              <IconButton
                component="a"
                href={prUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Validation pull request"
              >
                <GitPullRequest size={18} />
              </IconButton>
            </Tooltip>
          )}
          {settled &&
            (showLogs ? (
              <Button
                size="small"
                variant="outlined"
                startIcon={<FileText size={16} />}
                onClick={() => onViewChange(undefined)}
              >
                View report
              </Button>
            ) : (
              <Button
                size="small"
                variant="outlined"
                startIcon={<ScrollText size={16} />}
                onClick={() => onViewChange("logs")}
              >
                View logs
              </Button>
            ))}
        </Stack>
      }
    />
  );

  if (status.isPending || (version !== "" && runs.isPending)) {
    return (
      <>
        {header}
        <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
          <CircularProgress aria-label="Loading validation" />
        </Box>
      </>
    );
  }

  if (status.isError) {
    return (
      <>
        {header}
        <Alert
          severity="error"
          action={<Button onClick={() => void status.refetch()}>Retry</Button>}
        >
          Failed to load validation
          {status.error instanceof Error && status.error.message
            ? `: ${status.error.message}`
            : ""}
        </Alert>
      </>
    );
  }

  // Nothing to show: no deployed version, or its run never reached validation.
  if (!run || (!validationCycle && !verdict)) {
    return (
      <>
        {header}
        <EmptyState
          compact
          description="No validation has run yet — it runs automatically once the project's components are deployed to dev and the version's work is done."
        />
      </>
    );
  }

  if (rawVerdict === "skipped") {
    return (
      <>
        {header}
        <EmptyState
          compact
          description="This version was not validated — it has no acceptance criteria, or it was an incident run, which gets no validation cycle."
        />
      </>
    );
  }

  if (showLogs) {
    return (
      <>
        {header}
        {tile}
        <RunFeed
          projectName={projectName}
          runId={run.id}
          cycleKinds={VALIDATION_CYCLE}
        />
      </>
    );
  }

  return (
    <>
      {header}
      {tile}
      {criteria.isPending || (!criteria.isError && !criteria.data) ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
          <CircularProgress aria-label="Loading validation report" />
        </Box>
      ) : criteria.isError ? (
        <Alert
          severity="error"
          action={<Button onClick={() => void criteria.refetch()}>Retry</Button>}
        >
          Failed to load the validation criteria
          {criteria.error instanceof Error && criteria.error.message
            ? `: ${criteria.error.message}`
            : ""}
        </Alert>
      ) : (
        <>
          {/* Only for a verdict that EXPECTED a report. `unreported` already
              said so, in the tile, with its cause — repeating it as a vague note
              would be weaker and say it twice. */}
          {report.isError && !missingReport && (
            <Box sx={{ px: 3, pt: 2 }}>
              <Alert severity="info">
                The run reached a verdict but its report wasn't found — showing
                the criteria without per-criterion results.
              </Alert>
            </Box>
          )}
          <ValidationView
            criteria={criteria.data.content}
            {...(report.data ? { report: report.data.content } : {})}
          />
        </>
      )}
    </>
  );
}
