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
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  Stack,
  Typography,
} from "@wso2/oxygen-ui";
import { ChevronDown } from "@wso2/oxygen-ui-icons-react";
import { GitHubRefChip } from "../../../components/GitHubRefChip";
import { AgentLogLines, LogSurface } from "./AgentLogLines";
import { useRunProgress, type RunProgressCycle } from "../hooks/useRunProgress";

// The run feed: ONE SSE stream for the whole run, rendered as one accordion
// section per cycle. Grouping by cycle is the point — a fix or conflict cycle
// re-enters an earlier phase of the loop, so a flat log would read as the agent
// going backwards. Within a cycle, each subagent the main agent fanned out to
// gets its own collapsible section (see AgentLogLines, shared with the task
// log) — several run at once and their lines arrive interleaved, so read flat
// they would look like one agent contradicting itself.

function CycleSection({
  section,
  index,
  defaultExpanded,
}: {
  section: RunProgressCycle;
  index: number;
  defaultExpanded: boolean;
}) {
  const { cycle, lines } = section;
  return (
    <Accordion
      disableGutters
      elevation={0}
      defaultExpanded={defaultExpanded}
      sx={{ "&:before": { display: "none" } }}
    >
      <AccordionSummary expandIcon={<ChevronDown size={16} />}>
        {/* Full width so the pull request can sit at the far end: the facts about
            the cycle read left to right, and the one link the row carries is where
            the eye lands last. */}
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", width: "100%", pr: 1 }}
        >
          <Typography variant="subtitle2">Cycle {index + 1}</Typography>
          <Chip label={cycle.kind} size="small" variant="outlined" />
          {cycle.attempts > 1 && (
            <Typography variant="caption" color="text.secondary">
              {cycle.attempts} attempts
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            {lines.length} line{lines.length === 1 ? "" : "s"}
          </Typography>
          {/* A spacer rather than `ml: auto` on the link: Stack lays its spacing
              down as `margin-left` through a descendant selector, which outranks a
              margin set on the child's own sx and would pin the link beside the
              counts instead of at the row's end. */}
          <Box sx={{ flexGrow: 1 }} />
          {/* The pull request THIS cycle produced — per cycle rather than per run,
              because a run holds several (a repeat validation, a fix, a conflict
              resolution) and each opens its own. Absent until the agent opens one;
              the stream upserts the cycle frame, so it appears the moment the pull
              request lands rather than on the next page load.
              Named by section so it stays distinct from the page header's chip,
              which points at the newest cycle's pull request — the same one. */}
          {cycle.prUrl && cycle.prNumber ? (
            <GitHubRefChip
              kind="pull"
              number={cycle.prNumber}
              url={cycle.prUrl}
              name={`Cycle ${index + 1} pull request`}
              tooltip="Open this cycle's pull request"
              // The summary's whole surface toggles the section — without this,
              // opening the pull request also collapses the log being read.
              onClick={(e) => e.stopPropagation()}
            />
          ) : null}
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        <LogSurface>
          <AgentLogLines lines={lines} />
        </LogSurface>
      </AccordionDetails>
    </Accordion>
  );
}

/**
 * The run's per-cycle progress feed. Mounted only where it should stream —
 * the hook opens the SSE connection on mount and closes it on unmount, so
 * keeping this behind a toggle is what keeps a settled page connection-free.
 */
export function RunFeed({
  projectName,
  runId,
  cycleKinds,
}: {
  projectName: string;
  runId: string;
  /** Show only these cycle kinds. The stream is always the whole run — the
   *  filter is presentational, for a surface that owns one phase of the loop
   *  (the deployment surface owns validation). Omitted = every cycle. */
  cycleKinds?: readonly string[];
}) {
  const all = useRunProgress(projectName, runId);
  const feed = cycleKinds
    ? {
        ...all,
        cycles: all.cycles.filter((c) => cycleKinds.includes(c.cycle.kind)),
      }
    : all;

  let tail: string | undefined;
  if (feed.phase === "connecting") {
    tail = "attaching to the run feed…";
  } else if (feed.phase === "reconnecting") {
    tail = "connection lost — reconnecting…";
  } else if (feed.phase === "ended") {
    tail = `run settled${feed.settledState ? ` — ${feed.settledState}` : ""}`;
  }

  return (
    <Box>
      {feed.cycles.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          No cycle output yet — the run's first agent has not written a line.
        </Typography>
      ) : (
        feed.cycles.map((section, i) => (
          <CycleSection
            key={section.cycle.id}
            section={section}
            // Numbered within what is shown; a filtered feed owns one phase and
            // its section is "Cycle 1" of that phase, not of the whole run.
            index={i}
            // The newest cycle is what the user came to watch; older ones stay
            // collapsed so a long run does not open as a wall of log.
            defaultExpanded={i === feed.cycles.length - 1}
          />
        ))
      )}
      {tail && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          {tail}
        </Typography>
      )}
    </Box>
  );
}
