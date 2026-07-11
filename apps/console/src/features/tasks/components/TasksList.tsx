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
  Chip,
  CircularProgress,
  IconButton,
  ListingTable,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import { GitHub } from "@wso2/oxygen-ui-icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useAllTasks } from "../api/queries";
import { TaskStatusChip } from "./TaskStatusChip";

// The flat task list (#173): one row per task, status chip inline — the user
// watches chips go green. No sections, no filter (that's #177). Card-variant
// listing per the components list / oxygen-ui sample precedent.
export function TasksList({ projectName }: { projectName: string }) {
  const tasks = useAllTasks(projectName);
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
        No tasks yet — publish a design and start a build; coding-agent tasks
        show up here as the build plans them.
      </Typography>
    );
  }

  return (
    <ListingTable.Container sx={{ width: "100%" }} disablePaper>
      <ListingTable variant="card" density="standard">
        <ListingTable.Head>
          <ListingTable.Row>
            <ListingTable.Cell>Task</ListingTable.Cell>
            <ListingTable.Cell sx={{ maxWidth: 160 }}>
              Component
            </ListingTable.Cell>
            <ListingTable.Cell sx={{ maxWidth: 120 }}>Status</ListingTable.Cell>
            <ListingTable.Cell sx={{ maxWidth: 64 }} aria-label="Links" />
          </ListingTable.Row>
        </ListingTable.Head>
        <ListingTable.Body>
          {tasks.data.map((t) => (
            <ListingTable.Row
              key={t.issueNumber}
              variant="card"
              hover
              onClick={() =>
                void navigate({
                  to: "/projects/$projectName/tasks/$issueNumber",
                  params: { projectName, issueNumber: t.issueNumber },
                })
              }
              sx={{ cursor: "pointer" }}
            >
              <ListingTable.Cell>
                <ListingTable.CellIcon
                  icon={
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      #{t.issueNumber}
                    </Typography>
                  }
                  primary={t.title}
                />
              </ListingTable.Cell>
              <ListingTable.Cell sx={{ maxWidth: 160 }}>
                {t.component ? (
                  <Chip label={t.component} size="small" variant="outlined" />
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    —
                  </Typography>
                )}
              </ListingTable.Cell>
              <ListingTable.Cell sx={{ maxWidth: 120 }}>
                <TaskStatusChip derivedStatus={t.derivedStatus} />
              </ListingTable.Cell>
              <ListingTable.Cell sx={{ maxWidth: 64 }}>
                <Tooltip title="Open the GitHub issue">
                  <IconButton
                    component="a"
                    href={t.issueUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`GitHub issue #${t.issueNumber}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <GitHub size={16} />
                  </IconButton>
                </Tooltip>
              </ListingTable.Cell>
            </ListingTable.Row>
          ))}
        </ListingTable.Body>
      </ListingTable>
    </ListingTable.Container>
  );
}
