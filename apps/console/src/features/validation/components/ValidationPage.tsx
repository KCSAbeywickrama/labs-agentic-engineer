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
import { useTask } from "../../tasks/api/queries";
import { useTaskLog } from "../../tasks/hooks/useTaskLog";
import { TaskLogView } from "../../tasks/components/TaskLogView";
import { useValidationCriteria, useValidationReport } from "../api/queries";

// Header status chip for the coarse validation state. Mirrors the labels the
// deployments board uses (validationView, projects/lib/pipeline.ts) but returns
// StatusTone (the header's palette) directly — none / "" gets no chip.
function validationChip(validation: string): PageHeaderStatus | undefined {
  switch (validation) {
    case "running":
      return { label: "Validating", tone: "info" };
    case "completed":
      return { label: "Validation report", tone: "info" };
    case "failed":
      return { label: "Validation failed", tone: "error" };
    default:
      return undefined;
  }
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
  const issue = deploy?.validationIssue || undefined;
  const version = deploy?.version ?? "";
  const completed = validation === "completed";

  // Criteria + report are only fetched once a run has completed (before that the
  // report isn't at HEAD yet). Hooks stay unconditional; `enabled` gates them.
  const criteria = useValidationCriteria(projectName, version, completed);
  const report = useValidationReport(projectName, version, completed);

  // Body rule: the log box shows when there's no report yet (running/failed) OR
  // the user toggled ?view=logs; otherwise the joined report.
  const showLogs = !completed || view === "logs";

  const chip = validationChip(validation);
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
            {completed &&
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
          {report.isError && (
            <Box sx={{ px: 3, pt: 2 }}>
              <Alert severity="info">
                The run completed but its report wasn't found — showing the
                criteria without per-criterion results.
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
