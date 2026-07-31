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
import type { components } from "../../../generated/aep-api";

type RunCycleView = components["schemas"]["RunCycleView"];

// VOCABULARY. A build SESSION is one run of the milestone loop — the thing the
// card narrates and the history below it lists. A session contains CYCLES: each
// one an agent dispatch, its pull request, the merge, and the builds that
// follow. A cycle in turn may take two runner ATTEMPTS.
//
// The platform's own type is RunCycleView, so "cycle" is its word, not one
// invented here — and it keeps "session" free to mean the one thing the design
// calls a build session.

/**
 * The current session's earlier cycles.
 *
 * The strip narrates the cycle that is moving. A session that re-entered — a
 * fix, or a conflict rebase — has cycles behind it, and dropping them would
 * hide the very loop a reader is trying to understand.
 */
export function EarlierSessions({
  cycles,
}: {
  cycles: RunCycleView[];
}) {
  if (cycles.length === 0) return null;

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
        EARLIER CYCLES IN THIS SESSION
      </Typography>
      <CycleLines cycles={cycles} />
    </Box>
  );
}

/**
 * Cycles as one line each — shared by the current session's list and by an
 * expanded past session, so a cycle reads identically wherever it appears.
 */
export function CycleLines({ cycles }: { cycles: RunCycleView[] }) {
  return (
    <Stack spacing={0.75}>
      {cycles.map((cycle, i) => (
        <Stack
          key={cycle.id}
          direction="row"
          spacing={1.5}
          sx={{ alignItems: "baseline", flexWrap: "wrap", rowGap: 0.25 }}
        >
          <Box
            aria-hidden
            sx={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              flexShrink: 0,
              bgcolor: cycle.mergeSha ? "success.main" : "text.disabled",
            }}
          />
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {`Cycle ${i + 1} · ${cycle.kind}`}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {cycleOutcome(cycle)}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

/** What the cycle left behind, in the platform's own recorded facts. */
function cycleOutcome(cycle: RunCycleView): string {
  if (cycle.mergeSha) {
    const pr = cycle.prNumber ? `pull request #${cycle.prNumber}` : "its pull request";
    return `merged ${pr} as ${cycle.mergeSha.slice(0, 8)}`;
  }
  if (cycle.prNumber) {
    return `opened pull request #${cycle.prNumber} — not merged`;
  }
  if (cycle.endedAt) {
    return cycle.attempts > 1
      ? "ended without a pull request, on its second attempt"
      : "ended without opening a pull request";
  }
  return "no pull request yet";
}
