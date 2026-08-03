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
import type { FlowStep } from "../lib/flowProgress";

// The chat-top flow progress widget (#372): one consistent ✓/●/○ list for the
// agent's current flow — interview sections during the kickoff, the design
// emission order during design turns.
export function FlowStepper({ title, steps }: { title: string; steps: FlowStep[] }) {
  return (
    <Box
      data-testid="flow-stepper"
      sx={{ px: 1.75, py: 1.25, borderBottom: 1, borderColor: "divider", bgcolor: "action.hover" }}
    >
      <Typography variant="overline" sx={{ display: "block", lineHeight: 1.6, color: "text.secondary" }}>
        {title}
      </Typography>
      {steps.map((s) => (
        <Typography
          key={s.label}
          variant="caption"
          sx={{
            display: "block",
            fontVariantNumeric: "tabular-nums",
            color: s.state === "current" ? "primary.main" : s.state === "done" ? "text.primary" : "text.disabled",
            fontWeight: s.state === "current" ? 600 : 400,
          }}
        >
          {s.state === "done" ? "✓" : s.state === "current" ? "●" : "○"} {s.label}
        </Typography>
      ))}
    </Box>
  );
}
