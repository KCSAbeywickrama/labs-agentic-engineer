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
 * One coding run (mirrors prod's milestone cycle, `docs/decisions/ADR-0011`;
 * playground decision: `design/decisions/ADR-0001-milestone-batch-coding-run.md`):
 * spawn the remote-worker's local entrypoint over the WHOLE project, stream
 * its NDJSON progress contract into a live timeline, and archive the run.
 *
 * There is no status write-back here. Prod's own dispatch returns before any
 * outcome is known — "a signal is a wake-up, never evidence"
 * (`services/aep-api/internal/delivery/run/doc.go`) — and the playground
 * mirrors that: this module never edits an issue file. Whether an issue is
 * done is read fresh from the project tree each run (the `aep` skill's
 * local-mode discovery step), never cached in frontmatter or flipped on an
 * exit code.
 *
 * Works on ANY directory containing `specs/` + `issues/` — no playground
 * state, no prior phases, no engineering-agent process (hard requirement 2).
 *
 * Two run modes, same `local.ts` entrypoint:
 *   docker (default) — runs inside the exact `remote-worker/Dockerfile` image
 *     production ships (Debian, pinned Go, baked Playwright/chromium, the
 *     non-root `aep` user), so a skill authored here behaves under the same
 *     toolchain a real cluster run gives it. `local.ts` is never baked into
 *     that image (`.dockerignore` — see `remote-worker/AGENTS.md`), so it is
 *     bind-mounted in at run time alongside the plugin/project/skills/run
 *     dirs; only the entrypoint command is overridden, the image itself is
 *     untouched.
 *   host — the prior bare `npx tsx` child process, no Docker dependency.
 *     Opt in with `--host` (faster iteration, weaker parity) when Docker
 *     isn't available or a fast loop matters more than environment fidelity.
 */

import { spawn } from "node:child_process";
import { chmodSync, createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { stdout as output } from "node:process";
import {
  formatLine,
  formatOutcome,
  formatSubagentStatus,
  groupBySubagent,
  mergeOutcomes,
  type AttributedLine,
  type ProgressLineView,
} from "@aep/progress-view";
import { REPO_ROOT } from "../paths.js";

const LOCAL_ENTRY = join(REPO_ROOT, "runners", "remote-worker", "src", "local.ts");
const DEFAULT_PLUGIN_DIR = join(REPO_ROOT, "runners", "remote-worker", "plugin");
const BUILD_RUNNER_SCRIPT = join(REPO_ROOT, "deployments", "scripts", "build-runner.sh");
const RUNNER_IMAGE = process.env.AGENT_RUNNER_IMAGE || "aep-runner:dev";

/** One NDJSON line off the runner's feed, as this harness reads it. */
export type ProgressEvent = ProgressLineView & AttributedLine;

// Attribution is a fixed-width tag so the glyphs stay in one column and a
// fanned-out run still scans as a single timeline. The tag is a NUMBER, not the
// subagent's label: labels run to a full sentence ("Implement todo-api
// Ballerina service (issue #3)") and would push every line off the right edge.
// The label is announced once, the first time that subagent appears.
const TAG_WIDTH = "[#1] ".length;

export type TimelineRenderer = (e: ProgressEvent) => string[];

// The one place the local harness legitimately says something the console does
// not. A local run has no remote and no GitHub, so a push or a `gh` call is a
// no-op the agent may not realise it made — worth flagging where it is true,
// and meaningless in a cluster run where both exist.
function annotateForLocalMode(e: ProgressEvent, text: string): string {
  if (!text) return text;
  if (e.kind === "git_push") return `${text} — no remote in local mode`;
  if (e.kind === "gh_action") return `${text} — no GitHub in local mode`;
  return text;
}

/**
 * Build the renderer for ONE run: it numbers subagents as they appear, so
 * concurrent fan-outs stay tellable apart across lines. Returns zero lines for
 * a silent event, one for a normal line, and two the first time a subagent
 * speaks (its announcement, then its line).
 *
 * The WORDING of every line comes from @aep/progress-view, the same module the
 * console renders through — so what you iterate on here is what a cluster run
 * shows, and a wording defect cannot hide in one surface. Only the terminal
 * presentation (the tags, the column) is this harness's own.
 */
export function createTimelineRenderer(): TimelineRenderer {
  const tags = new Map<string, string>();

  return function render(e: ProgressEvent): string[] {
    const text = annotateForLocalMode(e, formatLine(e).text);
    if (!text) return [];

    // One line at a time, so the grouping the console applies over a whole
    // cycle degrades here to "is this line a subagent's, and which one".
    const [row] = groupBySubagent([e]);
    if (!row || row.kind !== "group") {
      // A subagent line from a runner too old to stamp an id cannot be grouped,
      // but it is still a subagent's — the console keeps its chip for exactly
      // this case, and dropping the marker here would read as the main agent.
      const tag = e.emitter === "subagent" ? "[sub]" : "";
      return [`  ${tag.padEnd(TAG_WIDTH)}${text}`];
    }

    const { id, label } = row.group;
    const announce: string[] = [];
    let tag = tags.get(id);
    if (!tag) {
      tag = `[#${tags.size + 1}]`;
      tags.set(id, tag);
      if (label !== "subagent") announce.push(`  ${" ".repeat(TAG_WIDTH)}⑂ ${tag} ${label}`);
    }
    return [...announce, `  ${`${tag} `.padEnd(TAG_WIDTH)}${text}`];
  };
}

// Where an outcome's column starts in the merged pass. Wide enough for the
// commands a real run issues; anything longer pushes its outcome right rather
// than being cut, because a truncated command is worse than a ragged column.
const OUTCOME_COLUMN = 62;

/**
 * The whole run again, once every event is in hand: one row per step with its
 * outcome attached, and each subagent's work gathered under its own report.
 *
 * This exists because a terminal cannot go back and rewrite a line it printed.
 * The live stream above is honest about that — an outcome follows as a
 * continuation row — but it means the fast local loop is NOT shaped like the
 * console, which is the surface being iterated on. Printing a merged pass at the
 * end gives both: live while it runs, console-shaped afterwards.
 */
export function renderMergedTimeline(events: readonly ProgressEvent[]): string[] {
  const out: string[] = [];
  const row = (indent: string, text: string, outcome: string): void => {
    if (!text) return;
    out.push(outcome ? `${(indent + text).padEnd(OUTCOME_COLUMN)} ${outcome}` : `${indent}${text}`);
  };

  const rows = groupBySubagent(events);
  // The main agent's lines are merged as ONE stream: its action and its outcome
  // are routinely separated by a subagent section that spoke in between, so
  // pairing has to survive the gap. Looked up per line afterwards, which keeps
  // each section printed where its subagent first spoke.
  const mainByLine = new Map(
    mergeOutcomes(rows.flatMap((r) => (r.kind === "line" ? [r.line] : []))).map((m) => [m.line, m]),
  );

  for (const r of rows) {
    if (r.kind === "group") {
      out.push(`  ⑂ ${r.group.label} — ${formatSubagentStatus(r.group.report)}`);
      for (const m of mergeOutcomes(r.group.lines)) {
        const { text } = formatLine(m.line);
        const { detail, duration } = formatOutcome(m.outcome);
        row("    │ ", annotateForLocalMode(m.line, text), [detail, duration].filter(Boolean).join(" · "));
      }
      continue;
    }
    const m = mainByLine.get(r.line);
    if (!m) continue; // folded into an earlier action's row
    const { text } = formatLine(r.line);
    const { detail, duration } = formatOutcome(m.outcome);
    row("  ", annotateForLocalMode(r.line, text), [detail, duration].filter(Boolean).join(" · "));
  }
  return out;
}

export interface CodingRunOptions {
  projectDir: string;
  /** Working-tree skills library dir; omit to run skill-free. */
  skillsDir?: string;
  /** Override the authored base plugin (defaults to remote-worker/plugin). */
  pluginDir?: string;
  silent?: boolean;
  /** "docker" (default): same image prod runs. "host": bare `npx tsx`, no Docker. */
  mode?: "docker" | "host";
}

export interface CodingRunResult {
  /** 0 = the session did what it could; 1 = the agent gave up; 2 = setup/crash. */
  exitCode: number;
  runDir: string;
}

interface Invocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

function hostInvocation(opts: CodingRunOptions, pluginDir: string, runDir: string): Invocation {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AEP_LOCAL_PROJECT_DIR: opts.projectDir,
    AEP_LOCAL_RUN_DIR: runDir,
    AEP_LOCAL_PLUGIN_DIR: pluginDir,
    ...(opts.skillsDir ? { AEP_LOCAL_SKILLS_DIR: opts.skillsDir } : {}),
  };
  return { command: "npx", args: ["tsx", LOCAL_ENTRY], env };
}

// Mounts local.ts + the plugin/project/skills/run dirs over the unmodified
// production image and overrides only the command (image ENTRYPOINT runs
// oneshot.ts) — the image itself never gains playground-only bytes.
function dockerInvocation(opts: CodingRunOptions, pluginDir: string, runDir: string): Invocation {
  const args = [
    "run",
    "--rm",
    "--entrypoint",
    "npx",
    "--shm-size=1g",
    "-v",
    `${LOCAL_ENTRY}:/app/src/local.ts:ro`,
    "-v",
    `${pluginDir}:/app/plugin:ro`,
    "-v",
    `${opts.projectDir}:/workspace/project`,
    "-v",
    `${runDir}:/workspace/run`,
    ...(opts.skillsDir ? ["-v", `${opts.skillsDir}:/workspace/skills:ro`] : []),
    "-e",
    "ANTHROPIC_API_KEY",
    "-e",
    "AEP_LOCAL_PROJECT_DIR=/workspace/project",
    "-e",
    "AEP_LOCAL_RUN_DIR=/workspace/run",
    ...(opts.skillsDir ? ["-e", "AEP_LOCAL_SKILLS_DIR=/workspace/skills"] : []),
    RUNNER_IMAGE,
    "tsx",
    "src/local.ts",
  ];
  return { command: "docker", args, env: process.env };
}

function runProcess(
  command: string,
  args: string[],
  stdio: "inherit" | "ignore",
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: REPO_ROOT, stdio, ...(env ? { env } : {}) });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolvePromise() : reject(new Error(`${command} exited ${code}`))));
  });
}

async function ensureRunnerImage(silent?: boolean): Promise<void> {
  const stdio = silent ? "ignore" : "inherit";
  try {
    await runProcess("docker", ["info"], "ignore");
  } catch {
    throw new Error("docker daemon not reachable — start it (e.g. `colima start`), or pass --host to skip Docker");
  }
  // Idempotent: skips the (multi-minute, first-time) build when the tag
  // already exists. SKIP_IMPORT=1 — this is a plain local docker run, not a
  // k3d node; without it the script also tries (and, absent/stale k3d, fails
  // noisily at) a k3d image import that a playground run has no use for.
  await runProcess("bash", [BUILD_RUNNER_SCRIPT], stdio, { ...process.env, SKIP_IMPORT: "1" }).catch((err) => {
    throw new Error(`runner image build failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

/**
 * Spawn one coding run over the WHOLE project; resolves with the exit code +
 * archived run dir. Success (`exitCode === 0`) means the session completed,
 * NOT that every issue got resolved — leaving some open is normal (mirrors
 * prod: "a later cycle picks it up"). Which issues actually landed is never
 * read back here; it is whatever the project tree looks like afterward.
 */
export async function runCodingAgent(opts: CodingRunOptions): Promise<CodingRunResult> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(opts.projectDir, ".aep-playground", "runs", `${stamp}-code`);
  mkdirSync(runDir, { recursive: true });
  // Docker mode bind-mounts this dir at /workspace/run and the runner image runs
  // as its own unprivileged user (uid 999 `aep`), which cannot write into a dir
  // this process just created under the invoking user. The runner composes the
  // base `aep` plugin in there on purpose — a developer tuning the skill needs
  // to read the exact text the agent was steered by — so widen the mount rather
  // than move the compose target somewhere unreadable. Local harness dir under
  // a gitignored .aep-playground; nothing sensitive lands here.
  chmodSync(runDir, 0o777);
  const progressLog = createWriteStream(join(runDir, "progress.ndjson"), { flags: "w" });

  const mode = opts.mode ?? "docker";
  const pluginDir = opts.pluginDir ?? DEFAULT_PLUGIN_DIR;

  if (mode === "docker") {
    try {
      await ensureRunnerImage(opts.silent);
    } catch (err) {
      progressLog.end();
      if (!opts.silent) output.write(`  ✗ ${err instanceof Error ? err.message : String(err)}\n`);
      return { exitCode: 2, runDir };
    }
  }

  const { command, args, env } =
    mode === "docker" ? dockerInvocation(opts, pluginDir, runDir) : hostInvocation(opts, pluginDir, runDir);

  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });

    // One renderer per run — it numbers this run's subagents (see above).
    const render = createTimelineRenderer();
    // Kept so the run can be re-rendered console-shaped once it ends. Bounded by
    // the run itself, same as the progress.ndjson beside it.
    const events: ProgressEvent[] = [];
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const nl = buffer.indexOf("\n");
        if (nl < 0) break;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim() === "") continue;
        progressLog.write(line + "\n");
        let event: ProgressEvent;
        try {
          event = JSON.parse(line) as ProgressEvent;
        } catch {
          // non-NDJSON runner logging — pass through
          if (!opts.silent) output.write(`  ${line}\n`);
          continue;
        }
        events.push(event);
        if (opts.silent) continue;
        for (const rendered of render(event)) output.write(rendered + "\n");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (!opts.silent) output.write(chunk.toString("utf8"));
    });

    const settle = (exitCode: number): void => {
      progressLog.end();
      if (!opts.silent && events.length > 0) {
        output.write("\n  ── the run, merged ──\n");
        for (const line of renderMergedTimeline(events)) output.write(line + "\n");
      }
      resolvePromise({ exitCode, runDir });
    };
    child.on("error", (err) => {
      if (!opts.silent) output.write(`  ✗ spawn failed: ${err.message}\n`);
      settle(2);
    });
    child.on("close", (code, signal) => {
      settle(signal ? 130 : (code ?? 2));
    });

    // Ctrl-C: kill the child.
    const onInt = (): void => {
      child.kill("SIGTERM");
    };
    process.once("SIGINT", onInt);
    child.on("close", () => process.removeListener("SIGINT", onInt));
  });
}
