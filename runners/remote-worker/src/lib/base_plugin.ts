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

// Assembles the base workflow plugin the SDK session loads, for ONE agent mode.
//
// There is one authored skill library, repo-root `skills/`, holding the
// design-flow skills, the stack skills, and the runner's own workflow skills
// side by side. A coding session must load only the last group: a session that
// could see `design`'s description in its skill list is one turn away from being
// told to author `specs/`. So the plugin is a SELECTION, listed here and nowhere
// else, copied out of the library into a scratch dir at session start.
//
// Two things the copy does beyond copying:
//
//   - it applies `skills/aep/overlays/local.md` in local mode, which is what
//     turns the platform's run (a clone, the issues API, one pull request) into
//     the playground's (a project dir, `issues/*.md`, no remote). See
//     skill_overlay.ts and ADR-0004.
//   - it never carries an `overlays/` directory into the plugin. The `aep` skill
//     explicitly permits reading its own skill dir, so a local-mode overlay
//     sitting beside SKILL.md in a production session is a second procedure the
//     agent can find — the same hazard the old marker design closed by having no
//     unstripped path (ADR-0001 decision 5).
//
// Assembling per run rather than at build time is deliberate: the dev flow and
// the playground bind-mount the library, so a skill edit applies to the next run
// with no rebuild, and there is no generated artifact to go stale.

import fs from "node:fs";
import path from "node:path";
import { applyOverlay, parseOverlay } from "./skill_overlay.js";

/**
 * Which flavour of the base workflow skill to assemble.
 *
 * `github` — the platform's dispatched run: a repo clone, the issues API,
 * branch identity, one PR. `local` — the playground: a plain project dir,
 * `issues/*.md`, no remote, a progress note.
 */
export type AgentMode = "github" | "local";

/** The plugin name the SDK sees; `basePreload` entries are `aep:<skill>`. */
const BASE_PLUGIN_NAME = "aep";

/**
 * The library skills a runner session loads, and the only ones.
 *
 * `aep` is the workflow, preloaded for every run. `aep-validation` replaces its
 * run section for a validation task, and `playwright-cli` carries the browser
 * mechanics that validation depends on; both ride along in every mode because
 * the SDK loads a plugin as one directory and a description-triggered load is
 * how a validation run reaches them.
 */
export const BASE_PLUGIN_SKILLS = ["aep", "aep-validation", "playwright-cli"] as const;

/** The workflow skill, and the one file an overlay may edit. */
const WORKFLOW_SKILL = "aep";

/** Overlay per mode, relative to the workflow skill's dir. `github` is the trunk. */
const MODE_OVERLAY: Record<AgentMode, string | undefined> = {
  github: undefined,
  local: path.join("overlays", "local.md"),
};

/** Directory name inside a skill that holds compose-time input, never skill content. */
const OVERLAYS_DIR = "overlays";

const SKILL_FILE = "SKILL.md";

export interface AssembleBasePluginArgs {
  /** The authored skill library (repo-root `skills/`; `/app/skills` in the image). */
  libraryDir: string;
  /** Where to write the assembled plugin. Replaced if it already exists. */
  destDir: string;
  mode: AgentMode;
}

/**
 * Write the base plugin for `mode` into `destDir` and return it (the path to
 * hand the SDK as a `{type:"local"}` plugin).
 *
 * Synchronous by design: this runs once at session startup, before the first
 * token, and keeps `runClaudeQuery` a plain synchronous call.
 *
 * Throws when a listed skill is missing from the library, or when the mode's
 * overlay is missing or malformed. A session steered by half a procedure is
 * worse than one that never starts.
 */
export function assembleBasePlugin(args: AssembleBasePluginArgs): string {
  const { libraryDir, destDir, mode } = args;

  for (const skill of BASE_PLUGIN_SKILLS) {
    const skillMd = path.join(libraryDir, skill, SKILL_FILE);
    if (!fs.existsSync(skillMd)) {
      throw new Error(`skill library has no ${skill}/${SKILL_FILE}: ${libraryDir}`);
    }
  }

  // Compose BEFORE touching the destination: a malformed overlay must not leave
  // a half-written plugin dir behind for a retry to load.
  const workflow = composeWorkflowSkill(libraryDir, mode);

  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(destDir, ".claude-plugin"), { recursive: true });

  const manifest = {
    name: BASE_PLUGIN_NAME,
    version: "1.0",
    description:
      `AEP runner skills, assembled from the repo-root skill library for a ${mode} run: ` +
      `${BASE_PLUGIN_SKILLS.join(", ")}.`,
  };
  fs.writeFileSync(path.join(destDir, ".claude-plugin", "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o644,
  });

  for (const skill of BASE_PLUGIN_SKILLS) {
    fs.cpSync(path.join(libraryDir, skill), path.join(destDir, "skills", skill), {
      recursive: true,
      // Compose-time input stays out of the session — see the module comment.
      filter: (src) => !src.split(path.sep).includes(OVERLAYS_DIR),
    });
  }
  fs.writeFileSync(path.join(destDir, "skills", WORKFLOW_SKILL, SKILL_FILE), workflow, { mode: 0o644 });

  return destDir;
}

/**
 * Read the workflow skill and apply the mode's overlay, if it has one.
 *
 * Exported for the tests and for `make runner-plugin`: what the agent is steered
 * by is worth being able to print without spawning a session.
 */
export function composeWorkflowSkill(libraryDir: string, mode: AgentMode): string {
  const skillDir = path.join(libraryDir, WORKFLOW_SKILL);
  const authored = fs.readFileSync(path.join(skillDir, SKILL_FILE), "utf8");

  const overlayRel = MODE_OVERLAY[mode];
  if (overlayRel === undefined) return authored;

  const overlayPath = path.join(skillDir, overlayRel);
  let overlay: string;
  try {
    overlay = fs.readFileSync(overlayPath, "utf8");
  } catch {
    throw new Error(`mode "${mode}" needs the overlay ${WORKFLOW_SKILL}/${overlayRel}, which is missing: ${skillDir}`);
  }

  const sourceName = `${WORKFLOW_SKILL}/${overlayRel}`;
  return applyOverlay(authored, parseOverlay(overlay, sourceName), sourceName);
}
