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
 * Entry point (docs/design/playground.md §7):
 *
 *   pnpm play                                → project picker → phase menu
 *   pnpm play <dir>                          → phase menu
 *   pnpm play <dir> requirements|design|chat → run one phase; exit code = result
 *   pnpm play <dir> tasks|code|check|undo    → later steps of the impl plan
 *
 * Flags: --idea "<text>", --target "<x>", --fresh, --silent.
 */

import "./devtools-default.js"; // MUST be first: sets AGENT_DEVTOOLS before the agents config loads
import { existsSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { stdout as output } from "node:process";
import * as clack from "@clack/prompts";
import { loadRepoSkills } from "@aep/agents/evals-kit";
import { loadDotenv } from "@aep/agents/shared/env";
import {
  chatTurn,
  codeCommand,
  designCommand,
  requirementsCommand,
  tasksCommand,
  undoCommand,
  type CodeOptions,
  type PhaseOptions,
  type PhaseOutcome,
} from "./commands.js";
import { openSession, SKILLS_DIR } from "./engine/session.js";
import { projectSlug } from "./ports/spec-workspace.js";
import { pickProject } from "./tui/picker.js";
import { phaseMenu, type MenuAction } from "./tui/phase-menu.js";
import { chatLoop } from "./tui/chat.js";
import { printCheckFindings, reviewScreen } from "./tui/review.js";
import { tasksScreen } from "./tui/tasks.js";

const COMMANDS = new Set(["requirements", "design", "tasks", "code", "chat", "check", "undo", "menu"]);

async function askIdea(): Promise<string | null> {
  const idea = await clack.text({
    message: "What should this project be? (the create prompt)",
    placeholder: "An online store for handmade ceramics",
  });
  return clack.isCancel(idea) ? null : idea;
}

function confirmCodingDir(projectDir: string): () => Promise<boolean> {
  return async () => {
    if (!process.stdin.isTTY) return false;
    const ok = await clack.confirm({
      message: `The coding agent runs with permissions BYPASSED and will write inside ${projectDir}. A restorable undo snapshot is taken first. Continue?`,
    });
    return !clack.isCancel(ok) && ok;
  };
}

async function runHeadless(
  command: string,
  projectDir: string,
  opts: CodeOptions,
  interactive = false,
  commandArg?: string,
): Promise<number> {
  let outcome: PhaseOutcome;
  switch (command) {
    case "requirements":
      outcome = await requirementsCommand(projectDir, opts, process.stdin.isTTY ? askIdea : undefined);
      break;
    case "design":
      outcome = await designCommand(projectDir, opts);
      break;
    case "tasks":
      outcome = await tasksCommand(projectDir, opts);
      break;
    case "code": {
      if (!commandArg) {
        output.write("usage: play <dir> code issues/<n>.md [--restore] [--yes]\n");
        return 1;
      }
      outcome = await codeCommand(projectDir, commandArg, opts, confirmCodingDir(projectDir));
      break;
    }
    case "undo":
      outcome = undoCommand(projectDir, opts);
      break;
    case "chat": {
      // Headless one-shot chat turn: `play <dir> chat "message"` — same
      // general conversation as the TUI chat screen (scriptable follow-ups).
      if (!commandArg) {
        output.write('usage: play <dir> chat "<message>"\n');
        return 1;
      }
      const session = await openSession(projectDir, opts);
      try {
        outcome = await chatTurn(session, commandArg, opts);
      } finally {
        await session.close();
      }
      break;
    }
    case "check":
      return printCheckFindings(projectDir) ? 0 : 1;
    default:
      output.write(`"${command}" is not wired yet (see docs/design/playground.md §13)\n`);
      return 2;
  }
  if (!outcome.ok) {
    output.write(`✗ ${command}: ${outcome.detail ?? "failed"}\n`);
    return 1;
  }
  output.write(`✓ ${command} done\n`);
  if (interactive && outcome.changes?.length && outcome.before) {
    const review = await clack.confirm({ message: `Review the ${outcome.changes.length} changed file(s)?` });
    if (!clack.isCancel(review) && review) await reviewScreen(projectDir, outcome.changes, outcome.before);
  }
  return 0;
}

async function runMenu(projectDir: string, opts: PhaseOptions): Promise<number> {
  clack.intro("AEP playground");
  for (;;) {
    const skillCount = loadRepoSkills(SKILLS_DIR).length;
    const action: MenuAction = await phaseMenu(projectDir, projectSlug(projectDir), skillCount);
    if (action === "quit") break;
    if (action === "tasks" || action === "code") {
      const tasksAction = await tasksScreen(projectDir);
      if (tasksAction.kind === "plan") await runHeadless("tasks", projectDir, opts, true);
      if (tasksAction.kind === "code") await runHeadless("code", projectDir, opts, true, tasksAction.issueFile);
      continue;
    }
    if (action === "chat") {
      const session = await openSession(projectDir, opts);
      try {
        const next = await chatLoop(session, opts);
        if (next === "quit") break;
      } finally {
        await session.close();
      }
      continue;
    }
    const code = await runHeadless(action, projectDir, opts, true);
    if (code === 2) continue; // unwired action — back to the menu
  }
  clack.outro("bye");
  return 0;
}

async function main(): Promise<number> {
  // Load deployments/.env up front: the coding path spawns the runner with
  // the CLI's env (no openSession), so ANTHROPIC_API_KEY must be resolved here.
  loadDotenv();
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      idea: { type: "string" },
      target: { type: "string" },
      fresh: { type: "boolean" },
      silent: { type: "boolean" },
      restore: { type: "boolean" },
      yes: { type: "boolean" },
    },
    allowPositionals: true,
  });

  const opts: CodeOptions = {
    ...(values.idea ? { idea: values.idea } : {}),
    ...(values.target ? { target: values.target } : {}),
    ...(values.fresh ? { fresh: true } : {}),
    ...(values.silent ? { silent: true } : {}),
    ...(values.restore ? { restore: true } : {}),
    ...(values.yes ? { yes: true } : {}),
  };

  // pnpm runs this script with cwd = the playground PACKAGE dir, so a relative
  // path must resolve against where the user actually invoked `pnpm play`
  // (pnpm exposes it as INIT_CWD) — otherwise `pnpm play .` targets the
  // package itself.
  const invocationDir = process.env.INIT_CWD ?? process.cwd();

  let [dirArg, command, commandArg] = positionals as [string | undefined, string | undefined, string | undefined];
  // `pnpm play requirements` inside a project dir: first positional is a command.
  if (dirArg && COMMANDS.has(dirArg) && !existsSync(resolve(invocationDir, dirArg))) {
    commandArg = command;
    command = dirArg;
    dirArg = undefined;
  }

  let projectDir = dirArg ? resolve(invocationDir, dirArg) : null;
  if (projectDir && (!existsSync(projectDir) || !statSync(projectDir).isDirectory())) {
    output.write(`not a directory: ${projectDir}\n`);
    return 1;
  }
  // The repo checkout is never a playground project: the agents would write
  // into the monorepo (specs/, issues/, undo copies, generated app source).
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  if (projectDir && (projectDir === repoRoot || projectDir.startsWith(repoRoot + sep))) {
    output.write(`refusing to use a directory inside the AEP repo checkout (${projectDir}) — pick a project directory outside the repository, e.g. ~/work/my-app\n`);
    return 1;
  }
  if (!projectDir) {
    if (command && !process.stdin.isTTY) {
      output.write("a project directory is required in headless mode\n");
      return 1;
    }
    projectDir = await pickProject();
    if (!projectDir) return 0;
  }

  if (command && command !== "menu") return runHeadless(command, projectDir, opts, false, commandArg);
  return runMenu(projectDir, opts);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    output.write(`playground error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exitCode = 1;
  },
);
