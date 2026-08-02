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

// Resolves pinned skill NAMES (from skills_resolver.ts) against the
// `.claude/skills/` mirror the BFF already wrote into the project clone —
// zero network, a filesystem check only.
//
// A pinned name with no `.claude/skills/<name>/SKILL.md` is DANGLING, not an
// error: the caller warns and preloads the rest. Missing guidance degrades a
// build; aborting the run over it loses the build entirely.

import fs from "node:fs";
import path from "node:path";

export interface PinnedSkillsResolution {
  /** Bare skill names with a readable .claude/skills/<name>/SKILL.md — preload these, kind-agnostic. */
  preload: string[];
  /** Pinned names with no matching copy on disk. */
  dangling: string[];
}

const SKILLS_MIRROR_DIR = path.join(".claude", "skills");

/**
 * Partition `names` into present (preload) vs dangling, checked against
 * `<workspace>/.claude/skills/<name>/SKILL.md`. Never throws — an absent
 * `.claude/skills/` directory simply means every name is dangling.
 */
export async function resolvePinnedSkills(
  workspace: string,
  names: string[],
  log: (line: string) => void = () => {},
): Promise<PinnedSkillsResolution> {
  const preload: string[] = [];
  const dangling: string[] = [];

  for (const name of names) {
    const skillMdPath = path.join(workspace, SKILLS_MIRROR_DIR, name, "SKILL.md");
    try {
      await fs.promises.access(skillMdPath, fs.constants.R_OK);
      preload.push(name);
    } catch {
      dangling.push(name);
      log(
        `[skills-presence] ⚠️  pinned skill ${JSON.stringify(name)} not found at ` +
          `.claude/skills/${name}/SKILL.md — skipping (guidance degraded, build continues)`,
      );
    }
  }

  return { preload, dangling };
}
