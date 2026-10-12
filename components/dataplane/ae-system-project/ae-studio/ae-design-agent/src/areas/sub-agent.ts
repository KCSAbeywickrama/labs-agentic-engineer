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
 * The generic sub-agent: the agent behind an area's chat (the Issues chat, an
 * issue's chat), built per turn from its resolved scope (`./profiles.ts`). It
 * takes exactly the tools its scope names — a built-in from the registry's
 * factory, an MCP tool by name from what the chat's MCP route listed this
 * turn (anything else the route lists is dropped) — gates every write on the
 * user's own answer (`../tools/gate.ts`), and its instructions are assembled
 * from the scope (`./prompt.ts`). No spec bundle and no file tools; a skill
 * loader only when the scope has other chat skills to catalog.
 */

import type { AskQuestionInput, Surface } from "@aep/agent-stream";
import type { ToolSet } from "ai";
import type { SkillSource } from "../agents/main/skill-source.js";
import { buildSkillTools } from "../agents/main/tools/skill-tools.js";
import { buildToolLoopAgent, type AgentRunSettings, type TurnAgent } from "../agents/run-settings.js";
import type { McpTransport } from "../shared/mcp-client.js";
import { gateConfirmations } from "../tools/gate.js";
import { registeredTool } from "../tools/registry.js";
import { assertScopeHolds, type ResolvedScope } from "./profiles.js";
import { buildSubAgentInstructions } from "./prompt.js";
import { cataloguedSkills, chatSkills } from "./skills.js";

export interface SubAgentContext {
  /** The chat's MCP route, where aep-api answers a built-in like `classify_report` (`undefined`: none). */
  route: McpTransport | undefined;
  /** The MCP tools the route listed this turn (`{}` when it has none). */
  mcpTools: ToolSet;
  /** This turn's raw user instruction: the gate reads it. */
  instruction: string;
  /**
   * The question card the user is answering (`answerableQuestion` over the
   * conversation's stored history): a confirmed write makes only the change
   * it showed.
   */
  asked: AskQuestionInput | undefined;
  skills?: SkillSource | undefined;
  surface?: Surface | undefined;
  /** The project the chat belongs to; the prompt names it. */
  project?: string | undefined;
}

/** The scope's tools: each named built-in made, each named MCP tool the route listed taken. */
function scopeTools(scope: ResolvedScope, ctx: SubAgentContext): ToolSet {
  const tools: ToolSet = {};
  for (const name of scope.tools) {
    const entry = registeredTool(name);
    // A built-in is always this registry's, so an MCP tool of the same name never stands in for it.
    if (entry?.source === "built-in") tools[name] = entry.build({ route: ctx.route });
    else if (entry?.source === "mcp" && ctx.mcpTools[name] !== undefined) tools[name] = ctx.mcpTools[name];
  }
  return tools;
}

export function buildSubAgent(scope: ResolvedScope, ctx: SubAgentContext, run: AgentRunSettings): TurnAgent {
  // `scopeFor` checked it already; checked again here because the gate below
  // only holds a write the registry gives a confirmation, so a scope built
  // another way must not reach the model with an unconfirmed one.
  assertScopeHolds(scope);
  // Every write refuses until the user's own answer to its question, and then
  // makes only the change its card showed: the prompt asks for the same, and
  // this is what holds when text the model read tries to talk it past the
  // question.
  const gated = gateConfirmations(scopeTools(scope, ctx), ctx.instruction, ctx.asked);
  const skillTools =
    ctx.skills !== undefined && cataloguedSkills(scope, ctx.skills).length > 0 ? buildSkillTools(chatSkills(ctx.skills)) : {};
  return buildToolLoopAgent(run, {
    instructions: buildSubAgentInstructions(scope, ctx),
    tools: { ...gated, ...skillTools },
  });
}
