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
 * The skills an area chat's sub-agent reads: the library seen as the `chat`
 * audience. Its catalog holds only the skills written for a chat
 * (`metadata.aep.audience: [chat]`), and a name outside it is unknown rather
 * than refused, so `loadSkill` over this view never tells a chat about the
 * design or coding agents' guidance.
 */

import type { SkillAudience, SkillCatalogEntry, SkillSource } from "../agents/main/skill-source.js";
import type { ResolvedScope } from "./profiles.js";

const CHAT: SkillAudience = "chat";

/** `skills` as a chat sub-agent reads it. */
export function chatSkills(skills: SkillSource): SkillSource {
  const entries = skills.catalog().filter((e) => e.audience.includes(CHAT));
  const names = new Set(entries.map((e) => e.name));
  return {
    catalog: () => entries,
    load: (name) => (names.has(name) ? skills.load(name, CHAT) : undefined),
    loadReference: (name, path) => (names.has(name) ? skills.loadReference(name, path) : undefined),
  };
}

/**
 * The chat skills `scope` does not inline: the catalog its prompt lists for
 * `loadSkill`. Empty without skills.
 */
export function cataloguedSkills(scope: ResolvedScope, skills: SkillSource | undefined): readonly SkillCatalogEntry[] {
  if (skills === undefined) return [];
  return chatSkills(skills)
    .catalog()
    .filter((e) => !scope.skills.includes(e.name));
}
