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
  AlertTitle,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import {
  FileText,
  GitHub,
  GitPullRequest,
  ScrollText,
} from "@wso2/oxygen-ui-icons-react";
import { Link } from "@tanstack/react-router";
import { ValidationView } from "@aep/ui-validation-view";
import { PageHeader, type PageHeaderStatus } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { useProjectStatus } from "../../projects/api/queries";
import { validationView, type StageTone } from "../../projects/lib/pipeline";
import { useTask } from "../../tasks/api/queries";
import { useTaskLog } from "../../tasks/hooks/useTaskLog";
import { TaskLogView } from "../../tasks/components/TaskLogView";
import {
  useSetValidationVerdict,
  useValidationCriteria,
  useValidationReport,
} from "../api/queries";

// Full-sentence copy for an errored run, one per machine-readable cause. Every
// message describes the RUN breaking — none of them can be read as a test result,
// which is the confusion the whole state split exists to remove.
const FAILURE_KIND_MESSAGE: Record<string, string> = {
  internal_error: "The platform hit an internal error running validation.",
  gate_rejected: "A gate was declined, so validation never ran to completion.",
  dispatch_failed: "The validation runner never started.",
  runner_crashed: "The validation runner died part-way through the run.",
  timed_out: "The validation run timed out.",
  no_pr_opened: "The run finished without opening a pull request.",
  report_missing:
    "The run never reported its results, so there is no verdict. Re-run validation.",
  report_invalid: "The run's report could not be read, so there is no verdict.",
  merge_failed: "The validation pull request did not merge.",
};

// The verdict banner: what the run ANSWERED, above the per-criterion detail.
// awaiting_review is the only state offering buttons — an automatic pass or fail
// is final, and the server rejects an attempt to change one, so a green banner
// can never be something a human clicked past.
function VerdictBanner({
  verdict,
  onDecide,
  deciding,
  error,
}: {
  verdict: string | undefined;
  onDecide: (verdict: "pass" | "fail") => void;
  deciding: boolean;
  error: string | undefined;
}) {
  if (verdict === "pass") {
    return (
      <Alert severity="success">
        <AlertTitle>Validation passed</AlertTitle>
        Every acceptance criterion is automated and every one passed.
      </Alert>
    );
  }
  if (verdict === "fail") {
    return (
      <Alert severity="error">
        <AlertTitle>Validation failed</AlertTitle>
        At least one automated criterion did not pass. The failing criteria are
        marked below.
      </Alert>
    );
  }
  if (verdict === "awaiting_review") {
    return (
      <Alert
        severity="warning"
        action={
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Button
              size="small"
              color="success"
              variant="outlined"
              disabled={deciding}
              onClick={() => onDecide("pass")}
            >
              Pass
            </Button>
            <Button
              size="small"
              color="error"
              variant="outlined"
              disabled={deciding}
              onClick={() => onDecide("fail")}
            >
              Fail
            </Button>
          </Stack>
        }
      >
        <AlertTitle>Awaiting review</AlertTitle>
        <Typography variant="body2">
          The automated checks could not decide this on their own — some criteria
          need a human, or an automated criterion produced no result. Review the
          criteria below and record the verdict.
        </Typography>
        {error && (
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>
            {error}
          </Typography>
        )}
      </Alert>
    );
  }
  // Finished with no verdict: a run that predates the verdict field.
  return null;
}

// Header status chip for the validation state. DERIVED from the shared mapper
// (validationView, projects/lib/pipeline.ts) rather than restating its cases, so
// the page's chip can never drift from the deployments board's. none / "" gets no
// chip. "ghost" cannot occur here — validationView never returns it — so it maps
// to neutral for exhaustiveness only.
const TONE_TO_STATUS: Record<StageTone, PageHeaderStatus["tone"]> = {
  ghost: "neutral",
  neutral: "neutral",
  info: "info",
  warning: "warning",
  success: "success",
  error: "error",
};

function validationChip(
  validation: string,
  verdict?: string,
  failureKind?: string,
): PageHeaderStatus | undefined {
  const v = validationView(validation, verdict, failureKind);
  if (!v) return undefined;
  return {
    // The shared labels are lowercase for mid-sentence use; the chip leads.
    label: v.label.charAt(0).toUpperCase() + v.label.slice(1),
    tone: TONE_TO_STATUS[v.tone],
  };
}

// The issue + PR links, mounted only when a validation issue exists so useTask
// (no `enabled` guard) never fires for a bogus issue. Shares get-task's cache
// with the log stream — no extra fetch. The PR button appears once the PR opens.
function ValidationLinks({
  projectName,
  issueNumber,
}: {
  projectName: string;
  issueNumber: number;
}) {
  const task = useTask(projectName, issueNumber);
  const issueUrl = task.data?.issueUrl;
  const prUrl = task.data?.prUrl;
  return (
    <>
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
      {issueUrl && (
        <Tooltip title="Open the validation issue">
          <IconButton
            component="a"
            href={issueUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`GitHub issue #${issueNumber}`}
          >
            <GitHub size={18} />
          </IconButton>
        </Tooltip>
      )}
    </>
  );
}

// The validation run's live log. Mounted only in the logs branch so the SSE
// stream (useTaskLog) opens only when logs are shown — hence a component rather
// than a top-level hook call. Feeds the shared, pure TaskLogView directly; the
// tail is a minimal phase hint (no idle-timer reassurance).
function ValidationLog({
  projectName,
  issueNumber,
}: {
  projectName: string;
  issueNumber: number;
}) {
  const log = useTaskLog(projectName, issueNumber);
  let tail: string | undefined;
  if (log.phase === "connecting") {
    tail = "· attaching to the validation log…";
  } else if (log.phase === "reconnecting") {
    tail = "· connection lost — reconnecting…";
  } else if (log.phase === "ended") {
    tail = `· validation settled${log.settledStatus ? ` — ${log.settledStatus}` : ""}`;
  }
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        // Fill the remaining page height so the log gets a real scroll area.
        minHeight: 480,
        height: "calc(100vh - 320px)",
      }}
    >
      <TaskLogView lines={log.lines} {...(tail ? { tail } : {})} />
    </Box>
  );
}

// The Validation page: a read-only report of the deployed system against its
// acceptance criteria. It joins the authored oracle
// (specs/validation/validation-criteria.json) with the runner's committed run
// report (tests/validation/report.json, both read at HEAD) and renders them via
// the shared ValidationView. Coarse lifecycle comes from the project status; the
// live run log is absorbed here (inline before a report exists, behind a toggle
// after). No writes — manual criteria simply show a "Manual" state.
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
  const validation = deploy?.validation ?? "";
  const verdict = deploy?.validationVerdict;
  const failureKind = deploy?.validationFailureKind;
  const issue = deploy?.validationIssue || undefined;
  const version = deploy?.version ?? "";
  // `finished` means the run reached an ANSWER — the verdict says what it was, so
  // a failing suite is finished too and still has a report worth rendering.
  const finished = validation === "finished";
  const errored = validation === "errored";

  // Criteria + report are only fetched once the run reached an answer. Hooks stay
  // unconditional; `enabled` gates them.
  const criteria = useValidationCriteria(projectName, version, finished);
  const report = useValidationReport(projectName, version, finished);
  const setVerdict = useSetValidationVerdict(projectName);

  // Body rule: the log box shows while there is no answer yet, or when the user
  // toggled ?view=logs; otherwise the joined report.
  const showLogs = !finished || view === "logs";

  const chip = validationChip(validation, verdict, failureKind);
  const header = (
    <PageHeader
      title="Validation"
      backTo={{
        link: <Link to="/projects/$projectName" params={{ projectName }} />,
        label: "Back to Overview",
      }}
      {...(chip ? { status: chip } : {})}
      actions={
        issue ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <ValidationLinks projectName={projectName} issueNumber={issue} />
            {finished &&
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
        ) : undefined
      }
    />
  );

  if (status.isPending) {
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

  // Nothing has run: no report, and no task to stream.
  if (!issue || validation === "" || validation === "none") {
    return (
      <>
        {header}
        <EmptyState
          compact
          description="No validation has run yet — it runs automatically once the project's components are deployed to dev."
        />
      </>
    );
  }

  if (showLogs) {
    return (
      <>
        {header}
        {errored && (
          <Box sx={{ px: 3, pt: 2 }}>
            <Alert severity="error">
              <AlertTitle>Validation could not complete</AlertTitle>
              {/* The cause, not just "failed": this is the distinction the state
                  model exists to make. A criterion failing is a verdict, shown on
                  the report; this alert only ever describes the RUN breaking. */}
              {FAILURE_KIND_MESSAGE[failureKind ?? ""] ??
                "The validation run did not finish."}
              {deploy?.validationReason ? ` — ${deploy.validationReason}` : ""}
            </Alert>
          </Box>
        )}
        <ValidationLog projectName={projectName} issueNumber={issue} />
      </>
    );
  }

  // Completed and showing the report: render the join once the criteria load.
  return (
    <>
      {header}
      {criteria.isPending ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
          <CircularProgress aria-label="Loading validation report" />
        </Box>
      ) : criteria.isError ? (
        <Alert
          severity="error"
          action={
            <Button onClick={() => void criteria.refetch()}>Retry</Button>
          }
        >
          Failed to load the validation criteria
          {criteria.error instanceof Error && criteria.error.message
            ? `: ${criteria.error.message}`
            : ""}
        </Alert>
      ) : (
        <>
          <Box sx={{ px: 3, pt: 2 }}>
            <VerdictBanner
              verdict={verdict}
              onDecide={(d) => setVerdict.mutate({ verdict: d })}
              deciding={setVerdict.isPending}
              error={
                setVerdict.error instanceof Error
                  ? setVerdict.error.message
                  : undefined
              }
            />
          </Box>
          {report.isError && (
            <Box sx={{ px: 3, pt: 2 }}>
              {/* An error, not info: the run reached a verdict, so a report that
                  cannot be read is a real gap between the verdict and its
                  evidence — the reader has no way to check the answer. */}
              <Alert severity="error">
                The report for this run could not be read, so per-criterion
                results are unavailable — showing the criteria only.
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
