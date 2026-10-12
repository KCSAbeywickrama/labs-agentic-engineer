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
 * Area profiles: what an area's chat sub-agent is, as data. An AREA is a
 * main-panel page whose chat has a sub-agent of its own (Issues); a FOCUS
 * narrows it to one entity (an issue). A profile names the tools the
 * sub-agent may take (built-in and MCP, by registry name, `../tools/registry.ts`),
 * the platform skills inlined into its prompt, and what a turn reports back
 * to the main chat. One generic factory builds the sub-agent from a resolved
 * scope (`./sub-agent.ts`); no area has agent code of its own.
 */

import type { AreaId } from "@aep/agent-stream";
import { TOOLS, type RegisteredTool } from "../tools/registry.js";

export type FocusKind = "issue";

/** The entity an area is narrowed to. */
export interface Focus {
  kind: FocusKind;
  /** The issue's number. */
  number: number;
}

/**
 * What a turn of the sub-agent tells the main chat: its outcome as a branch
 * note, a summary when its focus closes (not built yet: tells nothing), or
 * nothing.
 */
export type ReportsBack = "outcome-note" | "on-close-summary" | "none";

export interface AreaScope {
  /** The tools the sub-agent may take, built-in and MCP, by registry name (an allow-list). */
  tools: readonly string[];
  /** The platform skills (`audience: [chat]`) inlined into its prompt, in order. */
  skills: readonly string[];
  reportsBack: ReportsBack;
}

export interface AreaProfile {
  id: AreaId;
  /** The area's name on screen, and wherever the platform names its chat to another. */
  label: string;
  /**
   * A hand-off target: when the main agent passes the user's words here. The
   * sentence completes "when …" in the `hand_off` tool's description.
   */
  handOff?: { sentence: string };
  /** The area's own chat. */
  base: AreaScope;
  /** A focused chat's scope: each field it states REPLACES the base's. */
  focus?: Partial<Record<FocusKind, Partial<AreaScope>>>;
}

/** One profile per wire area (`@aep/agent-stream` `AREAS`), keyed by its id. */
export const AREAS: Readonly<Record<AreaId, AreaProfile>> = {
  issues: {
    id: "issues",
    label: "Issues",
    handOff: {
      sentence:
        "the user reports something broken in the app, asks for a capability the app lacks, as a work item, " +
        "wants an issue filed or found, or starts a message with `/issue` — to record or find a work item " +
        "(a bug, a missing capability, an improvement); never draft or file an issue yourself, and do not " +
        "search for issues",
    },
    base: {
      tools: ["ask_question", "ask_questions", "classify_report", "search_issues", "create_issue"],
      skills: ["issue-triage"],
      reportsBack: "outcome-note",
    },
    focus: {
      issue: {
        tools: [
          "ask_question",
          "ask_questions",
          "get_issue",
          "list_components",
          "comment_issue",
          "edit_issue",
          "close_issue",
          "reopen_issue",
          "hand_to_coding_agent",
        ],
        skills: ["issue-work"],
        reportsBack: "on-close-summary",
      },
    },
  },
};

/** One turn's scope: the area, its focus, and the scope the focus resolved to. */
export interface ResolvedScope extends AreaScope {
  area: AreaProfile;
  focus?: Focus;
}

/**
 * What is wrong with `scope` against `registry`: a tool it does not know, or a
 * write (not read-only) without a confirmation, which the gate could not hold.
 * Empty when nothing is.
 */
export function scopeProblems(scope: AreaScope, registry: Readonly<Record<string, RegisteredTool>> = TOOLS): string[] {
  return scope.tools.flatMap((name) => {
    const tool = Object.hasOwn(registry, name) ? registry[name] : undefined;
    if (tool === undefined) return [`${name}: not a registered tool`];
    if (!tool.readOnly && tool.confirm === undefined) return [`${name}: a write without a confirmation`];
    return [];
  });
}

/** Throws when `scope` names an unknown tool or an unconfirmed write (`scopeProblems`). */
export function assertScopeHolds(scope: ResolvedScope): void {
  const problems = scopeProblems(scope);
  if (problems.length > 0) throw new Error(`area ${scope.area.id}: ${problems.join("; ")}`);
}

/**
 * The scope of `area`'s chat, narrowed to `focus` when given: the focus's
 * scope over the base, field by field. A scope that names an unknown tool or
 * an unconfirmed write is refused (`assertScopeHolds`).
 */
export function scopeFor(area: AreaId, focus?: Focus): ResolvedScope {
  const profile = AREAS[area];
  const overlay = focus === undefined ? {} : (profile.focus?.[focus.kind] ?? {});
  const scope: ResolvedScope = {
    ...profile.base,
    ...overlay,
    area: profile,
    ...(focus !== undefined ? { focus } : {}),
  };
  assertScopeHolds(scope);
  return scope;
}
