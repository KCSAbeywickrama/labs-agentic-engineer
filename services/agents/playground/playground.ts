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
 * It boots the real Express app in-process (the eval-harness pattern) over a
 * temp workspace mount, then for a named THREAD — a folder under
 * `chat_playground/` — runs a multi-turn loop: read the folder → materialize it
 * (plus the repo skill library) into a fake immutable workspace snapshot → POST
 * one workspace-shape turn → stream the frames → fold the tool-calls back
 * through a `FileBundle` → write the folder. The service writes no files; this
 * client owns the disk.
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
import {
  FileBundle,
  applyToolCall,
  streamTurn,
  type StreamPart,
  type TurnRequest,
} from "@aep/agent-stream";
import { createApp } from "../src/server.js";
import { createModel } from "../src/shared/model.js";
import { loadDotenv, loadAnthropicKey } from "../src/shared/env.js";
import { filterTurnSnapshot } from "../src/conversation/load-workspace.js";
import { InMemoryConversationStore } from "../src/store/memory-store.js";
import { listen0 } from "../src/shared/listen.js";
import { loadRepoSkills, type RepoSkill } from "../evals/skills.js";
import { EVAL_AUTH, evalTurnHeaders } from "../evals/auth.js";
import { EvalWorkspace, EVAL_ORG, evalConversationId } from "../evals/workspace.js";
import { ensureThread, isValidThreadName, listThreads, readSnapshot, reconcile, threadDir } from "./threads.js";
import { renderPart, renderSummary } from "./render.js";
import { materializeDerived } from "./derived.js";
import { createMcpResolver, readMcpEnv, type McpResolver } from "./mcp.js";

// Repo-root `skills/` (services/agents/playground → up 3). The whole library is
// materialized into the fixture `_skills` snapshot the in-process server reads (§12).
const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "skills");

interface ChatCtx {
  thread: string;
  baseUrl: string;
  skills: RepoSkill[];
  dryRun: boolean;
  /** M2M token + `X-Anthropic-Key` sent on every turn, like any caller. */
  headers: Record<string, string>;
  /** The fixture mount the in-process server reads; snapshots materialize here. */
  ws: EvalWorkspace;
  /** Per-process turn counter (turnId attribution only). */
  turnIndex: number;
  /**
   * Resolves the MCP discovery bundle — one instance per playground session
   * (shared "warn once" state + env snapshot). `resolve()` mints fresh every
   * call when auto-minting (see mcp.ts); resolves null when AEP_MCP_URL is unset.
   */
  mcpResolver: McpResolver;
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
    validate: (v) => (isValidThreadName((v ?? "").trim()) ? undefined : "letters, digits, . _ - only (no leading dot, no --)"),
  });
  if (clack.isCancel(name)) return null;
  const n = name.trim();
  ensureThread(n);
  return n;
}

/** Run one turn end to end: snapshot → materialize → stream → reconstruct → write. */
async function runTurn(ctx: ChatCtx, instruction: string): Promise<void> {
  const before = readSnapshot(ctx.thread);
  // Workspace shape (§12): the folder state is materialized into a fake
  // immutable snapshot on the mount and the body carries only the reference;
  // the server applies the turn filter when it reads the snapshot back.
  const conversationId = evalConversationId(ctx.thread);
  // MCP discovery bundle, resolved fresh for THIS turn — never cached (a mint's
  // ~5min TTL is shorter than a chat session; see mcp.ts). null when disabled.
  const mcp = await ctx.mcpResolver.resolve();
  const body: TurnRequest = {
    instruction,
    workspace: ctx.ws.workspaceRef(conversationId, ctx.turnIndex++, before, ctx.skills),
    ...(mcp ? { mcp } : {}),
  };

  const toolCalls: StreamPart[] = [];
  try {
    for await (const part of streamTurn(ctx.baseUrl, conversationId, body, { headers: ctx.headers })) {
      renderPart(part);
      if (part.type === "tool-call") toolCalls.push(part);
    }
  } catch (e) {
    output.write(`\n[turn failed] ${e instanceof Error ? e.message : String(e)}\n`);
    return; // transport/pre-stream failure — leave the folder untouched
  }
  output.write("\n");

  // Reconstruct final files by folding the streamed tool-calls (canonical ops)
  // over the SERVER'S filtered view of the snapshot — the state the agent
  // actually saw — then write the diff. Tool-calls that streamed before a
  // mid-stream error are real server-side mutations, so they still apply.
  const view = filterTurnSnapshot(before);
  const bundle = new FileBundle(view);
  for (const tc of toolCalls) applyToolCall(bundle, tc);
  const folded = bundle.snapshot();
  // Rebuild the full folder state: files the turn filter hid from the agent
  // stay untouched; deletions apply only to files the agent could see.
  const after: Record<string, string> = { ...before };
  for (const path of Object.keys(view)) {
    if (!(path in folded)) delete after[path];
  }
  Object.assign(after, folded);
  const changes = reconcile(ctx.thread, before, after, ctx.dryRun);
  renderSummary(changes, ctx.dryRun);

  // Refresh the derived artifacts (.excalidraw, *.gen.json) — one pipeline
  // seam, see derived.ts. Skipped under --dry-run: nothing landed on disk.
  if (!ctx.dryRun) {
    for (const n of materializeDerived(threadDir(ctx.thread), ctx.thread, changes, after)) {
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
  // In-process server: the M2M gate runs on the shared-secret path, the model
  // is built per turn from the X-Anthropic-Key header (like the deployed
  // service), and the workspace snapshots are read from a temp fixture mount
  // this process materializes (the eval-harness pattern).
  const ws = new EvalWorkspace();
  const app = createApp({
    store,
    buildModel: (key) => createModel({ apiKey: key }),
    auth: { audience: EVAL_AUTH.audience, secret: EVAL_AUTH.secret },
    workspaceMountRoot: ws.root,
  });
  const { baseUrl, close } = await listen0(app.listen(0));
  // X-Org-Id is load-bearing on workspace turns (the §12 fence).
  const headers = await evalTurnHeaders(apiKey, EVAL_ORG);

  // MCP discovery: one resolver for the whole session (shared "warn once"
  // state). Built from env, never eagerly minted — resolve() runs fresh per
  // turn (see mcp.ts + runTurn), so a session that sends no turn never hits the
  // network for it.
  const mcpEnv = readMcpEnv();
  const mcpResolver = createMcpResolver(mcpEnv, (msg) => clack.log.warn(msg));

  clack.intro("AEP spec-agent playground");
  if (skills.length > 0) clack.log.info(`skills: ${skills.map((s) => s.name).join(", ")}`);
  if (mcpEnv.url) {
    clack.log.info(
      `mcp discovery: ${mcpEnv.url} (${mcpEnv.token ? "static token" : "auto-mint per turn"})`,
    );
  }
  if (dryRun) clack.log.warn("dry-run: changes are shown but NOT written to disk");

  try {
    let thread = positional;
    if (thread && !isValidThreadName(thread)) {
      clack.log.error(`invalid thread name "${thread}" — letters, digits, . _ - only (no leading dot, no --)`);
      thread = undefined;
    }
    if (thread) ensureThread(thread);

    for (;;) {
      if (!thread) {
        const picked = await pickThread();
        if (!picked) break;
        thread = picked;
      }
      const action = await chatLoop({ thread, baseUrl, skills, dryRun, headers, ws, turnIndex: 0, mcpResolver });
      if (action === "quit") break;
      thread = undefined; // /threads → back to the picker
    }
  } finally {
    await close();
    ws.cleanup();
    clack.outro("bye");
  }
}

main().catch((err: unknown) => {
  output.write(`playground error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exitCode = 1;
});
