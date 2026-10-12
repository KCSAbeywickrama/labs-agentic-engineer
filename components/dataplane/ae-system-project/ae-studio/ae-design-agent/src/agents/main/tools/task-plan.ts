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

/**
 * The task-plan tool (`planBuild`) the generic agent calls on a
 * `toolset: "task-plan"` turn, built over a `BuildPlan` accumulator. `execute()`
 * validates + accumulates ONLY — the service never touches GitHub; the BFF plan
 * tap writes the build issue off the stream.
 *
 * The Zod `inputSchema` is imported from `@aep/agent-stream` rather than
 * redeclared here (the file tools keep theirs local): it is the SAME definition
 * the published JSON Schema is rendered from, drift-guarded against the wire
 * `BuildPlanInput` type there.
 */

import { tool } from "ai";
import type { Tool } from "ai";
import { PLAN_BUILD, buildPlanInputSchema, type BuildPlanResult } from "@aep/agent-stream";
import { buildSkillTools } from "./skill-tools.js";
import type { SkillSource } from "../skill-source.js";
import type { BuildPlan } from "../task-plan-accumulator.js";

/**
 * Build the task-plan tool set bound to one accumulator for the turn. Registers
 * `planBuild` and (when skills are supplied) the shared skill loaders — NO file
 * tools. The catalog behaves exactly as on a files turn.
 */
export function buildTaskPlanTools(plan: BuildPlan, skills?: SkillSource): Record<string, Tool> {
  const tools: Record<string, Tool> = {
    [PLAN_BUILD]: tool({
      description:
        "Write the build's checklist, in the order the coding agent works it. Each item names the design components " +
        "it changes and a short note for the coding agent. A later call replaces the checklist. Returns the " +
        "normalized checklist, or an error code with a message and the items the version carries, in an order that builds.",
      inputSchema: buildPlanInputSchema,
      execute: async ({ items }): Promise<BuildPlanResult> => plan.planBuild({ items }),
    }),
  };

  return { ...tools, ...buildSkillTools(skills) };
}
