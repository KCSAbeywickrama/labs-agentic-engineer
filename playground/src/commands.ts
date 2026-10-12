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
 * Headless phase commands (docs/design/playground.md §7): every TUI screen is
 * also a CLI verb with meaningful exit codes, so an edit-skill → rerun loop is
 * scriptable. Each command opens a session, runs its turn(s), and reports a
 * `PhaseOutcome` the CLI maps to an exit code.
 */

import { spawn } from "node:child_process";
import { stdout as output } from "node:process";
import { renderPart, renderSummary } from "./kit/render.js";
import type { StreamPart, TurnScope } from "@aep/agent-stream";
import {
  addressCommentsGate,
  designGate,
  interviewGate,
  listWebApplications,
  prototypeGate,
  requirementsGate,
  tasksGate,
  type GateResult,
} from "./engine/gates.js";
import { previewPrototype } from "./engine/prototype.js";
import { readReviewFile, sendWaiting, unsend, writeReviewFile } from "./engine/review-file.js";
import { openSession, type OpenOptions, type PlaygroundSession } from "./engine/session.js";
import { pendingQuestions, type PendingQuestions } from "./engine/questions.js";
import { runSpecTurn, type SpecTurnResult } from "./engine/turn.js";
import { lastBuildPlan, runPlanTurn } from "./engine/plan-turn.js";
import { renderBuildIssue, selectBuild, type BuildPlanRunner, type Selection } from "./engine/build-plan.js";
import { runCodingAgent } from "./engine/coding-run.js";
import { deriveDesign, type DeriveOutcome } from "./engine/design-derive.js";
import { renderLogView, resolveRunDir, type LogView } from "./engine/log-read.js";
import { SKILLS_DIR } from "./engine/session.js";
import { FsIssueStore, type Issue } from "./ports/issue-store.js";
import { projectSlug } from "./ports/spec-workspace.js";
import { loadProjectState, saveProjectState } from "./state/project.js";
import { readIdea, writeDescriptor } from "./state/descriptor.js";
import { restoreUndoSnapshot, takeUndoSnapshot } from "./state/undo.js";
import { REPO_ROOT } from "./paths.js";

export interface PhaseOutcome {
  ok: boolean;
  detail?: string;
}

export interface PhaseOptions extends OpenOptions {
  /** `--scope F2|design-review` → the turn's scope, as the console sends it (S6). */
  scope?: TurnScope;
  /** `--idea "<text>"` seeds/replaces the stored create prompt (requirements). */
  idea?: string;
  /** Quiet streaming (tests); default renders parts live. */
  silent?: boolean;
}

function onPartFor(opts: PhaseOptions): ((part: StreamPart) => void) | undefined {
  return opts.silent ? undefined : renderPart;
}

function report(result: SpecTurnResult, opts: PhaseOptions): PhaseOutcome {
  if (!opts.silent) {
    output.write("\n");
    renderSummary(result.changes, false);
    for (const n of result.derivedNotes) output.write(n.ok ? `  ⚙ ${n.message}\n` : `  ✗ ${n.message}\n`);
  }
  if (result.error) return { ok: false, detail: result.error };
  return { ok: true };
}

function gateFail(gate: GateResult): PhaseOutcome {
  return { ok: false, detail: gate.reason ?? "blocked" };
}

/** Run one spec turn inside a fresh session (open → turn → close). */
async function runPhaseTurn(projectDir: string, instruction: string, opts: PhaseOptions): Promise<PhaseOutcome> {
  // One-shot phase run — no human answers questions here, so the channel says
  // so explicitly (#373: posture is channel state, not skill prose).
  const session = await openSession(projectDir, { ...opts, headless: true });
  try {
    const onPart = onPartFor(opts);
    const result = await runSpecTurn(session, instruction, {
      ...(opts.scope ? { scope: opts.scope } : {}),
      ...(onPart ? { onPart } : {}),
    });
    return report(result, opts);
  } finally {
    await session.close();
  }
}

/**
 * Phase 1 — requirements, the headless twin of chat's `/start`. The idea comes
 * from `--idea` or the descriptor written at project creation
 * (`specs/.agentic-engineer.toml`); a TUI caller may ask for one when neither
 * has it. The turn is a headless `/start` (§5 phase 1): the design agent
 * resolves the idea from the descriptor through the project lookup, and the
 * session tells the agent no interview is possible.
 *
 * An `--idea` given here is CAPTURED, not just used: it becomes the project's
 * descriptor, so a later `/start` carries the same idea.
 */
export async function requirementsCommand(
  projectDir: string,
  opts: PhaseOptions,
  askIdea?: () => Promise<string | null>,
): Promise<PhaseOutcome> {
  const gate = requirementsGate();
  if (!gate.ok) return gateFail(gate);

  const flagIdea = opts.idea?.trim() || null;
  let idea = flagIdea ?? readIdea(projectDir);
  if (!idea && askIdea) idea = (await askIdea())?.trim() || null;
  // Only write when this run supplied the idea — reading the descriptor back
  // and rewriting it would churn createdAt for nothing.
  if (idea && idea !== readIdea(projectDir)) writeDescriptor(projectDir, projectSlug(projectDir), idea);

  // `/start` resolves the idea from the descriptor (the project lookup reads it).
  return runPhaseTurn(projectDir, "/start", opts);
}

/**
 * The headless twin of chat's `/interview F<n>`: one feature's stories, on
 * stated assumptions, after the product pass wrote its stub. Refuses a feature
 * the requirements do not have.
 */
export async function interviewCommand(projectDir: string, opts: PhaseOptions, feature: string): Promise<PhaseOutcome> {
  const gate = interviewGate(projectDir, feature);
  if (!gate.ok) return gateFail(gate);
  return runPhaseTurn(projectDir, `/interview ${feature}`, opts);
}

/** Phase 2 — design, derived from the current requirements (§5 phase 2). */
export async function designCommand(projectDir: string, opts: PhaseOptions): Promise<PhaseOutcome> {
  const gate = designGate(projectDir);
  if (!gate.ok) return gateFail(gate);
  return runPhaseTurn(projectDir, "/design", opts);
}

export interface PrototypeOptions extends PhaseOptions {
  /** `--preview`: serve the review page instead of running a turn. */
  preview?: boolean;
  /** `--no-open`: the preview prints its URL instead of opening a browser. */
  noOpen?: boolean;
}

/**
 * `play <dir> prototype [component]` — the `/prototype` line: (re)generate the
 * prototypes. `--preview` serves one for review instead: each Save feedback
 * there becomes draft comments in specs/design/review.json, which
 * `address-comments` sends.
 */
export async function prototypeCommand(projectDir: string, opts: PrototypeOptions, component?: string): Promise<PhaseOutcome> {
  const gate = prototypeGate(projectDir, component);
  if (!gate.ok) return gateFail(gate);
  if (!opts.preview) return runPhaseTurn(projectDir, component ? `/prototype ${component}` : "/prototype", opts);

  // A review is of one prototype: the named one, or the design's only one.
  const apps = listWebApplications(projectDir);
  const target = component ?? (apps.length === 1 ? apps[0] : undefined);
  if (!target) return { ok: false, detail: `name the web-application to review (${apps.join(", ")})` };
  const report = (line: string): void => {
    if (!opts.silent) output.write(`${line}\n`);
  };
  const code = await previewPrototype(projectDir, target, { open: !opts.noOpen, report });
  return code === 0 ? { ok: true } : { ok: false, detail: `the preview exited ${code}` };
}

/** The Address comments line, as the console sends it. */
const ADDRESS_COMMENTS = "/address-comments";

/**
 * `play <dir> address-comments` — the Overview's Address comments: every
 * waiting comment in specs/design/review.json (a draft, or one reopened by an
 * answer) is marked sent, then the bare `/address-comments` turn runs, scoped
 * to the design review. Should the turn fail before the agent wrote the file,
 * the comments are put back as they were.
 */
export async function addressCommentsCommand(projectDir: string, opts: PhaseOptions): Promise<PhaseOutcome> {
  const gate = addressCommentsGate(projectDir);
  if (!gate.ok) return gateFail(gate);
  const read = readReviewFile(projectDir);
  if (!read.ok) return { ok: false, detail: read.reason };
  const sent = sendWaiting(read.review, new Date().toISOString());
  if (sent.sent.length === 0) return { ok: false, detail: "no comment waits to be sent: add drafts with prototype --preview" };
  const written = writeReviewFile(projectDir, sent.review);
  const outcome = await runPhaseTurn(projectDir, ADDRESS_COMMENTS, { ...opts, scope: { kind: "design-review" } });
  if (!outcome.ok) {
    const after = readReviewFile(projectDir);
    if (after.ok && JSON.stringify(after.review) === JSON.stringify(JSON.parse(written))) {
      writeReviewFile(projectDir, unsend(after.review, sent.sent));
    }
  }
  return outcome;
}

export interface TasksOptions extends PhaseOptions {
  /** `--features F1,F3`: the build's pick; none picks every feature that can be designed, as POST /build does. */
  features?: string[];
  /** `--product-wide P1`: the product-wide items picked. */
  productWide?: string[];
  /** Override the `cmd/build-plan` runner (tests). */
  buildPlan?: BuildPlanRunner;
  /** Override the pre-tag design derivation (tests). */
  deriveDesign?: (projectDir: string) => Promise<DeriveOutcome>;
}

/**
 * Phase 3 — tasks: the build click's plan half. Production's pre-tag
 * derivation runs first, as POST /build runs it before its gate (the gate reads
 * the `exposesAPI.auth` it stamps). The selection goes through
 * POST /build's own code (`cmd/build-plan scope`, which refuses as it does:
 * the selection, then the build gate over the requirements, design and
 * acceptance files, so a design production would refuse never plans here),
 * a Plan turn on the Turn socket plans the version's checklist, and its last
 * ok `planBuild` becomes ONE build issue, `issues/<n>.md`, rendered by the plan
 * service's own code (`cmd/build-plan issue`). The version is recorded only
 * once its issue is written, as a tag's annotation records what it carries.
 */
export async function tasksCommand(projectDir: string, opts: TasksOptions): Promise<PhaseOutcome & { issue?: Issue }> {
  const gate = tasksGate(projectDir);
  if (!gate.ok) return gateFail(gate);

  const store = new FsIssueStore(projectDir);
  const unfinished = store.unfinishedBuilds();
  if (unfinished.length > 0) {
    const [first] = unfinished;
    return {
      ok: false,
      detail: `${first!.file} (${first!.title}) still has unticked items — finish it with \`code\`, or delete the file to drop that version's work`,
    };
  }
  const derived = await derivePreTag(projectDir, opts);
  if (!derived.ok) return derived;

  const session = await openSession(projectDir, opts);
  try {
    const built = session.state.versions;
    const selection: Selection = {
      version: `v${built.length + 1}`,
      ...(opts.features?.length ? { features: opts.features } : {}),
      ...(opts.productWide?.length ? { productWide: opts.productWide } : {}),
      builtFeatures: [...new Set(built.flatMap((v) => v.features))],
      builtProductWide: [...new Set(built.flatMap((v) => v.productWide))],
    };
    const selected = await selectBuild(projectDir, selection, opts.buildPlan);
    if (!selected.ok) return { ok: false, detail: selected.detail };
    if (!opts.silent) {
      const { features, pulledIn, heldBack } = selected.plan;
      output.write(`  ${selection.version} carries ${features.join(", ") || "the whole spec"}`);
      output.write(pulledIn.length ? ` (pulled in: ${pulledIn.join(", ")})` : "");
      output.write(heldBack.length ? `; held back: ${heldBack.join(", ")}\n` : "\n");
    }

    const onPart = onPartFor(opts);
    const result = await runPlanTurn(session, { scope: selected.scope, ...(onPart ? { onPart } : {}) });
    if (result.error) return { ok: false, detail: result.error };
    const plan = lastBuildPlan(result);
    if (!plan) return { ok: false, detail: "the plan turn completed without a build plan" };

    const rendered = await renderBuildIssue(projectDir, selection, plan.items, opts.buildPlan);
    if (!rendered.ok) return { ok: false, detail: rendered.detail };
    const issue = store.writeBuildIssue(
      { title: rendered.title, version: selection.version, body: rendered.body },
      store.safeAllocator(
        () => session.state.nextIssueNumber,
        (advancedTo) => {
          session.state.nextIssueNumber = advancedTo;
        },
      ),
    );
    session.state.versions.push({ tag: selection.version, features: selected.plan.features, productWide: selected.plan.productWide });
    saveProjectState(projectDir, session.state);
    if (!opts.silent) output.write(`\n  ＋ ${issue.file} — ${issue.title}: ${issue.items.map((i) => i.item).join(" → ")}\n`);
    return { ok: true, issue };
  } finally {
    await session.close();
  }
}

/** Production's pre-tag design derivation (ADR-0003): end-user auth and each dependency's wiring. */
async function derivePreTag(
  projectDir: string,
  opts: PhaseOptions & { deriveDesign?: (projectDir: string) => Promise<DeriveOutcome> },
): Promise<PhaseOutcome> {
  const derived = await (opts.deriveDesign ?? deriveDesign)(projectDir);
  if (!derived.ok) return { ok: false, detail: derived.detail };
  if (!opts.silent) {
    output.write(
      derived.changed.length > 0
        ? `  ⚙ derived wiring: ${derived.changed.join(", ")}\n`
        : "  ⚙ derived wiring: no change\n",
    );
  }
  return { ok: true };
}

export interface CodeOptions extends PhaseOptions {
  /** `--restore`: restore the latest undo snapshot before this run. */
  restore?: boolean;
  /** Headless consent to run bypassPermissions on this directory (`--yes`). */
  yes?: boolean;
  /** Override the skill library the run reads (tests). */
  codingSkillsDir?: string;
  /** Override the pre-tag design derivation (tests). */
  deriveDesign?: (projectDir: string) => Promise<DeriveOutcome>;
  /** `--host`: bare `npx tsx` on the host instead of the default Docker-image run. */
  host?: boolean;
  /** `--api-key`: with `--host`, authenticate with `ANTHROPIC_API_KEY` rather than your Claude login. */
  apiKey?: boolean;
  /** `log` only: which view, and which archived run (default: the newest). */
  view?: LogView;
  run?: string;
}

/**
 * Phase 4 — code. Mirrors prod's milestone cycle: ONE coding-agent session
 * works the whole project, not one issue at a time — the `aep` skill
 * discovers its own working set from `issues/` and decides ordering and
 * fan-out itself (see its SKILL.md). This command's only jobs are the
 * MANDATORY undo snapshot, production's pre-tag design derivation (ADR-0003)
 * and spawning the run.
 *
 * Exit code tracks whether the session completed, not whether every issue
 * got resolved — leaving issues open for a later run is normal (mirrors
 * prod's "a later cycle picks it up"), never a failure by itself.
 */
export async function codeCommand(
  projectDir: string,
  opts: CodeOptions,
  confirmDir?: () => Promise<boolean>,
): Promise<PhaseOutcome> {
  const store = new FsIssueStore(projectDir);
  if (store.list().length === 0) return { ok: false, detail: "nothing to run — no issues yet (plan tasks first?)" };

  // First-run consent (§12): bypassPermissions writes THIS directory.
  const state = loadProjectState(projectDir, projectSlug(projectDir));
  if (!state.codingConfirmed && !opts.yes) {
    if (!confirmDir || !(await confirmDir())) {
      return { ok: false, detail: "coding run not confirmed — re-run with --yes or confirm in the TUI" };
    }
  }
  if (!state.codingConfirmed) {
    state.codingConfirmed = true;
    saveProjectState(projectDir, state);
  }

  if (opts.restore) {
    const restored = restoreUndoSnapshot(projectDir);
    if (!opts.silent) output.write(restored ? `  ↺ restored ${restored}\n` : "  (no undo snapshot to restore)\n");
  }
  const snapshot = takeUndoSnapshot(projectDir); // mandatory (§12), once per session
  if (!opts.silent) output.write(`  ⛑ undo snapshot: ${snapshot}\n`);

  // After the snapshot so `--restore` undoes it.
  const derived = await derivePreTag(projectDir, opts);
  if (!derived.ok) return derived;

  const result = await runCodingAgent({
    projectDir,
    skillsDir: opts.codingSkillsDir ?? SKILLS_DIR,
    ...(opts.silent ? { silent: true } : {}),
    ...(opts.apiKey ? { useApiKey: true } : {}),
    mode: opts.host ? "host" : "docker",
  });
  if (!opts.silent) {
    output.write(`\n  session ${result.exitCode === 0 ? "done" : `gave up (exit ${result.exitCode})`}\n`);
    output.write(`  transcript: ${result.runDir}\n`);
  }
  return result.exitCode === 0 ? { ok: true } : { ok: false, detail: `coding run exited ${result.exitCode}` };
}

/**
 * `play <dir> log [--steps|--slow|--thinking]` — the DEVELOPER view of a coding
 * run, derived on demand from the archived transcript.
 *
 * Deliberately a reader rather than a file the run writes: `runtime.log` already
 * holds every message, so a second artifact would be a cache of an analysis, and
 * one that can drift from the truth is worse than none. What was missing was
 * only the ergonomics of asking.
 */
export function logCommand(projectDir: string, opts: CodeOptions): PhaseOutcome {
  const runDir = resolveRunDir(projectDir, opts.run);
  if (!runDir) return { ok: false, detail: "no archived coding run found (run `code` first?)" };
  const view = opts.view ?? "steps";
  if (!opts.silent) {
    output.write(`  ${view} — ${runDir}\n`);
    for (const line of renderLogView(runDir, view)) output.write(`${line}\n`);
  }
  return { ok: true };
}

/** `play undo` — restore the latest pre-coding-run snapshot. */
export function undoCommand(projectDir: string, opts: PhaseOptions): PhaseOutcome {
  const restored = restoreUndoSnapshot(projectDir);
  if (!restored) return { ok: false, detail: "no undo snapshot found" };
  if (!opts.silent) output.write(`  ↺ restored ${restored}\n`);
  return { ok: true };
}

/**
 * `play <dir> eval-save <name>` — save this project as a codegen eval case.
 *
 * Spawns, never imports, the evals CLI: `evals/*` import the playground.
 * Withholds ANTHROPIC_API_KEY: evals authenticate with the OAuth token only.
 */
export function evalSaveCommand(projectDir: string, name: string): Promise<number> {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return new Promise((resolve) => {
    const child = spawn(
      "pnpm",
      ["--filter", "@aep/codegen-evals", "eval", "--", "save", "--from", projectDir, "--name", name],
      { cwd: REPO_ROOT, env, stdio: "inherit" },
    );
    child.on("error", (err) => {
      output.write(`✗ eval-save: ${err.message}\n`);
      resolve(2);
    });
    child.on("close", (code, signal) => {
      resolve(signal ? 130 : (code ?? 2));
    });
  });
}

/**
 * One chat turn on the project's current thread (shared session), sent
 * verbatim: a `/<command>` line runs that flow.
 * When the agent ends the turn on a HITL question tool-call (console ADR-0012 /
 * #270), `pending` carries the structured questions so the caller (the chat
 * screen) can prompt for an answer and continue with it.
 */
export async function chatTurn(
  session: PlaygroundSession,
  instruction: string,
  opts: PhaseOptions,
): Promise<PhaseOutcome & { pending?: PendingQuestions }> {
  const onPart = onPartFor(opts);
  const result = await runSpecTurn(session, instruction, {
    ...(opts.scope ? { scope: opts.scope } : {}),
    ...(onPart ? { onPart } : {}),
  });
  const outcome = report(result, opts);
  const pending = pendingQuestions(result.toolCalls);
  return pending ? { ...outcome, pending } : outcome;
}
