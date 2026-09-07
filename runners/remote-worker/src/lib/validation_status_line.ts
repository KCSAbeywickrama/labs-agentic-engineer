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
 *     would be wrong for an hour. "Running automated tests against the deployed
 *     system" is true when posted and never false in hindsight.
 *   - IT IS A ONE-WAY RATCHET WITH ONE EXCEPTION. Forward is news; behind is
 *     not, because the middle of the run oscillates by design — twelve criteria
 *     each walk exploring → authoring → running, and every heal walks the last
 *     two again. The exception is a fall from the LAST rung: step 9's exit-2
 *     sends a finished run back to authoring, and a reader left under
 *     "generating the report" would be silent-and-wrong rather than just
 *     silent. See Ladder.admit.
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
 * `repairing` is NOT a rung and deliberately has no rank.
 *
 * The rungs are places a run passes through in order. This is a MODE it is in:
 * the report generator refused, and everything the run does until it stops
 * refusing — re-running specs, editing one, generating again — is that repair.
 * Ranking it would make the repair a place to fall from and climb back to,
 * which is the oscillation it exists to absorb.
 */
export type LineKey = LadderState | "repairing";

/**
 * What each state says. One line, present tense, naming the evidence.
 *
 * The first non-empty line of the newest comment IS the status line, so these
 * are the whole claim — there is no second line a reader will see.
 */
export const LADDER_LINES: Record<LineKey, string> = {
  harness: "Setting up the test harness…",
  exploring: "Exploring the deployed app to author automated tests…",
  authoring: "Authoring automated tests…",
  running: "Running automated tests against the deployed system…",
  reporting: "Generating the validation report from the results on disk…",
  repairing: "Fixing the test issues…",
};

/**
 * A ceiling on how many lines one run may post, whatever it does.
 *
 * A BACKSTOP, not a working limit. The rungs are one-way and the repair mode
 * absorbs the loop that used to thrash, so a run posts six lines at most however
 * many times the report generator sends it back. This exists for the failure
 * nobody predicted — the last one was a rung matching a `cp` — where the alarm
 * is worth more than the lines it costs. Hitting it warns on the run's own feed
 * rather than going quiet, because a ladder that stops looks exactly like a run
 * that finished.
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
  private repairing = false;

  /**
   * Whether this state is news, and record it if so.
   *
   * FORWARD is always news. BEHIND is news exactly once — when the run had
   * reached the last rung and was sent back.
   *
   * That asymmetry is the whole rule, and it exists because the run oscillates
   * by design. Step 6 takes a criterion at a time: write the stub, explore,
   * write the body, run it. Twelve criteria walk exploring → authoring →
   * running twelve times over, and step 8 walks authoring → running again for
   * every heal. Treating each of those as news would post three lines per
   * criterion, exhaust MAX_POSTS around the fourth, and leave the rest of a
   * two-hour run in the silence this whole mechanism exists to end.
   *
   * None of that churn is a regression — it is what the middle of the run LOOKS
   * like, and the console already draws it per criterion. What IS a regression
   * is step 9's exit-2 sending a finished run back to authoring: the reader was
   * told a report was being written, and it no longer is. So only a fall from
   * the final rung speaks, and after it the mark resets and the climb back up is
   * ordinary forward news again.
   */
  admit(state: LadderState): boolean {
    // Everything a repairing run does IS the repair — re-running a spec,
    // editing one, generating again. Narrating those rungs would report the
    // repair as progress and back again, once per lap, which is the churn the
    // mode exists to absorb.
    if (this.repairing) return false;
    if (this.posts >= MAX_POSTS) return false;
    const at = rank(state);
    const sentBack = this.high === LADDER.length - 1 && at < this.high;
    if (at <= this.high && !sentBack) return false;
    this.high = at;
    this.posts += 1;
    return true;
  }

  /**
   * The report generator refused. News exactly once, however many times it goes
   * on refusing: the run is in one state until it stops, and re-announcing it
   * per attempt would say nothing the first line did not.
   *
   * Refused, not "exited 2" — a crash reads the same here and means the same
   * thing to a reader: no report yet, and the run has more to do.
   */
  enterRepair(): boolean {
    if (this.repairing || this.posts >= MAX_POSTS) return false;
    this.repairing = true;
    this.posts += 1;
    return true;
  }

  /**
   * The report landed. Silent on purpose — what follows is step 10's push, pull
   * request and the agent's own closing summary, which says more than a rung
   * could and is the line a finished run should end on.
   */
  leaveRepair(): void {
    this.repairing = false;
  }

  /** Whether the cap has just been reached, so it can be said once. */
  atCap(): boolean {
    return this.posts >= MAX_POSTS;
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
 * The two halves of one run's status line: what its calls announce BEFORE they
 * run, and what the report generator's outcome says afterwards. Shaped like
 * ValidationProgressTracker next door, and wired to the same translator seam,
 * because they are the same fact reaching two surfaces.
 */
export interface ValidationStatusLine {
  /** PreToolUse hook: the rung a call announces before it runs. */
  hook: HookCallback;
  /** Called by the SDK translator when a tool call settles. */
  settle(toolUseId: string, ok: boolean): void;
}

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
): ValidationStatusLine {
  const ladder = new Ladder();
  // The generator call in flight, so its OUTCOME can be attributed. Keyed by
  // tool id for the same reason ValidationProgressState.noteRun is: the outcome
  // arrives with nothing but that id, and the command's text is long gone.
  let reportCall: string | undefined;
  let capAnnounced = false;

  const say = (key: LineKey): Promise<void> =>
    post(`${OBSERVED_COMMENT_MARKER}\n${LADDER_LINES[key]}`).catch((err) => {
      onError(`status line not posted (${key}): ${err instanceof Error ? err.message : String(err)}`);
    });

  const warnIfCapped = (): void => {
    if (capAnnounced || !ladder.atCap()) return;
    capAnnounced = true;
    onError(`status line capped at ${MAX_POSTS} posts for this cycle — the last line will stand`);
  };

  const hook: HookCallback = async (input) => {
    const hookInput = input as PreToolUseHookInput;
    if (hookInput?.hook_event_name !== "PreToolUse") return {};

    const state = ladderStateFor(hookInput.tool_name, hookInput.tool_input, progress);
    if (state === "reporting") reportCall = hookInput.tool_use_id;
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
    await say(state);
    warnIfCapped();

    // Never a decision — see the header. This hook watches the calls the run
    // needs; it does not get to stop one.
    return {};
  };

  return {
    hook,

    settle: (toolUseId, ok) => {
      if (toolUseId !== reportCall) return;
      reportCall = undefined;
      if (ok) {
        ladder.leaveRepair();
        return;
      }
      // Fire-and-forget, unlike the hook: the translator reports an outcome
      // synchronously and has nothing to await. Acceptable here because this
      // line does not race a silence — it follows a call that just finished,
      // and the run's next tool call is moments away either way.
      if (ladder.enterRepair()) {
        void say("repairing");
        warnIfCapped();
      }
    },
  };
}
