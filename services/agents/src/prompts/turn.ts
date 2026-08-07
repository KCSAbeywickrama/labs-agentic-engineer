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
 * Turn-instruction composition — the ONE place a `TurnSpec` becomes prompt text.
 *
 * Callers state facts (`{kind: "start", idea}`); this module decides wording.
 * That split is the whole architecture: the BFF has the database, git and the
 * project descriptor, this service has the model, and prompt text belongs with
 * the model. Before it, the same sentences were authored in Go and TS at once —
 * eight of them through a JSON→codegen pipeline, and four more (the divergence
 * note, the flow skill pointer, the milestone-scope block, the plan-context
 * fences) hand-copied straight into the Go composer, where the pipeline could
 * not see them drift. See design/ADR-0003.
 *
 * Wording lives here as plain template strings. There is no generator and no
 * second copy: edit the text, and every surface that dispatches a turn — the
 * console through aep-api, the playground, the evals — gets it, because they
 * all send a `TurnSpec` and none of them composes.
 */

import type { PlanContextFile, PlanScope, Toolset, TurnSpec } from "@aep/agent-stream";

// --- Wording -----------------------------------------------------------------

/** The kickoff. The start skill owns the interview; this only points at it. */
const START_INSTRUCTION = "Load the start skill and follow it.";

/**
 * The captured idea, appended to a `start` turn. Deliberately neutral about
 * provenance: the idea reaches us either typed inline (`/start an expense
 * tracker`) or captured at project creation and read back from the descriptor.
 */
const IDEA_PREFIX = "\n\nThe user's idea for this project:\n\n";

/**
 * The ONE surviving content steer for spec turns (#373): flow behaviour lives
 * in skills, but a file created at a bare filename lands in the wrong place and
 * no skill is loaded early enough to prevent it.
 */
const SPEC_PATHS_RULE =
  "\n\nSpec sources live under specs/ (requirements under specs/requirements/, design under specs/design/) — when creating a file that does not exist yet, always use its full path, never a bare filename.";

/** The caller-pinned spec-bundle target. */
const TARGET_PREFIX = "\n\n(target: ";
const TARGET_CLOSE = ")";

/**
 * D20: the previous turn of this conversation FAILED, so the conversation
 * history claims work that git never received. Leads the instruction — the
 * agent has to reconcile the two before it does anything else.
 */
const PREVIOUS_TURN_FAILED_NOTE =
  "Note: your previous turn's changes were NOT applied; the workspace reflects the repository state.";

/** No interview is possible (the playground's headless phases). */
const HEADLESS_NOTE =
  "\n\nNo interview is possible in this run: do not call ask_question or ask_questions. Generate on stated assumptions and mark each assumption as assumed in the document.";

/**
 * The plan-turn directive. Per the layer charter it carries ONLY the skill
 * pointer, the bundle paths and the existing-Tasks fence — the planning
 * invariants live once in the task-plan system prompt, the mechanics once in
 * the task-planning skill.
 */
const PLAN_INSTRUCTION =
  'Plan the implementation Tasks for this project. Load the task-planning skill and follow it. The design is under specs/design/ and the requirements under specs/requirements/. When a "Milestone scope" section lists in-scope stories, cover every story marked NEEDS TASKS and leave COVERED stories\' Tasks untouched. Existing open Tasks (if any) are listed at the end of this message for reference — add Tasks ONLY for work they do not cover, and do not recreate or update the listed Tasks in this turn.';

const PLAN_CONTEXT_HEADER = "\n\n## Existing open Tasks in this version (reference)\n";

/**
 * Skills whose bodies are inlined up front for a flow (#335 latency): when the
 * flow already tells us which guidance applies, inlining it saves the model's
 * `loadSkill` round-trip — one whole model step before any output. A flow absent
 * here still runs; its skill loads lazily.
 *
 * This is a property of the FLOW, not of the call, which is why it lives beside
 * the wording rather than riding the wire: a console CTA, a typed command and a
 * playground run all reach the same map, so they cannot diverge.
 *
 * `organization` is deliberately NOT here, though the start/amend flows used to
 * name it: the org's standing defaults now ride the standing system
 * instructions on EVERY turn (see `buildOrgDefaultsBlock`), so listing it as a
 * per-flow eager skill would inline the same body twice.
 */
const FLOW_EAGER_SKILLS: Record<string, string[]> = {
  start: ["grilling"],
  amend: ["grilling"],
  design: ["design"],
};

// --- Composition -------------------------------------------------------------

/** Turn-level modifiers — facts the caller supplies, never text it formats. */
export interface TurnModifiers {
  /** The spec-bundle path this turn should write to. */
  target?: string | undefined;
  /** D20: the previous turn of this conversation failed (see the note above). */
  previousTurnFailed?: boolean | undefined;
  /** No interview is possible in this run. */
  headless?: boolean | undefined;
}

/**
 * A `TurnSpec` plus its modifiers, as the instruction text the agent receives.
 *
 * Shape: `[failure note] <body> [spec-paths rule] [target] [headless note]`.
 * The spec-paths rule is a property of the KIND — plan turns write no spec
 * files, so they never carry it — which is why it is not a caller flag.
 */
export function composeInstruction(turn: TurnSpec, mods: TurnModifiers = {}): string {
  const body = turn.kind === "plan" ? planBody(turn) : specBody(turn) + SPEC_PATHS_RULE + target(mods.target);
  const lead = mods.previousTurnFailed ? PREVIOUS_TURN_FAILED_NOTE + "\n\n" : "";
  return lead + body + (mods.headless ? HEADLESS_NOTE : "");
}

/** The instruction head for every kind that edits the spec bundle. */
function specBody(turn: Exclude<TurnSpec, { kind: "plan" }>): string {
  switch (turn.kind) {
    case "chat":
      // Ordinary chat rides verbatim — the user's words are the instruction.
      return turn.text;
    case "flow": {
      // A `/<skill>` command is a keyboard shortcut for "load a skill and
      // follow it". An unknown skill is NOT an error here: `loadSkill` reports
      // not-found and the agent says so, which is a better failure than a
      // client-side allowlist that goes stale against the org's catalog.
      const base = `Load the ${turn.skill} skill and follow it.`;
      return turn.text?.trim() ? `${base}\n\n${turn.text.trim()}` : base;
    }
    case "start":
      // A blank idea appends NOTHING, leaving a bare skill load — the start
      // skill then asks the user for it.
      return START_INSTRUCTION + idea(turn.idea);
  }
}

/** The plan turn: directive, milestone scope, then the existing-Task renders. */
function planBody(turn: Extract<TurnSpec, { kind: "plan" }>): string {
  return PLAN_INSTRUCTION + scopeBlock(turn.scope) + planContext(turn.taskContext);
}

function idea(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  return trimmed === "" ? "" : IDEA_PREFIX + trimmed;
}

function target(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  return trimmed === "" ? "" : TARGET_PREFIX + trimmed + TARGET_CLOSE;
}

/**
 * The milestone's story coverage. COVERED stories already have Tasks, so the
 * planner must leave them alone — this block is what makes a delta pass a delta
 * rather than a re-plan.
 */
function scopeBlock(scope: PlanScope | undefined): string {
  if (!scope || scope.phase === 0 || scope.stories.length === 0) return "";
  const rows = scope.stories
    .map((s) => {
      const status = s.covered ? "COVERED" : "NEEDS TASKS";
      return s.title ? `- Story ${s.number}: ${s.title} — ${status}` : `- Story ${s.number} — ${status}`;
    })
    .join("\n");
  return (
    `\n\n## Milestone scope — Phase ${scope.phase} (spec ${scope.tag})\n\n` +
    "Plan Tasks so every story marked NEEDS TASKS below is covered. COVERED stories already have Tasks — leave them alone.\n\n" +
    rows +
    "\n"
  );
}

/**
 * Existing-Task renders as deterministic sections, sorted by path so the same
 * inputs always produce the same prompt. They keep their historical
 * `tasks/<n>.md` names so the model's mental layout is unchanged.
 */
function planContext(files: PlanContextFile[] | undefined): string {
  if (!files?.length) return "";
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return PLAN_CONTEXT_HEADER + sorted.map((f) => `\n--- ${f.path} ---\n${f.body}\n`).join("");
}

// --- Derived turn properties -------------------------------------------------

/** Which skills to inline up front for this turn (empty for kinds with none). */
export function eagerSkillsFor(turn: TurnSpec): string[] {
  if (turn.kind === "flow") return FLOW_EAGER_SKILLS[turn.skill] ?? [];
  if (turn.kind === "start") return FLOW_EAGER_SKILLS.start ?? [];
  return [];
}

/**
 * Which tool set the turn needs. Planning registers `planTask`/`updateTask` and
 * NO file tools; everything else mutates the bundle. Derived rather than sent:
 * two ways to say it is two ways to disagree.
 */
export function toolsetFor(turn: TurnSpec): Toolset {
  return turn.kind === "plan" ? "task-plan" : "files";
}
