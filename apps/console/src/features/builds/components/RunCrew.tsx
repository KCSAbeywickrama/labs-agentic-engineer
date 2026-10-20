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

import { useState } from "react";
import { Box, ToggleButton, ToggleButtonGroup, Typography } from "@wso2/oxygen-ui";
import { connectionQuietMs, cycleCrew, feedNow, formatDuration, type Crew } from "@aep/progress-view";
import type { RunProgressCycle, RunProgressState, StampedRunEvent } from "../hooks/useRunProgress";
import { useRunView } from "../hooks/useRunView";
import { useTicker } from "../hooks/useTicker";
import { CrewInspector } from "./CrewInspector";
import { CrewTimeline } from "./CrewTimeline";
import { CrewTree } from "./CrewTree";

// ONE build session's agents, under one governing rule: a reader must never
// wonder whether the run is stuck.
//
// The crew answers "who is doing what now" and the timeline "where did the
// time go"; never both at once, since both draw the same agents. Crew is the
// default because liveness is the primary job. The Build card is a side panel,
// so the tree sits above the inspector rather than beside it, the lead
// selected until the reader picks another agent.
//
// A crew of one is still a crew: a session that will fan out starts as one
// agent, and a layout that became a tree only when a second arrived would
// reshape itself at the moment a reader watches most closely. A spawned agent
// appears IN PLACE, as a row under the lead. The Timeline toggle appears with
// the second agent: one lane compares nothing.

type FeedClock = Pick<RunProgressState, "clockOffsetMs" | "lastFrameAt" | "ticking" | "settledState">;

/** The one fact both views share: how many agents, how many running, how long since the last event. */
function CrewHint({ crew, quietMs }: { crew: Crew<StampedRunEvent>; quietMs: number | undefined }) {
  const parts = [`${String(crew.agents)} agent${crew.agents === 1 ? "" : "s"}`];
  if (crew.running > 0) {
    parts.push(`${String(crew.running)} running`);
    // Only while something runs: on a settled session it would count how long ago the build was.
    if (crew.silentForMs !== undefined) parts.push(`last event ${formatDuration(crew.silentForMs)} ago`);
  } else {
    parts.push("all settled");
  }
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {parts.join(" · ")}
      </Typography>
      {/* The CONNECTION gone quiet, which is not the run gone quiet: said only
          on a stream that ticks, where three missed ticks mean the link. */}
      {quietMs !== undefined && (
        <Typography variant="caption" color="warning.main" component="div">
          No word from the platform for {formatDuration(quietMs)}: the connection may have dropped.
        </Typography>
      )}
    </Box>
  );
}

export function RunCrew({
  section,
  clock,
  endedWith,
}: {
  section: RunProgressCycle;
  clock: FeedClock;
  /** How the session's agents ended, once the stream will say no more (run_settled's outcome vocabulary). */
  endedWith: string | undefined;
}) {
  const [view, setView] = useRunView();
  const [chosenId, setChosenId] = useState<string>();

  // Rebuilt every render, not memoised: the clock is an INPUT, and a memo keyed
  // on the feed would return ages that stopped moving. The fold under it IS
  // memoised (cycleCrew), so a tick costs the per-agent arithmetic only.
  const clientNow = Date.now();
  const now = feedNow(clock, clientNow);
  const crew = cycleCrew(section, now, { endedWith });
  const quietMs = connectionQuietMs(clock, clientNow);
  // Only while somebody is still working (or the runner is still starting):
  // a settled session's rows do not move.
  useTicker(crew.running > 0 || section.boot !== undefined);

  // The lead is the fallback, not a stored default: a selection can name an
  // agent a reconnecting stream has not replayed yet.
  const selected = crew.members.find((m) => m.id === chosenId) ?? crew.lead;
  const fannedOut = crew.agents > 1;
  const showTimeline = fannedOut && view === "timeline";

  const show = (id: string) => {
    setChosenId(id);
    setView("crew");
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, px: 1.75, pb: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <CrewHint crew={crew} quietMs={quietMs} />
        {fannedOut && (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={showTimeline ? "timeline" : "crew"}
            onChange={(_, next: string | null) => {
              // Null is a click on the button already on: a view is not a filter.
              if (next === "crew" || next === "timeline") setView(next);
            }}
            aria-label="How to read this session"
            sx={{ ml: "auto", flexShrink: 0 }}
          >
            <ToggleButton value="crew">Crew</ToggleButton>
            <ToggleButton value="timeline">Timeline</ToggleButton>
          </ToggleButtonGroup>
        )}
      </Box>

      {showTimeline ? (
        <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1 }}>
          <CrewTimeline crew={crew} onSelect={show} />
        </Box>
      ) : (
        <>
          <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 0.5, maxHeight: 264, overflowY: "auto" }}>
            <CrewTree members={crew.members} selectedId={selected.id} onSelect={setChosenId} />
          </Box>
          <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.5, bgcolor: "background.default" }}>
            <CrewInspector member={selected} now={now} onSelect={setChosenId} />
          </Box>
        </>
      )}
    </Box>
  );
}
