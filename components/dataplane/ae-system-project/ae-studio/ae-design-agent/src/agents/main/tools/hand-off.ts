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
 * The hand-off tool the main agent calls (the `files` tool set): it passes the
 * user's words to an area's agent (`hand_off({area, request})`). The areas it
 * can name, and when to name each, are the area profiles with a `handOff`
 * (`../../../areas/profiles.ts`): no area has hand-off code of its own.
 * Calling it does NOT run that agent. The call ends the turn waiting for the
 * user (`handOffStop`), and the console offers to open that area's chat with
 * `request`, sent as the area's command; the area's agent runs on the user's
 * next message there.
 */

import { tool } from "ai";
import type { Tool } from "ai";
import { z } from "zod";
import {
  ANSWER_PREFIX,
  ANSWERS_PREFIX,
  HAND_OFF_TOOL,
  type AreaId,
  type Equal,
  type HandOffInput,
  type HandOffResult,
} from "@aep/agent-stream";
import { AREAS, type AreaProfile } from "../../../areas/profiles.js";

/** An area the main agent can hand a request to. */
export type HandOffTarget = AreaProfile & Required<Pick<AreaProfile, "handOff">>;

/** The profiles in `areas` with a hand-off, in order. */
export function handOffTargets(areas: readonly AreaProfile[] = Object.values(AREAS)): HandOffTarget[] {
  return areas.filter((area): area is HandOffTarget => area.handOff !== undefined);
}

/** True when `request` reads as an answer the console sends for a question card. */
function posesAsAnswer(request: string): boolean {
  const text = request.trim();
  return text.startsWith(ANSWER_PREFIX) || text.startsWith(ANSWERS_PREFIX);
}

function handOffInputSchema(targets: readonly [HandOffTarget, ...HandOffTarget[]]) {
  const ids = targets.map((t) => t.id) as [AreaId, ...AreaId[]];
  return z.object({
    area: z.enum(ids).describe("The area whose own chat the message belongs in."),
    request: z
      .string()
      .min(1)
      .max(2000)
      // Defence in depth: the console passes the request on as the area's
      // command, but a request shaped as an answer ("Answer to …", "Answers:")
      // could otherwise pose as the user's go-ahead in that chat.
      .refine((request) => !posesAsAnswer(request), {
        message: "The request is the user's own words, not an answer to a question.",
      })
      .describe("The user's own words, unchanged — what they reported or asked for. Never a draft of the area's work."),
  });
}

// Drift guard: the schema's inferred input stays equal to the wire type.
const _drift: [Equal<z.infer<ReturnType<typeof handOffInputSchema>>, HandOffInput>] = [true];
void _drift;

function handOffDescription(targets: readonly HandOffTarget[]): string {
  return [
    "Hand the user's message to an area's own chat, whose agent does that area's work. Pick the `area`:",
    ...targets.map((t) => `- "${t.id}" (${t.label}): when ${t.handOff.sentence}.`),
    "Not for changes the user wants made to the spec, the design or the prototype — make those yourself; hand off " +
      "only what an area's chat does. Pass their own words as `request`. Never do an area's work yourself. " +
      "Ends your turn; the user decides whether to continue in that area.",
  ].join("\n");
}

/** The hand-off tool, keyed by its wire name; none when no area takes a hand-off. */
export function handOffTools(areas?: readonly AreaProfile[]): Record<string, Tool> {
  const targets = handOffTargets(areas);
  const [first, ...rest] = targets;
  if (first === undefined) return {};
  return {
    [HAND_OFF_TOOL]: tool({
      description: handOffDescription(targets),
      inputSchema: handOffInputSchema([first, ...rest]),
      execute: async ({ area }): Promise<HandOffResult> => ({ status: "awaiting_handoff", area }),
    }),
  };
}
