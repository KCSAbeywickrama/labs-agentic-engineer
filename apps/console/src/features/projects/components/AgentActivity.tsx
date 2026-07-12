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

import { Box, Typography } from "@wso2/oxygen-ui";
import { Activity } from "@wso2/oxygen-ui-icons-react";
import { EmptyState } from "../../../components/EmptyState";
import { SectionTitle } from "../../../components/SectionTitle";
import type { StatusTone } from "../../../components/StatusChip";
import type { components } from "../../../generated/aep-api";
import { agentActivity } from "../lib/projectActivity";

type TaskView = components["schemas"]["TaskView"];

// Maps an activity item's tone to the leading status dot's colour.
const DOT_COLOR: Record<StatusTone, string> = {
  error: "error.main",
  warning: "warning.main",
  info: "info.main",
  success: "success.main",
  primary: "primary.main",
  neutral: "text.disabled",
};

// The overview's "agent activity" feed: a status-dotted timeline (dots joined
// by a vertical rail) of what the platform's agents — and you — have done on
// this project, derived from the build tasks. The Builds page owns the detail.
export function AgentActivity({ tasks }: { tasks: TaskView[] }) {
  const items = agentActivity(tasks);

  return (
    <div>
      <SectionTitle>Agent Activity</SectionTitle>
      {items.length === 0 ? (
        <EmptyState
          bordered
          icon={<Activity size={28} />}
          title="No activity yet"
          description="Publish the plan and start a build — agents report progress here as they work."
        />
      ) : (
        <Box sx={{ mt: 1 }}>
          {items.map((item, i) => {
            const last = i === items.length - 1;
            return (
              <Box key={item.id} sx={{ display: "flex", gap: 1.5 }}>
                {/* Rail: the dot, and a line filling the row height down to the
                    next dot (omitted on the last item). */}
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    flexShrink: 0,
                  }}
                >
                  <Box
                    sx={{
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      bgcolor: DOT_COLOR[item.tone],
                      mt: "5px",
                    }}
                  />
                  {!last && (
                    <Box sx={{ flexGrow: 1, width: "2px", bgcolor: "divider", mt: 0.5 }} />
                  )}
                </Box>
                <Box sx={{ minWidth: 0, pb: last ? 0 : 2 }}>
                  <Typography variant="body2" sx={{ color: "text.primary" }}>
                    <Box component="span" sx={{ fontWeight: 600 }}>
                      {item.actor}
                    </Box>{" "}
                    {item.text}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {item.time}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </div>
  );
}
