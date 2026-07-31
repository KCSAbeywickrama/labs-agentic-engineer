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

import { Box, Card, Stack, Typography } from "@wso2/oxygen-ui";
import { StatusChip } from "../../../components/StatusChip";
import type { components } from "../../../generated/aep-api";
import {
  BUILD_CYCLE_KINDS,
  runOriginLabel,
  runStateChip,
  terminalReasonText,
} from "../lib/runView";

type MilestoneRunView = components["schemas"]["MilestoneRunView"];

function when(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/**
 * The milestone's EARLIER runs, one line each.
 *
 * A settled run is a record, not something to watch, so it gets what a record
 * needs: how it ended, what kind it was, when it ran, and what it left behind.
 * The run that is still moving is the page's lead and is not in here.
 */
export function RunHistoryList({ runs }: { runs: MilestoneRunView[] }) {
  if (runs.length === 0) return null;

  return (
    <Box>
      <Typography
        variant="caption"
        sx={{
          display: "block",
          mb: 1,
          fontWeight: 700,
          letterSpacing: "0.08em",
          color: "text.secondary",
        }}
      >
        EARLIER RUNS OF THIS MILESTONE
      </Typography>
      <Stack spacing={1}>
        {runs.map((run) => {
          const chip = runStateChip(run);
          const sessions = run.cycles.filter((c) =>
            (BUILD_CYCLE_KINDS as readonly string[]).includes(c.kind),
          );
          const merged = sessions.filter((c) => c.mergeSha).length;
          const reason = terminalReasonText(run.terminalReason ?? "");
          // What it left behind, in the platform's own terms: a run that merged
          // nothing landed nothing, and that is the fact worth reading.
          const outcome =
            reason ||
            (merged > 0
              ? `${merged} of ${sessions.length} build session${sessions.length === 1 ? "" : "s"} merged`
              : "Landed nothing — no build session merged.");

          return (
            <Card key={run.id} variant="outlined">
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5, px: 2, py: 1.25 }}
              >
                <StatusChip label={chip.label} tone={chip.tone} appearance="soft" dot />
                <StatusChip
                  label={runOriginLabel(run.origin)}
                  tone="neutral"
                  appearance="soft"
                />
                <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                  {when(run.startedAt ?? run.createdAt)}
                  {run.endedAt ? ` → ${when(run.endedAt)}` : ""}
                </Typography>
                <Typography
                  variant="body2"
                  color={chip.tone === "error" ? "error.main" : "text.secondary"}
                  sx={{ flexGrow: 1, minWidth: 0 }}
                >
                  {outcome}
                </Typography>
              </Stack>
            </Card>
          );
        })}
      </Stack>
    </Box>
  );
}
