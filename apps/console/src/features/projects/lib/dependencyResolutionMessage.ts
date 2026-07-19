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

// The "Resolve via chat" seed message (#252 Task 5): seeded into the
// project's EXISTING collab conversation (no new conversation, no new
// useCase — turns.ts is unchanged) to ask the architect to resolve ONE
// external dependency. Lives alongside promptStore.ts (same "instruction the
// console hands the agent" responsibility) but in its own file since its
// shape — a dependency's JSON entry + a resolution playbook — is unrelated
// to the create-prompt storage promptStore.ts owns.
//
// The actual on-card/drawer "Resolve via chat" BUTTON is Task 9's job; this
// only builds the message it sends (via the pendingSeed plumbing in
// chatStore.ts + useResolveDependencyViaChat).

import type { components } from "../../../generated/aep-api";

type Dependency = components["schemas"]["Dependency"];

/**
 * Build the seeded chat message for one dependency. Embeds the dependency's
 * CURRENT entry (including its read-time computed `status`/`reason` from
 * `GET /projects/{p}/design/dependencies` — Task 2's single resolution
 * authority; NEVER recomputed here) plus a playbook telling the agent
 * exactly how to resolve it, so the turn has everything it needs without the
 * console guessing at resolution rules that belong to the
 * `high-level-architecture` skill.
 */
export function buildDependencyResolutionMessage(
  componentName: string,
  dep: Dependency,
): string {
  const specPath = `specs/design/components/${componentName}/dependencies/${dep.name}.openapi.yaml`;
  const statusLine = dep.status
    ? `Current status: ${dep.status}${dep.reason ? ` — ${dep.reason}` : ""}`
    : "Current status: not yet computed.";

  return [
    `Resolve the "${dep.name}" dependency on the "${componentName}" component.`,
    "",
    statusLine,
    "",
    "Current entry:",
    "```json",
    JSON.stringify(dep, null, 2),
    "```",
    "",
    "Playbook — follow the high-level-architecture skill:",
    `- Resolve only this dependency ("${dep.name}"); do not edit any other dependency's entry.`,
    "- Pick or pin one option: set `style` + `package` for an SDK-style dependency, or fetch/validate the contract and set `specPath` for a REST-with-spec dependency.",
    "- If choosing among `candidates`, fold the chosen candidate's `docsUrl` (and its `specUrl`/package-registry link) into `sources`, then remove `candidates`.",
    "- Derive the `config` keys the component needs from the chosen option.",
    `- If you collect an OpenAPI spec, store it at \`${specPath}\` and point \`specPath\` there.`,
    "- Ask the user when anything is ambiguous or you're unsure which option to pick.",
  ].join("\n");
}
