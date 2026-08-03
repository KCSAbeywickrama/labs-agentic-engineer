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
 * LOCAL MODE ONLY — the playground's stand-in for the BFF's project-repo skill
 * mirror. Production writes the coding-relevant slice of the org library into
 * the project repo at `.claude/skills/` (aep-api `SyncProjectSkills`); the
 * playground has no BFF, so `local.ts` copies a working-tree library
 * (AEP_LOCAL_SKILLS_DIR) into the same place.
 *
 * It applies the SAME copy rule as production, deliberately:
 *
 *   copied = (audience includes "coding" AND enabled) OR pinned
 *
 * A blunt directory copy was the obvious shortcut and the wrong one — it puts
 * design-only skills (task-planning, high-level-architecture, …) into a build's
 * clone, so the playground would show a mirror that can never occur in
 * production and would hide the filtering this whole feature exists to do.
 *
 * Availability has no local admin surface, so AEP_DISABLED_SKILLS stands in for
 * the org toggle — the same variable the playground's design side already uses
 * for the agents-service snapshot, so one run's two halves agree.
 */

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

/** Leading YAML frontmatter fence (LF-normalized). */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

const AUDIENCE_DESIGN = "design";
const AUDIENCE_CODING = "coding";

/**
 * The audiences a SKILL.md declares (`metadata.aep.audience`). Unrecognised
 * values are dropped; nothing declared resolves to EVERY audience — the
 * permissive default the Go and agents-service parsers both apply, so an
 * unmarked or org-authored skill keeps working.
 */
export function skillAudience(skillMd: string): string[] {
  const m = FRONTMATTER_RE.exec(skillMd.replace(/\r\n/g, "\n"));
  if (!m) return [AUDIENCE_DESIGN, AUDIENCE_CODING];
  let fm: unknown;
  try {
    fm = parseYaml(m[1] ?? "");
  } catch {
    return [AUDIENCE_DESIGN, AUDIENCE_CODING]; // unparseable → permissive, never hidden
  }
  const aep = (fm as { metadata?: { aep?: { audience?: unknown } } } | null)?.metadata?.aep;
  const declared = Array.isArray(aep?.audience) ? aep.audience : [];
  const audience = declared.filter((a): a is string => a === AUDIENCE_DESIGN || a === AUDIENCE_CODING);
  return audience.length > 0 ? audience : [AUDIENCE_DESIGN, AUDIENCE_CODING];
}

/** Whether a skill's guidance is written for the coding agent. */
export function audienceIncludesCoding(audience: string[]): boolean {
  return audience.length === 0 || audience.includes(AUDIENCE_CODING);
}

export interface MirrorSelection {
  /** Skill names the rule admits into the project's `.claude/skills/`. */
  copied: string[];
  /** Names withheld, with why — logged so a local run explains its own mirror. */
  skipped: Array<{ name: string; reason: "design-only" | "disabled" }>;
}

/**
 * Apply the copy rule to a working-tree library. `pinned` overrides BOTH axes:
 * a component that pinned a skill needs it whatever its audience or
 * availability says, which is the drift guard production carries too — an
 * admin toggle must not break a build already designed against a skill.
 */
export function selectMirroredSkills(
  library: Array<{ name: string; skillMd: string }>,
  pinned: ReadonlySet<string>,
  disabled: ReadonlySet<string>,
): MirrorSelection {
  const copied: string[] = [];
  const skipped: MirrorSelection["skipped"] = [];
  for (const { name, skillMd } of library) {
    if (pinned.has(name)) {
      copied.push(name);
      continue;
    }
    if (disabled.has(name)) {
      skipped.push({ name, reason: "disabled" });
      continue;
    }
    if (!audienceIncludesCoding(skillAudience(skillMd))) {
      skipped.push({ name, reason: "design-only" });
      continue;
    }
    copied.push(name);
  }
  return { copied, skipped };
}

/** Names in `AEP_DISABLED_SKILLS` (comma-separated) — the local availability toggle. */
export function disabledSkillNames(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.AEP_DISABLED_SKILLS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== ""),
  );
}

/** Read a flat `<name>/SKILL.md` library; dirs without a readable SKILL.md are not skills. */
export async function readLocalLibrary(skillsDir: string): Promise<Array<{ name: string; skillMd: string }>> {
  const entries = await fs.promises.readdir(skillsDir, { withFileTypes: true });
  const out: Array<{ name: string; skillMd: string }> = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    try {
      out.push({ name: e.name, skillMd: await fs.promises.readFile(path.join(skillsDir, e.name, "SKILL.md"), "utf8") });
    } catch {
      continue; // no readable SKILL.md → not a skill
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Copy the admitted skills into `<workspace>/.claude/skills/`. Per-skill copies
 * (not a whole-tree copy) so withheld skills never land, and so a project's own
 * committed `.claude/skills/` entries survive except where a name collides.
 */
export async function mirrorLocalSkillLibrary(
  skillsDir: string,
  workspace: string,
  pinned: ReadonlySet<string>,
  log: (line: string) => void = () => {},
): Promise<MirrorSelection> {
  const library = await readLocalLibrary(skillsDir);
  const selection = selectMirroredSkills(library, pinned, disabledSkillNames());
  const mirrorDir = path.join(workspace, ".claude", "skills");
  await fs.promises.mkdir(mirrorDir, { recursive: true });
  for (const name of selection.copied) {
    await fs.promises.cp(path.join(skillsDir, name), path.join(mirrorDir, name), { recursive: true });
  }
  if (selection.skipped.length > 0) {
    const detail = selection.skipped.map((s) => `${s.name} (${s.reason})`).join(", ");
    log(`[local] mirror withheld ${selection.skipped.length} skill(s): ${detail}`);
  }
  log(`[local] mirrored ${selection.copied.length} skill(s) into .claude/skills/`);
  return selection;
}
