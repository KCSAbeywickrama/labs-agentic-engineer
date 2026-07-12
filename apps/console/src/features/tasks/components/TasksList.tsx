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
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import { useNavigate } from "@tanstack/react-router";
import { StatusChip } from "../../../components/StatusChip";
import { useAllTasks } from "../api/queries";
import { taskChip } from "../api/status";
import { GitHubIssueLink } from "./GitHubIssueLink";

// The flat task list (#173): one card per task, status chip inline — the user
// watches chips go green. Each task is its own elevated card (matching the
// build summary card above) so the page reads as a stack of cards, consistent
// with the overview/deployments look. `tag` scopes to one build's lineage.
export function TasksList({
  projectName,
  tag,
}: {
  projectName: string;
  tag?: string;
}) {
  const tasks = useAllTasks(projectName, tag);
  const navigate = useNavigate();

  if (tasks.isPending) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
        <CircularProgress aria-label="Loading tasks" />
      </Box>
    );
  }

  if (tasks.isError) {
    return (
      <Alert
        severity="error"
        action={<Button onClick={() => void tasks.refetch()}>Retry</Button>}
      >
        Failed to load tasks
        {tasks.error instanceof Error && tasks.error.message
          ? `: ${tasks.error.message}`
          : ""}
      </Alert>
    );
  }

  if (tasks.data.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
        {tag
          ? `No tasks for ${tag} yet — the build plans its coding-agent tasks right after it starts.`
          : "No tasks yet — publish a design and start a build; coding-agent tasks show up here as the build plans them."}
      </Typography>
    );
  }

  return (
    <Stack spacing={1.5}>
      {tasks.data.map((t) => {
        // Provision/config gates are platform-driven (approved in the Build
        // drawer, resolved out-of-band): there is no task page to open, so the
        // card is non-clickable — you watch its status and open the GitHub
        // issue. Its component slot shows "—" (a gate names a dependency).
        const isGate = t.executorClass === "provision";
        const chip = taskChip(t.derivedStatus);
        const onHold =
          t.derivedStatus === "on_hold" && (t.blockedBy?.length ?? 0) > 0;

        const row = (
          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ fontVariantNumeric: "tabular-nums", minWidth: 32 }}
            >
              #{t.issueNumber}
            </Typography>
            <Typography sx={{ flexGrow: 1, fontWeight: 500 }}>
              {t.title}
            </Typography>
            {isGate || !t.component ? (
              <Typography variant="caption" color="text.secondary">
                —
              </Typography>
            ) : (
              <Chip
                size="small"
                label={t.component}
                sx={{ bgcolor: "action.hover", color: "text.secondary" }}
              />
            )}
            {onHold ? (
              <Tooltip title={`Waiting for ${t.blockedBy?.join(", ")}`}>
                <Box sx={{ display: "inline-flex" }}>
                  <StatusChip label={chip.label} tone={chip.tone} appearance="soft" />
                </Box>
              </Tooltip>
            ) : (
              <StatusChip label={chip.label} tone={chip.tone} appearance="soft" />
            )}
            <GitHubIssueLink
              issueNumber={t.issueNumber}
              issueUrl={t.issueUrl}
              onClick={(e) => e.stopPropagation()}
            />
          </Stack>
        );

        return (
          <Card
            key={t.issueNumber}
            variant="outlined"
            {...(isGate
              ? {}
              : {
                  onClick: () =>
                    void navigate({
                      to: "/projects/$projectName/builds/$issueNumber",
                      params: { projectName, issueNumber: t.issueNumber },
                    }),
                  sx: {
                    cursor: "pointer",
                    transition: "border-color 120ms, box-shadow 120ms",
                    "&:hover": { borderColor: "primary.main", boxShadow: 1 },
                  },
                })}
          >
            <CardContent sx={{ "&:last-child": { pb: 2 }, py: 2 }}>
              {row}
            </CardContent>
          </Card>
        );
      })}
    </Stack>
  );
}
