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
 * The canned phase-generation instructions — ONE source for every client that
 * starts a spec turn (the console's CTAs and the root-level playground; see
 * docs/design/playground.md §9). These are the CLIENT half of the instruction:
 * the server appends its live steering (`steeringByUseCase["general"]` +
 * `collabDepsSteer` + the target suffix — services/aep-api
 * internal/feature/genai) on every turn. Console turns never send a `useCase`,
 * so all of these run as `general` turns server-side.
 *
 * Exported as `@aep/contracts/prompts` — plain source, no build step, so a
 * prompt edit applies on the next playground run.
 */

/**
 * The grilling-interview directive (#270, console ADR-0012): interview-first
 * via the structured `ask_question`/`ask_questions` tools — options + a
 * recommended answer — with an explicit skip valve (the user can always say
 * "just generate"). Deliberately NOT baked into the generation builders:
 * an interactive client (the console's Generate-spec CTA) opts in with
 * `withGrillingInterview`, so headless/programmatic dispatchers of the same
 * builders (the playground CLI, evals) keep their one-shot, never-interrupted
 * turns.
 */
export const GRILLING_DIRECTIVE =
  "Before writing any files, interview me about this idea with the ask_question / ask_questions tools: " +
  "structured questions with candidate options and the one you recommend. Make every question decidable " +
  "on its own — explain in its detail why you ask and what it affects, and in each option's description " +
  "what choosing it means and its trade-offs. " +
  "Work through the idea's ambiguities until the requirements are unambiguous. " +
  "If a grilling skill is available in your catalog, load it first and follow it. " +
  "If I ask you to skip ahead or just generate, stop interviewing and proceed on " +
  "stated assumptions. When the interview is done, proceed with the following. ";

/** Wrap a generation instruction with the interview-first directive (#270). */
export function withGrillingInterview(instruction: string): string {
  return GRILLING_DIRECTIVE + instruction;
}

/**
 * The instruction the "Generate spec" CTA sends into the room turn (#150): an
 * explicit generate command (not the raw idea, which the agent might treat as
 * a chat opener) wrapping the stored create prompt. Falls back to a generic
 * instruction when no prompt was stored (older project / other browser /
 * cleared storage) — the CTA still works and the agent can ask for detail.
 * One-shot by itself; the console wraps it with `withGrillingInterview`.
 */
export function buildSpecGenerationInstruction(prompt: string | null): string {
  const base =
    "Generate a complete requirements specification (requirements/requirements.md) for this project";
  return prompt && prompt.trim()
    ? `${base} based on the following idea:\n\n${prompt.trim()}`
    : `${base}.`;
}

/**
 * The instruction the "Generate / Re-generate design" CTA sends into the room
 * turn (#159): the `/design` slash-skill expansion, so the button is exactly
 * the keyboard shortcut — one channel, whether the user clicks or types. The
 * `design` skill (skills/design/) owns the flow: derive the design from the
 * current requirements, then mint the validation criteria.
 */
export function buildDesignGenerationInstruction(): string {
  return slashSkillInstruction(DESIGN_COMMAND) as string;
}

/**
 * The chat-composer slash-command expander: a `/<skill>` message is a keyboard
 * shortcut for "load a skill and follow it", the same channel the tasks phase
 * already uses (`Load the task-planning skill and follow it`). It turns
 * `/<token> [text]` into an ordinary turn instruction the agent loads the skill
 * from its catalog to satisfy; anything else returns `null` (an ordinary chat
 * line the caller sends verbatim).
 *
 * ONE source for every client that exposes the shortcut (the console composer
 * and the playground chat surfaces), so there is no drift to guard — it is a
 * pure text→text function, no catalog lookup: an unknown `<token>` simply has
 * the agent's `loadSkill` report not-found (client-side validation/autocomplete
 * is parked, wso2/labs-agentic-engineer#325). The server and the turn engine are
 * untouched — this is a composer-side rewrite of the user's text, nothing more.
 *
 * Grammar (deliberately narrow, so real chat is never eaten): a single leading
 * `/`, then a skill-name token (`[a-z0-9-]+`) that must end at whitespace or the
 * message end, optionally followed by free text that rides after a blank line.
 * A bare `/`, a mid-message slash (`fix the /spec route`), `//spec`, or a
 * trailing-punctuation token (`/spec.`) are all left as literal chat. Callers
 * MUST resolve their own reserved control words (the playground's `/menu`,
 * `/quit`, `/grill`, …) BEFORE calling this — those are surface-specific and not
 * skill loads.
 */
/**
 * `/start` — the project kickoff, and the ONE slash command the SERVER expands
 * rather than the client (services/aep-api internal/spec/start_command.go).
 *
 * Every other `/<skill>` is rewritten here before the turn is sent. `/start`
 * must NOT be: only the server can enrich it with the idea captured in
 * `specs/.agentic-engineer.toml` — a file no client parses and the agent cannot
 * read. So callers send it through VERBATIM and let the server do the work.
 *
 * Note what this deliberately is NOT: a `useCase`. That field is part of the
 * conversation identity, so signalling the kickoff through it would put the
 * turn in a different conversation from the chat around it — and `/start` runs
 * an interview whose answers are ordinary chat turns, which would then land
 * somewhere the questions were never asked.
 */
export const START_COMMAND = "/start";

/** The design CTA's command — expanded client-side via `slashSkillInstruction`,
 *  unlike `/start`, which the server expands to enrich with the captured idea. */
export const DESIGN_COMMAND = "/design";

/**
 * Parse `/start [idea]`. Returns the inline idea (`""` when the command was
 * bare), or null when the line is not the command at all.
 *
 * The grammar mirrors Go's `parseStartCommand` and is deliberately narrow — the
 * exact token, alone or followed by whitespace — so prose that merely mentions
 * "/start" is never eaten.
 */
export function parseStartCommand(line: string): { inlineIdea: string } | null {
  const trimmed = line.trim();
  if (trimmed === START_COMMAND) return { inlineIdea: "" };
  if (trimmed.startsWith(START_COMMAND + " ")) {
    return { inlineIdea: trimmed.slice(START_COMMAND.length + 1).trim() };
  }
  return null;
}

export function slashSkillInstruction(line: string): string | null {
  const m = /^\/([a-z0-9-]+)(?:\s+([\s\S]+))?$/.exec(line.trim());
  if (!m) return null;
  const token = m[1];
  const rest = m[2]?.trim();
  const base = `Load the ${token} skill and follow it.`;
  return rest ? `${base}\n\n${rest}` : base;
}
