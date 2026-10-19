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

import { Box, List, ListItemButton, Typography } from "@wso2/oxygen-ui";
import {
  crewStateLabel,
  crewTone,
  formatDuration,
  isCrewSettled,
  type CrewMember,
  type CrewState,
} from "@aep/progress-view";
import type { StampedRunEvent } from "../hooks/useRunProgress";
import { toneColor } from "../model/tone";

// WHO IS DOING WHAT RIGHT NOW. One row per agent, nested as the runtime
// declared the tree, each carrying its own liveness rather than leaving it to a
// line somebody has to find in a log. Every row says the same four things in
// the same places — a state dot, the name, one live sub-line in the runtime's
// own words, and an age — so a reader scanning the column scans one fact at a
// time.
//
// Agents and nothing else. Backgrounded commands and plan entries each had rows
// here once, and each buried the answer to "who is working" in its own
// evidence (47 command rows in one live run). Both are in the inspector, for
// the agent a reader picks.

/** The state dot. Never the only signal: the state's word is on the sub-line. A settled agent's dot is a ring. */
function StateDot({ state }: { state: CrewState }) {
  const colour = toneColor(crewTone(state));
  const settled = isCrewSettled(state);
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        flexShrink: 0,
        bgcolor: settled ? "transparent" : colour,
        border: settled ? 2 : 0,
        borderColor: colour,
      }}
    />
  );
}

function CrewRow({
  member,
  selected,
  onSelect,
}: {
  member: CrewMember<StampedRunEvent>;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const tone = toneColor(crewTone(member.state));
  const live = !isCrewSettled(member.state);
  const state = crewStateLabel(member.state);
  // "waiting · waiting on the model" says it twice: when the runtime's own
  // sentence opens with the state, the sentence IS the state word.
  const captionLeads = member.caption.startsWith(state);
  return (
    <ListItemButton
      dense
      disableGutters
      selected={selected}
      onClick={() => onSelect(member.id)}
      aria-label={`${member.agent.label}: ${state}${member.caption ? `. ${member.caption}` : ""}`}
      // Indented by the depth the runtime DECLARED, so a depth-2 agent sits
      // under the agent that spawned it however late it joined the feed.
      sx={{ display: "block", pl: 1.25 + member.depth * 2, pr: 1.25, py: 0.5, borderRadius: 1.5 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <StateDot state={member.state} />
        <Typography component="span" variant="body2" noWrap title={member.agent.label} sx={{ fontWeight: 600, minWidth: 0 }}>
          {member.agent.label}
        </Typography>
        {member.background && (
          <Typography component="span" variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            background
          </Typography>
        )}
        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: "auto", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
          {member.elapsedMs === undefined ? "" : formatDuration(member.elapsedMs)}
        </Typography>
      </Box>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.75, pl: 2 }}>
        {!captionLeads && (
          <Typography component="span" variant="caption" sx={{ color: tone, flexShrink: 0, fontWeight: 600 }}>
            {state}
          </Typography>
        )}
        {member.caption && (
          <Typography
            component="span"
            variant="caption"
            noWrap
            title={member.caption}
            sx={{ color: captionLeads ? tone : "text.secondary", minWidth: 0 }}
          >
            {captionLeads ? member.caption : `· ${member.caption}`}
          </Typography>
        )}
        {/* The age, and why this view owns a clock: it has to tick while
            NOTHING arrives. Live agents only — on a settled one it would count
            how long ago the build was. */}
        {live && member.silentForMs !== undefined && (
          <Typography component="span" variant="caption" color="text.disabled" sx={{ ml: "auto", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
            quiet {formatDuration(member.silentForMs)}
          </Typography>
        )}
      </Box>
    </ListItemButton>
  );
}

/**
 * The crew tree, from the model's depth-first `members`: the nesting is each
 * row's declared depth, so the selection is decided in one place rather than
 * threaded down a recursion.
 */
export function CrewTree({
  members,
  selectedId,
  onSelect,
}: {
  members: readonly CrewMember<StampedRunEvent>[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <List dense disablePadding aria-label="Agents">
      {members.map((member) => (
        <CrewRow key={member.id} member={member} selected={member.id === selectedId} onSelect={onSelect} />
      ))}
    </List>
  );
}
