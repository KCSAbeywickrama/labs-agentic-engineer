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
 * What a validation run is doing, on its own issue, while it does it.
 *
 * An issue's newest comment is its status line (ADR-0010). On a validation run
 * that line stood still for hours: the skill asked the agent to keep it current
 * in a section beside the numbered workflow, only steps 1 and 10 carried an
 * actual imperative, and those two were exactly the two comments a real run
 * produced — an opener, then silence through the browser exploration the skill
 * itself calls "the longest stretch of this phase and the only one nothing else
 * can see into".
 *
 * So the line is INFERRED here, the same bargain validation_progress.ts already
 * makes for the console's per-criterion rows: read the states off calls the run
 * has to make anyway rather than asking it to report. ADR-0010 declined that for
 * the status line on the grounds that nothing can infer prose about intent from
 * a Write call, which holds for a coding run — "todo-api builds clean" is a
 * judgement — and does not hold here. A validation run is one agent on one issue
 * walking a fixed procedure, and every beat worth reporting is already a tool
 * call it must make.
 *
 * Two rules keep this honest, and both answer ADR-0009's objection to phase
 * markers (that the workflow's steps interleave, so a marker naming a step is
 * wrong for most of the run):
 *
 *   - EACH LINE NAMES THE EVIDENCE, NOT THE STEP. The first `npm test` fires
 *     inside step 6 while the run is still authoring, so "step 7 has begun"
 *     would be wrong for an hour. "Running specs against the deployed system" is
 *     true when posted and never false in hindsight.
 *   - IT IS A RATCHET THAT CAN ROLL BACK. Each state posts on first occurrence,
 *     so the twelve criteria after the first add nothing. But step 9's exit-2
 *     loop back to authoring is the ordinary path, and a run that returned there
 *     under a "generating the report" line would be silent-and-wrong rather than
 *     just silent — so a state EARLIER than the high-water mark posts again and
 *     resets it.
 *
 * What this deliberately does NOT do:
 *
 *   - Replace the agent's own line. Steps 1 and 10 still ask for an opener and a
 *     closing summary, and a blocker is still the agent's to report — those are
 *     judgements, which is exactly what cannot be read off a tool call. Newest
 *     comment wins, so anything the agent says overrides the ladder.
 *   - Decide anything. Like the progress hook next door it observes and returns
 *     an empty decision; a status line that could block a write would be a far
 *     worse bargain than no status line.
 *   - Report per criterion. That is validation_progress.ts's job and the console
 *     already draws a row each. This line is about the RUN.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { HookCallback, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { ValidationProgressState, validationProgressUpdates } from "./validation_progress.js";

const execFileAsync = promisify(execFile);

/**
 * The brand that tells the platform's observation from somebody's own words.
 *
 * Duplicated from the BFF's `sourcecontrol.ObservedCommentMarker` rather than
 * shared, because that is a Go constant a language boundary away; the two are
 * pinned to each other by a test on each side. Without it the BFF cannot
 * classify these at all: it drops what it wrote FOR THE AGENT and keeps what it
 * wrote for a person, and authorship cannot separate them — the platform
 * comments through the org's credential and this pod is handed the same one.
 */
export const OBSERVED_COMMENT_MARKER = "<!-- aep:observed -->";

/**
 * The states, in the order a run reaches them. The order is what makes the
 * ratchet meaningful: "earlier than the high-water mark" is a rollback.
 *
 * Three of them ARE `ProgressItemStatus` values, read through the same
 * derivation the console's rows use — one vocabulary, two surfaces, so a row and
 * this line can never disagree about what the run just did. The two ends have no
 * per-criterion status because they are not about a criterion.
 */
export const LADDER = ["harness", "exploring", "authoring", "running", "reporting"] as const;

export type LadderState = (typeof LADDER)[number];

/**
 * What each state says. One line, present tense, naming the evidence.
 *
 * The first non-empty line of the newest comment IS the status line, so these
 * are the whole claim — there is no second line a reader will see.
 */
export const LADDER_LINES: Record<LadderState, string> = {
  harness: "Setting up the Playwright harness under tests/e2e.",
  exploring: "Driving the deployed app with playwright-cli to author specs.",
  authoring: "Writing spec bodies from what the app actually does.",
  running: "Running specs against the deployed system.",
  reporting: "Generating the validation report from the results on disk.",
};

/**
 * A ceiling on how many lines one run may post, whatever it does.
 *
 * The rollback rule has no natural bound — a run thrashing between authoring and
 * the report generator could post on every lap — and the read window that serves
 * the status line holds only the newest handful of comments per issue. Past this
 * the ladder goes quiet and leaves the last line standing, which is the same
 * thing a finished run does.
 */
export const MAX_POSTS = 12;

/**
 * A scaffold file: anything under the e2e package that is not a spec.
 *
 * This is the harness signal, and it is a WRITE rather than a shell command
 * because the shell form is the agent's to choose and the file is not. A run
 * that reached for `npm --prefix tests/e2e install` instead of the
 * `npm install --prefix tests/e2e` the skill writes produced no harness line at
 * all on p44, while `package.json`, `playwright.config.ts`, `targets.json` and
 * `lib/targets.ts` are named by the skill and land whatever the shell does. The
 * config is re-copied on EVERY run by instruction, so this fires on a
 * re-validation too, where the install may legitimately not happen.
 *
 * `specs/` is excluded, and that exclusion is what keeps the rung honest: a spec
 * file lives under this path and means exploring or authoring, one rung along.
 */
const HARNESS_FILE = /(^|\/)tests\/e2e\/(?!specs\/)/;

/**
 * An install of the e2e package — the two facts tested independently, because
 * their ORDER is the agent's. `npm install --prefix tests/e2e`,
 * `npm --prefix tests/e2e install` and `cd tests/e2e && npm install` are the
 * same act, and a pattern demanding the verb before the path recognises only the
 * first. Kept beside HARNESS_FILE as a second way in rather than the only one.
 */
const INSTALL_VERB = /\b(?:npm|pnpm|yarn)\b[^\n]*\b(?:install|ci)\b/;
const E2E_PACKAGE = /\btests\/e2e\b/;

/**
 * The platform's report generator, EXECUTED — not merely named.
 *
 * `node` is required in front of it because step 5 scaffolds the package by
 * copying this very file into the repo (`cp "$AEP_SKILLS_DIR/…/generate-report.mjs"
 * tests/e2e/scripts/…`), and a pattern matching the bare filename read that copy
 * as a verdict being generated. On p44 that posted "generating the validation
 * report" as the run's FIRST line, before the app had been opened. Same trap
 * validation_progress.ts documents for `cat specs/AC-001-a.spec.ts`, and the
 * same answer: match the act, not the mention.
 */
const REPORT_GENERATOR = /\bnode\s+[^\n]*\bgenerate-report\.mjs\b/;

/** Where a state sits in the ladder; -1 for anything not on it. */
function rank(state: LadderState): number {
  return LADDER.indexOf(state);
}

/**
 * The ladder's memory for ONE run: how far it has got, and how much it has said.
 *
 * Separated from the posting so the whole decision is testable against plain
 * strings — no SDK, no session, no `gh`.
 */
export class Ladder {
  private high = -1;
  private posts = 0;

  /**
   * Whether this state is news, and record it if so.
   *
   * News means either "further than the run has been" or "behind where it was",
   * and never "the state it is already in" — a criterion authored twelve times
   * is one line, and twelve identical comments would say nothing the first did
   * not.
   */
  admit(state: LadderState): boolean {
    if (this.posts >= MAX_POSTS) return false;
    const at = rank(state);
    if (at === this.high) return false;
    this.high = at;
    this.posts += 1;
    return true;
  }
}

/**
 * Which ladder state a tool call about to be dispatched announces, if any.
 *
 * `progress` is the SAME state object the console's rows are derived from, so
 * `exploring` / `authoring` / `running` here mean exactly what a row means. The
 * two ends are matched directly because no criterion status describes them.
 */
export function ladderStateFor(
  toolName: string,
  toolInput: unknown,
  progress: ValidationProgressState,
): LadderState | undefined {
  if (toolName === "Bash") {
    const command = readCommand(toolInput);
    if (REPORT_GENERATOR.test(command)) return "reporting";
    if (INSTALL_VERB.test(command) && E2E_PACKAGE.test(command)) return "harness";
  }

  // Checked BEFORE the per-criterion derivation, which owns everything under
  // `specs/` — HARNESS_FILE excludes that path, so the two cannot both answer.
  if (WRITE_TOOLS.has(toolName) && HARNESS_FILE.test(writtenPath(toolInput))) {
    return "harness";
  }

  for (const update of validationProgressUpdates(toolName, toolInput, progress)) {
    // `planned` (the test plan) and `healing`/`pass`/`fail` are real criterion
    // statuses with no rung of their own: the first is covered by `harness`
    // already standing, and the rest are what the rows say, per criterion, far
    // better than one run-wide line could.
    if (update.status === "exploring" || update.status === "authoring" || update.status === "running") {
      return update.status;
    }
  }
  return undefined;
}

/** Tools whose input names a file being authored — the same set the rows watch. */
const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

function writtenPath(toolInput: unknown): string {
  if (!toolInput || typeof toolInput !== "object") return "";
  const input = toolInput as Record<string, unknown>;
  const v = input.file_path ?? input.notebook_path;
  return typeof v === "string" ? v : "";
}

function readCommand(toolInput: unknown): string {
  if (!toolInput || typeof toolInput !== "object") return "";
  const v = (toolInput as Record<string, unknown>).command;
  return typeof v === "string" ? v : "";
}

/** Posts one line to the issue. Injected so the decision above owns no I/O. */
export type PostComment = (body: string) => Promise<void>;

/**
 * `owner/repo` out of a clone URL, the argument `gh --repo` wants.
 *
 * Naming the repository rather than letting `gh` infer it from the workspace's
 * remote: inference is one more thing that can be true in a pod and false in a
 * test, and this hook must be silent-and-correct or not run at all.
 */
export function repoSlug(repoUrl: string): string {
  const path = repoUrl
    .replace(/\.git$/, "")
    .replace(/^[a-z]+:\/\/[^/]+\//i, "")
    .replace(/^[^@]+@[^:]+:/, "");
  return path.split("/").slice(-2).join("/");
}

/**
 * Post through the REAL `gh`, never the workspace's `.aep/gh` wrapper — the
 * wrapper exists to refresh git credentials and is not on this path.
 *
 * `execFile`, so there is no shell: the body carries an HTML comment whose
 * angle brackets a shell would have to be trusted to leave alone, and argv
 * removes the question. Nothing secret is passed here, which is why the body may
 * ride in argv at all — see git_clone.ts for why a credential never may.
 */
export function ghCommentPoster(realGhPath: string, repoUrl: string, issueNumber: number): PostComment {
  const repo = repoSlug(repoUrl);
  return async (body) => {
    await execFileAsync(realGhPath, [
      "issue",
      "comment",
      String(issueNumber),
      "--repo",
      repo,
      "--body",
      body,
    ]);
  };
}

/**
 * Build the ladder for ONE validation run.
 *
 * `progress` is passed in rather than created here so a run that also reports
 * per-criterion rows derives both from ONE state — sharing it is what stops a
 * row saying `authoring` while this line still says `exploring`.
 */
export function createValidationStatusLine(
  progress: ValidationProgressState,
  post: PostComment,
  onError: (reason: string) => void,
): HookCallback {
  const ladder = new Ladder();

  return async (input) => {
    const hookInput = input as PreToolUseHookInput;
    if (hookInput?.hook_event_name !== "PreToolUse") return {};

    const state = ladderStateFor(hookInput.tool_name, hookInput.tool_input, progress);
    if (state === undefined || !ladder.admit(state)) return {};

    // Awaited rather than detached, because the whole value of a PreToolUse hook
    // here is that the line lands BEFORE the silence it explains — a detached
    // post during a twenty-minute exploration could land after it. A failure is
    // reported and swallowed: the run's work is the tests, and losing a status
    // line must never lose a criterion.
    //
    // The rung is spent either way — `admit` above has already moved the
    // high-water mark — so a post that failed is one line lost, not a ladder
    // stuck retrying. Whatever refused this call (a rate limit, a network) is
    // likely to refuse the next one too, and a hook that retried on every
    // matching call would turn one bad minute into a hundred.
    try {
      await post(`${OBSERVED_COMMENT_MARKER}\n${LADDER_LINES[state]}`);
    } catch (err) {
      onError(`status line not posted (${state}): ${err instanceof Error ? err.message : String(err)}`);
    }

    // Never a decision — see the header. This hook watches the calls the run
    // needs; it does not get to stop one.
    return {};
  };
}
