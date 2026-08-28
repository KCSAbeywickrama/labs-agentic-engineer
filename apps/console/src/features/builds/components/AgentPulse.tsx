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

import { Box, Stack, Typography } from "@wso2/oxygen-ui";

/**
 * "agent working" — the design's own pulse line, from the handoff.
 *
 * A traced ECG rather than a dot: a dot that merely blinks says "something is
 * live", which every status chip in the app already says. The trace reads as
 * WORK being done, which is the one thing this indicator is for.
 *
 * `stroke="currentColor"` deliberately — the handoff hardcodes `#0097A7`, and
 * `design-system.md` forbids hex literals. The colour comes from the parent's
 * `info.main`, so it holds in both themes.
 */
export function AgentPulse({ label = "agent working" }: { label?: string }) {
  return (
    <Stack
      direction="row"
      spacing={0.875}
      sx={{ alignItems: "center", color: "info.main" }}
    >
      <Box
        component="svg"
        width="42"
        height="14"
        viewBox="0 0 42 14"
        aria-hidden
        sx={{ flexShrink: 0, display: "block" }}
      >
        <polyline
          points="0,7 8,7 11,2 15,12 19,7 27,7 30,4 34,10 38,7 42,7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="14 60"
        >
          <animate
            attributeName="stroke-dashoffset"
            from="74"
            to="0"
            dur="1.6s"
            repeatCount="indefinite"
          />
        </polyline>
      </Box>
      <Typography variant="caption" sx={{ color: "inherit" }}>
        {label}
      </Typography>
    </Stack>
  );
}
