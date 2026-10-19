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
import { planTone, type CrewPlanItem } from "@aep/progress-view";
import { toneColor } from "../model/tone";

// The agent's OWN plan: the task list it keeps for itself, as `work_item
// {source: plan}` puts it on the feed. Drawn in the inspector only, for the one
// agent a reader picked: a lead holds every entry `in progress` for most of a
// run, so in the tree (whose job is "is anything moving") the entries were the
// rows that changed least while taking the most room.
//
// Quiet on purpose: a plan is context, and only the glyph carries an entry's
// weight. Nothing here folds anything — `CrewMember.plan` arrives folded and
// placed on its owner by the crew model the playground reads too.

/** Where an entry stands, as a glyph whose SHAPE differs per status; the word sits at the row's end too. */
const PLAN_GLYPHS: Record<string, string> = {
  pending: "☐",
  in_progress: "▸",
  completed: "☑",
};

function PlanRow({ item }: { item: CrewPlanItem }) {
  // Only the creating event is sure to carry a title; an id is a poor name and a true one.
  const title = item.title || item.id;
  return (
    <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, py: 0.25 }}>
      <Typography component="span" aria-hidden variant="caption" sx={{ flexShrink: 0, color: toneColor(planTone(item.status)) }}>
        {PLAN_GLYPHS[item.status] ?? "☐"}
      </Typography>
      <Typography component="span" variant="caption" title={title} noWrap sx={{ minWidth: 0 }}>
        {title}
      </Typography>
      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: "auto", flexShrink: 0 }}>
        {item.status.replace(/_/g, " ")}
      </Typography>
    </Box>
  );
}

/** One agent's plan, under a heading. Nothing at all when it kept none: most agents do not. */
export function AgentPlan({ plan }: { plan: readonly CrewPlanItem[] }) {
  if (plan.length === 0) return null;
  const done = plan.filter((p) => p.status === "completed").length;
  return (
    <Box component="section" aria-label="Plan">
      <Typography variant="overline" color="text.secondary" sx={{ display: "block", lineHeight: 2 }}>
        Plan · {done} of {plan.length} done
      </Typography>
      {plan.map((item) => (
        <PlanRow key={item.id} item={item} />
      ))}
    </Box>
  );
}
