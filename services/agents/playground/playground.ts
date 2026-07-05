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
 * A terminal chat over the main spec agent's SSE endpoint (a dev playground).
 *
 * It boots the real Express app in-process (the eval-harness pattern), then for
 * a named THREAD — a folder under `chat_playground/` whose name is the
 * conversation id — runs a multi-turn loop: read the folder → POST one turn →
 * stream the frames → fold the tool-calls back through a `FileBundle` → write
 * the folder. The service writes no files; this client owns the disk.
 *
 *   pnpm --filter @aep/agents playground            # pick/create a thread
 *   pnpm --filter @aep/agents playground my-spec    # jump straight into `my-spec`
 *   pnpm --filter @aep/agents playground -- --dry-run
 */

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as clack from "@clack/prompts";
import type { Skill, TurnRequest } from "../src/contracts/sse-events.js";
import { createApp } from "../src/server.js";
import { createModel } from "../src/shared/model.js";
import { loadDotenv, loadAnthropicKey } from "../src/shared/env.js";
import { InMemoryConversationStore } from "../src/store/memory-store.js";
import { listen0 } from "../src/shared/listen.js";
import { FileBundle } from "../src/agents/main/bundle.js";
import { applyToolCall } from "../src/agents/main/change.js";
import type { StreamPart } from "../src/agents/main/stream-types.js";
import { streamTurn } from "../evals/sse-client.js";
import { loadRepoSkills } from "../evals/skills.js";
import { ensureThread, isValidThreadName, listThreads, readSnapshot, reconcile, threadDir } from "./threads.js";
import { renderPart, renderSummary } from "./render.js";
import { materializeDerived } from "./derived.js";

// Repo-root `skills/` (services/agents/playground → up 3). The whole library is
// pushed every turn (ADR-0002); the service still reads none.
const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "skills");

interface ChatCtx {
  thread: string;
  baseUrl: string;
  skills: Skill[];
  dryRun: boolean;
  /** Caller-supplied MCP discovery endpoint (Task E2), from AEP_MCP_URL/AEP_MCP_TOKEN. */
  mcp?: TurnRequest["mcp"];
}

const NEW = "\0new";
const QUIT = "\0quit";

/** clack menu: existing threads + create + quit. Returns the thread name, or null to exit. */
async function pickThread(): Promise<string | null> {
  const threads = listThreads();
  const choice = await clack.select({
    message: "Pick a thread",
    options: [
      ...threads.map((t) => ({ value: t.name, label: `${t.name} — ${t.fileCount} file(s)` })),
      { value: NEW, label: "＋ Create new thread" },
      { value: QUIT, label: "Quit" },
    ],
  });
  if (clack.isCancel(choice) || choice === QUIT) return null;
  if (choice !== NEW) return choice;

  const name = await clack.text({
    message: "Thread name",
    placeholder: "my-spec",
    validate: (v) => (isValidThreadName((v ?? "").trim()) ? undefined : "letters, digits, . _ - only"),
  });
  if (clack.isCancel(name)) return null;
  const n = name.trim();
  ensureThread(n);
  return n;
}

/** Run one turn end to end: snapshot → stream → reconstruct → write. */
async function runTurn(ctx: ChatCtx, instruction: string): Promise<void> {
  const before = readSnapshot(ctx.thread);
  const body: TurnRequest = {
    instruction,
    files: before,
    ...(ctx.skills.length > 0 ? { skills: ctx.skills } : {}),
    ...(ctx.mcp ? { mcp: ctx.mcp } : {}),
  };

  const toolCalls: StreamPart[] = [];
  try {
    for await (const part of streamTurn(ctx.baseUrl, ctx.thread, body)) {
      renderPart(part);
      if (part.type === "tool-call") toolCalls.push(part);
    }
  } catch (e) {
    output.write(`\n[turn failed] ${e instanceof Error ? e.message : String(e)}\n`);
    return; // transport/pre-stream failure — leave the folder untouched
  }
  output.write("\n");

  // Reconstruct final files by folding the streamed tool-calls (canonical ops),
  // then write the diff. Tool-calls that streamed before a mid-stream error are
  // real server-side mutations, so they still apply.
  const bundle = new FileBundle(before);
  for (const tc of toolCalls) applyToolCall(bundle, tc);
  const changes = reconcile(ctx.thread, before, bundle.snapshot(), ctx.dryRun);
  renderSummary(changes, ctx.dryRun);

  // Refresh the derived artifacts (.excalidraw, *.gen.json) — one pipeline
  // seam, see derived.ts. Skipped under --dry-run: nothing landed on disk.
  if (!ctx.dryRun) {
    for (const n of materializeDerived(threadDir(ctx.thread), ctx.thread, changes, bundle.snapshot())) {
      output.write(n.ok ? `  ⚙ ${n.message}\n` : `  ✗ ${n.message}\n`);
    }
  }
}

function printHelp(): void {
  output.write("  commands: /threads (switch), /quit, /help\n");
}

/** The per-thread readline loop. Returns when the user switches threads or quits. */
async function chatLoop(ctx: ChatCtx): Promise<"switch" | "quit"> {
  const rl = readline.createInterface({ input, output });
  rl.on("SIGINT", () => {
    output.write("\n");
    process.exit(0); // Ctrl-C: hard exit (the in-process server dies with us)
  });
  try {
    for (;;) {
      let raw: string;
      try {
        raw = await rl.question(`\n${ctx.thread} ❯ `);
      } catch {
        return "quit"; // stdin closed (Ctrl-D / EOF) — exit cleanly, no stack trace
      }
      const line = raw.trim();
      if (line === "") continue;
      if (line === "/quit") return "quit";
      if (line === "/threads") return "switch";
      if (line === "/help") {
        printHelp();
        continue;
      }
      await runTurn(ctx, line);
    }
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  loadDotenv();
  const dryRun = process.argv.includes("--dry-run");
  const positional = process.argv.slice(2).find((a) => !a.startsWith("-"));

  let apiKey: string;
  try {
    apiKey = loadAnthropicKey();
  } catch (e) {
    output.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
    return;
  }

  const skills = loadRepoSkills(SKILLS_DIR);
  const store = new InMemoryConversationStore();
  const app = createApp({ store, model: createModel({ apiKey }) });
  const { baseUrl, close } = await listen0(app.listen(0));

  // MCP discovery (Task E2): both env vars set → push { url, token } on every
  // turn (mirrors how the caller resolves skills). Either unset → no `mcp`
  // field at all, same as a checkout with no dependency-discovery server.
  const mcpUrl = process.env.AEP_MCP_URL;
  const mcpToken = process.env.AEP_MCP_TOKEN;
  const mcp = mcpUrl && mcpToken ? { url: mcpUrl, token: mcpToken } : undefined;

  clack.intro("AEP spec-agent playground");
  if (skills.length > 0) clack.log.info(`skills: ${skills.map((s) => s.name).join(", ")}`);
  if (mcp) clack.log.info(`mcp discovery: ${mcp.url}`);
  if (dryRun) clack.log.warn("dry-run: changes are shown but NOT written to disk");

  try {
    let thread = positional;
    if (thread && !isValidThreadName(thread)) {
      clack.log.error(`invalid thread name "${thread}" — letters, digits, . _ - only`);
      thread = undefined;
    }
    if (thread) ensureThread(thread);

    for (;;) {
      if (!thread) {
        const picked = await pickThread();
        if (!picked) break;
        thread = picked;
      }
      const action = await chatLoop({ thread, baseUrl, skills, dryRun, ...(mcp ? { mcp } : {}) });
      if (action === "quit") break;
      thread = undefined; // /threads → back to the picker
    }
  } finally {
    await close();
    clack.outro("bye");
  }
}

main().catch((err: unknown) => {
  output.write(`playground error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exitCode = 1;
});
