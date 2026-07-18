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

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { stdout as output } from "node:process";
import * as clack from "@clack/prompts";
import { loadRepoSkills } from "@aep/agents/evals-kit";
import { requirementsCommand, designCommand, type PhaseOptions, type PhaseOutcome } from "./commands.js";
import { openSession, SKILLS_DIR } from "./engine/session.js";
import { projectSlug } from "./ports/spec-workspace.js";
import { pickProject } from "./tui/picker.js";
import { phaseMenu, type MenuAction } from "./tui/phase-menu.js";
import { chatLoop } from "./tui/chat.js";

const COMMANDS = new Set(["requirements", "design", "tasks", "code", "chat", "check", "undo", "menu"]);

async function askIdea(): Promise<string | null> {
  const idea = await clack.text({
    message: "What should this project be? (the create prompt)",
    placeholder: "An online store for handmade ceramics",
  });
  return clack.isCancel(idea) ? null : idea;
}

async function runHeadless(command: string, projectDir: string, opts: PhaseOptions): Promise<number> {
  let outcome: PhaseOutcome;
  switch (command) {
    case "requirements":
      outcome = await requirementsCommand(projectDir, opts, process.stdin.isTTY ? askIdea : undefined);
      break;
    case "design":
      outcome = await designCommand(projectDir, opts);
      break;
    default:
      output.write(`"${command}" is not wired yet (see docs/design/playground.md §13)\n`);
      return 2;
  }
  if (!outcome.ok) {
    output.write(`✗ ${command}: ${outcome.detail ?? "failed"}\n`);
    return 1;
  }
  output.write(`✓ ${command} done\n`);
  return 0;
}

async function runMenu(projectDir: string, opts: PhaseOptions): Promise<number> {
  clack.intro("AEP playground");
  for (;;) {
    const skillCount = loadRepoSkills(SKILLS_DIR).length;
    const action: MenuAction = await phaseMenu(projectDir, projectSlug(projectDir), skillCount);
    if (action === "quit") break;
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
    const code = await runHeadless(action, projectDir, opts);
    if (code === 2) continue; // unwired action — back to the menu
  }
  clack.outro("bye");
  return 0;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      idea: { type: "string" },
      target: { type: "string" },
      fresh: { type: "boolean" },
      silent: { type: "boolean" },
    },
    allowPositionals: true,
  });

  const opts: PhaseOptions = {
    ...(values.idea ? { idea: values.idea } : {}),
    ...(values.target ? { target: values.target } : {}),
    ...(values.fresh ? { fresh: true } : {}),
    ...(values.silent ? { silent: true } : {}),
  };

  let [dirArg, command] = positionals as [string | undefined, string | undefined];
  // `pnpm play requirements` inside a project dir: first positional is a command.
  if (dirArg && COMMANDS.has(dirArg) && !existsSync(dirArg)) {
    command = dirArg;
    dirArg = undefined;
  }

  let projectDir = dirArg ? resolve(dirArg) : null;
  if (projectDir && (!existsSync(projectDir) || !statSync(projectDir).isDirectory())) {
    output.write(`not a directory: ${projectDir}\n`);
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

  if (command && command !== "menu") return runHeadless(command, projectDir, opts);
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
