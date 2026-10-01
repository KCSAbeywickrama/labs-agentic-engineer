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

import { Box, Chip, Stack, Typography } from "@wso2/oxygen-ui";

import type { AgentToolStatusInfo } from "./AgentView.js";
import type { AgentToolGroup } from "./parse.js";
import { mono, Panel } from "./parts.js";

type ToolStatus = Record<string, AgentToolStatusInfo> | undefined;

function statusKey(component: string, operation: string): string {
  return `${component}:${operation}`;
}

/** How many allowed operations the server could not resolve; the Tools tab label shows it. */
export function countUnresolved(tools: AgentToolGroup[], toolStatus: ToolStatus): number {
  return tools
    .flatMap((group) => group.operations.map((op) => toolStatus?.[statusKey(group.component, op)]?.status))
    .filter((status) => status === "unresolved").length;
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusColor(status: string): "success" | "error" | "warning" | "default" {
  if (status === "resolved") return "success";
  if (status === "unresolved") return "error";
  if (status === "unchecked") return "warning";
  return "default";
}

export function ToolsTab({ tools, toolStatus }: { tools: AgentToolGroup[]; toolStatus: ToolStatus }) {
  if (tools.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No tools, so this agent answers from its instructions alone.
      </Typography>
    );
  }
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        The operations this agent may call. The allow-list is the security boundary: an operation
        left out is never generated as a tool, so no phrasing can reach it.
      </Typography>
      {tools.map((group) => (
        <Panel key={group.component}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            {group.component}
          </Typography>
          <Stack spacing={0.75}>
            {group.operations.map((operation) => {
              const info = toolStatus?.[statusKey(group.component, operation)];
              return (
                <Box key={operation}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography component="span" sx={mono}>
                      {operation}
                    </Typography>
                    {info ? (
                      <Chip
                        size="small"
                        variant="outlined"
                        label={statusLabel(info.status)}
                        color={statusColor(info.status)}
                      />
                    ) : null}
                  </Box>
                  {info?.reason ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", ml: 0.25 }}>
                      {info.reason}
                    </Typography>
                  ) : null}
                </Box>
              );
            })}
          </Stack>
        </Panel>
      ))}
    </Stack>
  );
}
