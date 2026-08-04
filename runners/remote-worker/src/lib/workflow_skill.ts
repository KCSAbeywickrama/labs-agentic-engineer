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

// Composes the `aep` workflow skill for ONE agent mode. The whole module is
// about a single file: `skills/aep/SKILL.md`, and what it says for a mode.
//
// The runner no longer builds a plugin. Every skill a coding session reads —
// the workflow included — arrives as the project's `.claude/skills/` mirror,
// written by the BFF in production and by `local_skill_mirror.ts` in the
// playground. So the one thing left that the library alone cannot express is
// the local-mode variant of the workflow, and this is where it is derived:
//
//   `skills/aep/overlays/local.md` turns the platform's run (a clone, the
//   issues API, one pull request) into the playground's (a project dir,
//   `issues/*.md`, no remote). See skill_overlay.ts and ADR-0005.
//
// Composing per run rather than at build time is deliberate: the dev flow and
// the playground bind-mount the library, so a skill edit applies to the next run
// with no rebuild, and there is no generated artifact to go stale.

import fs from "node:fs";
import path from "node:path";
import { applyOverlay, parseOverlay } from "./skill_overlay.js";

/**
 * Which flavour of the workflow skill to compose.
 *
 * `github` — the platform's dispatched run: a repo clone, the issues API,
 * branch identity, one PR. `local` — the playground: a plain project dir,
 * `issues/*.md`, no remote, a progress note.
 */
export type AgentMode = "github" | "local";

/** The workflow skill, and the one file an overlay may edit. */
export const WORKFLOW_SKILL = "aep";

/** Overlay per mode, relative to the workflow skill's dir. `github` is the trunk. */
const MODE_OVERLAY: Record<AgentMode, string | undefined> = {
  github: undefined,
  local: path.join("overlays", "local.md"),
};

/**
 * The one subdirectory of an authored skill that is NOT skill content: the mode
 * overlays this module reads. Every writer that copies a skill filters it out —
 * `local_skill_mirror.ts` here, and `loadLibrary` in `aep-api`'s `repo_store.go`,
 * which keeps it out of every org repo and so out of the BFF's mirror too. The
 * `aep` skill explicitly permits reading its own directory, so an overlay landing
 * beside `SKILL.md` would be a second, contradictory procedure the agent can find
 * (ADR-0005; ADR-0001 decision 5 is the original form of the same hazard).
 */
export const OVERLAYS_DIR = "overlays";

export const SKILL_FILE = "SKILL.md";

/**
 * Read the workflow skill and apply the mode's overlay, if it has one.
 *
 * Synchronous by design: every caller runs it at startup, before the first token.
 *
 * Throws when the mode's overlay is missing or malformed, and `applyOverlay`
 * throws when any directive fails to match exactly once. A session steered by
 * half a procedure is worse than one that never starts — a silent miss would
 * leave the platform's `gh`/PR steps in a run that has no remote.
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
