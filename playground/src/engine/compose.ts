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
 * Instruction composition — the playground mirrors what aep-api composes
 * server-side for every console turn (docs/design/playground.md §9):
 *
 *   instruction + specPathsRule + targetSuffix
 *
 * and for the plan turn: planInstruction + renderPlanContext(contextFiles).
 *
 * Every prompt string here is imported from the GENERATED canonical module
 * (`@aep/contracts/prompts` ← packages/contracts/prompts/strings.json — the
 * same file `make gen` compiles into aep-api's internal/prompts), so the Go
 * and TS compositions cannot drift: there is exactly one authored copy and no
 * parity test to maintain.
 */

import {
  headlessNote,
  ideaSteerPrefix,
  planContextHeader,
  planInstruction,
  specPathsRule,
  startInstruction as startInstructionText,
  targetSuffixClose,
  targetSuffixPrefix,
} from "@aep/contracts/prompts";

export { headlessNote };

/**
 * Mirrors ideaSteer, services/aep-api/internal/spec/descriptor.go: the captured
 * idea appended to an expanded `/start`. A blank idea appends NOTHING, leaving
 * a bare skill load — the start skill then asks the user for it.
 */
export function ideaSteer(idea: string | null | undefined): string {
  const trimmed = (idea ?? "").trim();
  return trimmed === "" ? "" : ideaSteerPrefix + trimmed;
}

/**
 * The expanded `/start` turn — mirrors what aep-api composes in
 * expandFlowInstruction when it sees the command.
 *
 * The server owns every `/<skill>` expansion in production (#373); the
 * playground composes its own instructions instead of calling aep-api, so it
 * performs the same expansion here or the two surfaces would diverge on the
 * kickoff.
 */
export function startInstruction(idea: string | null | undefined): string {
  return startInstructionText + ideaSteer(idea);
}

/** Mirrors targetSuffix, services/aep-api/internal/spec/genai_service.go. */
export function targetSuffix(target: string | undefined): string {
  if (!target || target.trim() === "") return "";
  return targetSuffixPrefix + target + targetSuffixClose;
}

/**
 * The full server-side composition every console spec turn gets (#373: the
 * spec-paths rule is the ONE surviving steer; flow content lives in skills).
 */
export function composeSpecInstruction(text: string, target?: string): string {
  return text + specPathsRule + targetSuffix(target);
}

/**
 * Mirrors renderPlanContext, services/aep-api/internal/delivery/task/plan.go:
 * existing-task renderings (tasks/<n>.md) appended to the plan instruction as
 * deterministic sections — plan context is platform state and rides the
 * INSTRUCTION, never the snapshot.
 */
export function renderPlanContext(files: Record<string, string>): string {
  const paths = Object.keys(files);
  if (paths.length === 0) return "";
  paths.sort();
  let out = planContextHeader;
  for (const p of paths) {
    out += `\n--- ${p} ---\n${files[p]}\n`;
  }
  return out;
}

/** The plan turn's full instruction (production channel, §5 phase 3). */
export function composePlanInstruction(contextFiles: Record<string, string>): string {
  return planInstruction + renderPlanContext(contextFiles);
}
