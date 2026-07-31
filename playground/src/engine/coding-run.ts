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
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { stdout as output } from "node:process";
import { REPO_ROOT } from "../paths.js";

const LOCAL_ENTRY = join(REPO_ROOT, "runners", "remote-worker", "src", "local.ts");
const DEFAULT_PLUGIN_DIR = join(REPO_ROOT, "runners", "remote-worker", "plugin");
const BUILD_RUNNER_SCRIPT = join(REPO_ROOT, "deployments", "scripts", "build-runner.sh");
const RUNNER_IMAGE = process.env.AGENT_RUNNER_IMAGE || "aep-runner:dev";

export interface ProgressEvent {
  kind: string;
  phase?: string;
  tool?: string;
  summary?: string;
  status?: string;
  error?: string;
  level?: string;
  command?: string;
  sha?: string;
}

/** One NDJSON line → a formatted timeline line (docs §7 coding-run screen). */
export function renderProgressLine(e: ProgressEvent): string {
  switch (e.kind) {
    case "phase":
      return `  ▸ ${String(e.phase ?? "").replace(/_/g, " ")}`;
    case "tool_use":
      return `  ${e.tool === "Bash" ? "$" : "⚙"} ${e.summary || e.tool || "tool"}`;
    case "git_commit":
      return `  ✓ commit ${e.sha?.slice(0, 8) ?? ""} ${e.summary ?? ""}`.trimEnd();
    case "git_push":
      return `  ⚠ push attempted (local mode has no remote) ${e.summary ?? ""}`.trimEnd();
    case "gh_action":
      return `  ⚠ gh ${e.command ?? ""} (local mode has no GitHub)`.trimEnd();
    case "log":
      return `  ${e.level === "error" ? "✗" : e.level === "warn" ? "⚠" : "·"} ${e.summary ?? ""}`.trimEnd();
    case "result":
      return e.status === "success" ? "  ■ result success" : `  ■ result failure${e.error ? ` — ${e.error}` : ""}`;
    default:
      return `  · ${e.kind}`;
  }
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
        if (opts.silent) continue;
        try {
          output.write(renderProgressLine(JSON.parse(line) as ProgressEvent) + "\n");
        } catch {
          output.write(`  ${line}\n`); // non-NDJSON runner logging — pass through
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (!opts.silent) output.write(chunk.toString("utf8"));
    });

    const settle = (exitCode: number): void => {
      progressLog.end();
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
