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
  Typography,
} from "@wso2/oxygen-ui";
import { ArrowLeft, GitHub } from "@wso2/oxygen-ui-icons-react";
import { createLink } from "@tanstack/react-router";
import { useTask } from "../api/queries";
import { useTaskLog } from "../hooks/useTaskLog";
import { TaskLogView } from "./TaskLogView";
import { TaskStatusChip } from "./TaskStatusChip";

const LinkIconButton = createLink(IconButton);

// The per-task console (#173): slim header (title, status chip, GitHub
// icon-link) over the flat streaming log. get-task provides the initial
// state; the SSE stream owns everything after that.
export function TaskPage({
  projectName,
  issueNumber,
}: {
  projectName: string;
  issueNumber: number;
}) {
  const detail = useTask(projectName, issueNumber);
  const log = useTaskLog(projectName, issueNumber);

  if (detail.isPending) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
        <CircularProgress aria-label="Loading task" />
      </Box>
    );
  }

  if (detail.isError) {
    return (
      <Alert
        severity="error"
        action={<Button onClick={() => void detail.refetch()}>Retry</Button>}
      >
        Failed to load the task
        {detail.error instanceof Error && detail.error.message
          ? `: ${detail.error.message}`
          : ""}
      </Alert>
    );
  }

  // The stream's view of the task is fresher than the initial fetch.
  const derivedStatus =
    log.settledStatus ?? log.task?.derivedStatus ?? detail.data.derivedStatus;
  const title = log.task?.title ?? detail.data.title;
  const issueUrl = log.task?.issueUrl ?? detail.data.issueUrl;
  // TaskDetail (the get-task response) doesn't carry blockedBy — only the
  // stream's TaskView does — so this is populated once the SSE stream has
  // upserted a task frame, and simply absent before that (fine: the caption
  // is optional decoration, not load-bearing).
  const blockedBy = log.task?.blockedBy;

  const tail =
    log.phase === "reconnecting"
      ? "· connection lost — reconnecting…"
      : log.phase === "connecting"
        ? "· attaching to the task log…"
        : log.phase === "ended"
          ? `· task settled — ${derivedStatus}`
          : log.lines.length === 0
            ? "· waiting for the first execution…"
            : undefined;

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
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", mb: 2 }}
      >
        <Tooltip title="Back to tasks">
          <LinkIconButton
            to="/projects/$projectName/tasks"
            params={{ projectName }}
            aria-label="Back to tasks"
          >
            <ArrowLeft size={18} />
          </LinkIconButton>
        </Tooltip>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontVariantNumeric: "tabular-nums" }}
        >
          #{issueNumber}
        </Typography>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, minWidth: 0 }}>
          {title}
        </Typography>
        <TaskStatusChip derivedStatus={derivedStatus} />
        <Box sx={{ flexGrow: 1 }} />
        <Tooltip title="Open the GitHub issue">
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
      </Stack>
      {derivedStatus === "on_hold" && blockedBy?.length ? (
        <Typography variant="caption" color="text.secondary" sx={{ mb: 2 }}>
          Waiting for {blockedBy.join(", ")}
        </Typography>
      ) : null}
      <TaskLogView lines={log.lines} {...(tail ? { tail } : {})} />
    </Box>
  );
}
