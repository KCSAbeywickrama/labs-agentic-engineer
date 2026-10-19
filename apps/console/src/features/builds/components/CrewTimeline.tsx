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
import { crewStateLabel, crewTone, formatDuration, type Crew, type CrewMember, type LaneSpan } from "@aep/progress-view";
import type { StampedRunEvent } from "../hooks/useRunProgress";
import { toneColor } from "../model/tone";

// WHERE DID THE TIME GO, and what ran at once. One lane per agent on ONE axis,
// the cycle's first word to its last, so concurrency is a shape rather than
// something a reader rebuilds from timestamps. A lane is solid while its agent
// worked and faded while it waited on an agent it spawned: a lead that took 55
// minutes reads as the slowest thing in the run until you can see 41 of them
// are one stretch blocked inside a child. Picking a lane goes back to the crew
// with that agent selected — "where did the time go" ends in "so what was it
// doing".

function Lane({ member, axis, onSelect }: { member: CrewMember<StampedRunEvent>; axis: { startMs: number; endMs: number }; onSelect: (id: string) => void }) {
  const span = axis.endMs - axis.startMs;
  const pct = (ms: number) => `${String(((ms - axis.startMs) / span) * 100)}%`;
  const width = (s: LaneSpan) => `${String(((s.endMs - s.startMs) / span) * 100)}%`;
  const tone = toneColor(crewTone(member.state));
  return (
    <Box
      component="button"
      type="button"
      onClick={() => onSelect(member.id)}
      // Named the way the crew row names it, so the two views cannot describe one agent two ways.
      aria-label={`${member.agent.label}: ${crewStateLabel(member.state)}${member.elapsedMs === undefined ? "" : `, ${formatDuration(member.elapsedMs)}`}`}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        width: "100%",
        px: 1,
        py: 0.5,
        font: "inherit",
        textAlign: "left",
        color: "inherit",
        background: "none",
        border: 0,
        borderRadius: 1,
        cursor: "pointer",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      {/* The indent lives in the LABEL: indenting the bar would move it on the time axis. */}
      <Typography component="span" variant="caption" noWrap title={member.agent.label} sx={{ pl: member.depth * 1.5, width: 176, flexShrink: 0 }}>
        {member.agent.label}
      </Typography>
      <Box sx={{ position: "relative", flex: 1, minWidth: 0, height: 10, borderRadius: 0.5, bgcolor: "action.hover" }}>
        {member.spans.map((s) => (
          <Box
            key={`${s.kind}:${String(s.startMs)}`}
            sx={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: pct(s.startMs),
              width: width(s),
              // A unit, deliberately: MUI reads a bare 1 as the fraction 100%.
              minWidth: "2px",
              bgcolor: tone,
              borderRadius: 0.5,
              opacity: s.kind === "waiting" ? 0.28 : 1,
            }}
          />
        ))}
      </Box>
      <Typography component="span" variant="caption" color="text.secondary" sx={{ width: 52, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
        {member.elapsedMs === undefined ? "" : formatDuration(member.elapsedMs)}
      </Typography>
    </Box>
  );
}

export function CrewTimeline({ crew, onSelect }: { crew: Crew<StampedRunEvent>; onSelect: (id: string) => void }) {
  if (crew.window.endMs <= crew.window.startMs) {
    return (
      <Typography variant="caption" color="text.secondary">
        Nothing has been timed yet: the crew view has the live picture.
      </Typography>
    );
  }
  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, px: 1, pb: 0.5 }}>
        <Typography component="span" variant="caption" color="text.secondary">
          {formatDuration(crew.window.endMs - crew.window.startMs)} across {crew.agents} agents
        </Typography>
        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
          solid · working &nbsp; faded · waiting on another agent
        </Typography>
      </Box>
      {crew.members.map((member) => (
        <Lane key={member.id} member={member} axis={crew.window} onSelect={onSelect} />
      ))}
    </Box>
  );
}
