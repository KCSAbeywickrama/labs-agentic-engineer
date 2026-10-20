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

import { Box, ButtonBase, Typography } from "@wso2/oxygen-ui";
import {
  crewStateLabel,
  crewTone,
  formatAgentStatus,
  formatDuration,
  isCrewSettled,
  type CrewMember,
  type CrewTask,
} from "@aep/progress-view";
import type { StampedRunEvent } from "../hooks/useRunProgress";
import { toneColor } from "../model/tone";
import { AgentPlan } from "./AgentPlan";
import { AgentSteps } from "./AgentSteps";

// WHAT ONE AGENT DID. The tree answers who is alive; this answers what the one
// you picked has been doing, and nothing else. Everything here is on the feed
// already — the runtime's own totals, its closing report, its plan, what it
// dispatched, what it still has running in the background, and its steps. No narration and no file
// list: an invented summary is exactly what a reader cannot check.

function Heading({ children }: { children: string }) {
  return (
    <Typography variant="overline" color="text.secondary" sx={{ display: "block", lineHeight: 2 }}>
      {children}
    </Typography>
  );
}

/**
 * The subagents this agent DISPATCHED, and what became of each. A spawn is filed under
 * the agent it created, so without this the lead's own steps jump from "read
 * the design" to "open the pull request" with the whole fan-out unaccounted for.
 */
function Subagents({ children, onSelect }: { children: readonly CrewMember<StampedRunEvent>[]; onSelect: (id: string) => void }) {
  if (children.length === 0) return null;
  return (
    <Box component="section" aria-label="Subagents">
      <Heading>{`Subagents · ${String(children.length)}`}</Heading>
      {children.map((child) => {
        const live = !isCrewSettled(child.state);
        return (
          <ButtonBase
            key={child.id}
            onClick={() => onSelect(child.id)}
            aria-label={`Show ${child.agent.label}, ${crewStateLabel(child.state)}`}
            sx={{ display: "flex", width: "100%", justifyContent: "flex-start", alignItems: "baseline", gap: 1, py: 0.25, borderRadius: 1, "&:hover": { bgcolor: "action.hover" } }}
          >
            <Typography component="span" variant="caption" color="text.secondary" aria-hidden>
              ⑂
            </Typography>
            <Typography component="span" variant="caption" noWrap title={child.agent.label} sx={{ minWidth: 0 }}>
              {child.agent.label}
            </Typography>
            {child.background && (
              <Typography component="span" variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                background
              </Typography>
            )}
            <Typography component="span" variant="caption" sx={{ ml: "auto", flexShrink: 0, color: toneColor(crewTone(child.state)) }}>
              {live ? crewStateLabel(child.state) : formatAgentStatus(child.agent)}
            </Typography>
          </ButtonBase>
        );
      })}
    </Box>
  );
}

/**
 * Commands it put in the background that are STILL running, under the agent
 * that started them, so a dev server holding a port has somebody's name on it.
 * A settled one is already a step row with its ending on it; listing it here
 * too would draw one command twice.
 */
function RunningInBackground({ tasks, now }: { tasks: readonly CrewTask[]; now: number }) {
  const running = tasks.filter((t) => t.status === "running");
  if (running.length === 0) return null;
  return (
    <Box component="section" aria-label="Running in the background">
      <Heading>{`Running in the background · ${String(running.length)}`}</Heading>
      {running.map((t) => (
        <Box key={t.id} sx={{ display: "flex", alignItems: "baseline", gap: 1, py: 0.25 }}>
          <Typography component="span" variant="caption" noWrap title={t.label} sx={{ fontFamily: "monospace", minWidth: 0 }}>
            {t.label}
          </Typography>
          <Typography component="span" variant="caption" sx={{ ml: "auto", flexShrink: 0, color: toneColor("info"), fontVariantNumeric: "tabular-nums" }}>
            {t.startedAtMs === undefined ? "running" : `running · ${formatDuration(now - t.startedAtMs)}`}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export function CrewInspector({
  member,
  now,
  onSelect,
}: {
  member: CrewMember<StampedRunEvent>;
  now: number;
  onSelect: (id: string) => void;
}) {
  const settled = isCrewSettled(member.state);
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, minWidth: 0 }}>
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap title={member.agent.label}>
          {member.agent.label}
        </Typography>
        {/* The runtime's OWN totals: it measured the agent's whole life,
            including what never reached this feed. */}
        <Typography variant="caption" sx={{ color: toneColor(crewTone(member.state)), overflowWrap: "anywhere" }}>
          {formatAgentStatus(member.agent)}
        </Typography>
        {!settled && member.caption && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {member.caption}
          </Typography>
        )}
      </Box>

      {/* Its closing report: a spawned agent's transcript dies with its pod,
          so this is the only copy. */}
      {member.agent.report && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", borderLeft: 2, borderColor: "divider", pl: 1.5 }}
        >
          {member.agent.report}
        </Typography>
      )}

      <AgentPlan plan={member.plan} />
      <Subagents children={member.children} onSelect={onSelect} />
      <RunningInBackground tasks={member.tasks} now={now} />

      <Box component="section" aria-label="Steps">
        <Heading>Steps</Heading>
        <AgentSteps key={member.id} steps={member.steps} />
      </Box>
    </Box>
  );
}
