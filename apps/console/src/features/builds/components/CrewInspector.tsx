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
import {
  crewTone,
  formatAgentStatus,
  isCrewSettled,
  type CrewMember,
} from "@aep/progress-view";
import { toneColor } from "../../../components/logTone";
import { AgentPlan } from "./AgentPlan";
import { AgentReportNote, AgentSteps } from "./AgentSteps";
import type { StampedRunEvent } from "../hooks/useRunProgress";

// WHAT ONE AGENT DID. The tree answers who is alive; this answers what the one
// you picked has been doing, and nothing else — no other agent's steps are
// interleaved into it, which is the whole reason the tree exists beside it.
//
// Everything here is on the feed already. There is no narration and no file
// list: an invented summary of an agent's work is exactly the thing a reader
// cannot check, and the agent's own closing report is right there.

export function CrewInspector({ member }: { member: CrewMember<StampedRunEvent> }) {
  const settled = isCrewSettled(member.state);
  return (
    <Box sx={{ minWidth: 0 }}>
      {/* Stacked, not one row. The totals run to "completed · 3m29s · 19 tools ·
          +553/−4 lines · 214.0k tokens" and the label to a whole sentence, and
          side by side in a narrow column the label was the half that lost —
          leaving a panel whose figures nobody could attribute. */}
      <Box sx={{ pb: 0.5, mb: 1, borderBottom: 1, borderColor: "grey.800" }}>
        <Typography
          component="div"
          title={member.agent.label}
          sx={{
            font: "inherit",
            color: "grey.200",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {member.agent.label}
        </Typography>
        {/* The runtime's OWN totals — duration, tool count, lines written. It
            measured the agent's whole life, including the parts that never
            reached this feed, so nothing here is re-derived from the rows below. */}
        <Typography
          component="div"
          sx={{
            font: "inherit",
            color: toneColor(crewTone(member.state)),
            wordBreak: "break-word",
          }}
        >
          {formatAgentStatus(member.agent)}
        </Typography>
      </Box>

      {/* What it is waiting on, in the runtime's words. One line, and only while
          it is still live: on a settled agent the same slot carries its report,
          which is a different kind of sentence and belongs below. */}
      {!settled && member.caption && (
        <Typography component="div" sx={{ font: "inherit", color: "grey.400", mb: 1 }}>
          {member.caption}
        </Typography>
      )}

      {/* The one thing no flat feed could show: the agent's own closing summary.
          Its transcript dies with the pod, so this is the only copy. */}
      {member.agent.report && (
        <Box sx={{ mb: 1 }}>
          <AgentReportNote report={member.agent.report} />
        </Box>
      )}

      {/* What it SET OUT to do, above what it did. The tree carries the same
          rows under this agent's row, and that repetition is deliberate — the
          same way a settled agent's report is both its tree sub-line and the
          note below. The tree answers "what is this run trying to do" at a
          glance across every agent; this answers "did the one I picked get
          there", and it is the ONLY place the plan appears on a cycle with a
          single agent, where there is no tree at all. */}
      <AgentPlan plan={member.plan} />

      <AgentSteps steps={member.steps} />
    </Box>
  );
}
