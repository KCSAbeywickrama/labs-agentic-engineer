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
 * The body of a project that has nothing yet.
 *
 * It explains the flow the track above it is drawing, and it does NOT ask for
 * anything. Two reasons, and both are load-bearing:
 *
 *   - On a new project the kickoff has already fired server-side (#562), so the
 *     agent is writing requirements in the chat panel while this renders. A
 *     prompt here would ask for something already underway.
 *   - On a project whose kickoff never ran, the way to start one lives in the
 *     spec view — #562 moved every "start work" affordance there and this is
 *     not the place to put one back. The spec leg above links straight to it.
 *
 * So this teaches what the three stages are, which is the one thing a first-run
 * screen can usefully do while somebody else is typing.
 */
const STAGES: { name: string; what: string }[] = [
  {
    name: "Spec",
    what: "You say what you want. The agent asks questions, writes the requirements, and works out the design and acceptance criteria from your answers.",
  },
  {
    name: "Build",
    what: "Publishing a version of the spec starts a build. Coding agents write the components the design calls for, and open a pull request for each one.",
  },
  {
    name: "Deploy",
    what: "A build that passed goes to your dev environment. The platform then checks the running app against the acceptance criteria from your spec.",
  },
];

export function OverviewFirstRun() {
  return (
    <Box
      sx={{
        border: 1,
        borderStyle: "dashed",
        borderColor: "divider",
        borderRadius: 2,
        px: { xs: 3, sm: 5 },
        py: 5,
      }}
    >
      <Stack spacing={1} sx={{ mb: 4, maxWidth: "60ch" }}>
        <Typography variant="h6">What happens next</Typography>
        <Typography variant="body2" color="text.secondary">
          Three stages, and they run in order. Publishing the spec is what
          starts a build, and only a build that passed gets deployed.
        </Typography>
      </Stack>
      <Stack spacing={3} sx={{ maxWidth: "68ch" }}>
        {STAGES.map((stage, i) => (
          <Stack key={stage.name} direction="row" spacing={2.5}>
            {/* The same numerals the track carries, so the explainer and the
                bar above it are visibly the same three things. */}
            <Typography
              variant="caption"
              aria-hidden
              sx={{
                fontFamily: "monospace",
                fontVariantNumeric: "tabular-nums",
                color: "text.disabled",
                pt: 0.375,
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </Typography>
            <Box>
              <Typography variant="subtitle2">{stage.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                {stage.what}
              </Typography>
            </Box>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
