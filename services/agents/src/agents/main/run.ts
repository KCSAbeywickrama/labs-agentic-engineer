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
 * Main agent — a console demo of prompt-driven file mutation, with an optional
 * disk-backed mode that streams every edit into real files.
 *
 * Default (in-memory):  npm run main -- "make /hello accept a name query param"
 * Disk mode:            npm run main -- --root foo1 "rename the hello message"
 *
 * In disk mode the agent seeds `foo1/specs/**` from the seed corpus if empty,
 * then streams each mutation into the real files: editFile removes oldString and
 * types newString into the gap delta-by-delta, addFile creates the file and
 * fills it live. Open `foo1/specs/.../openapi.yaml` in an editor (with reload-
 * on-change) to watch. `--reset` re-seeds from scratch. See design.md §10.
 *
 * The Anthropic key comes from ANTHROPIC_API_KEY (env, or the nearest .env
 * walking up to the monorepo root).
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ToolLoopAgent, parsePartialJson, stepCountIs } from "ai";
import { createModel } from "../../shared/model.js";
import { config } from "../../shared/config.js";
import { FileBundle, lf } from "./bundle.js";
import type { OpResult } from "./bundle.js";
import { DiskMirror } from "./disk.js";
import type { DiskSink } from "./disk.js";
import {
  buildTools,
  ADD_FILE,
  EDIT_FILE,
  REMOVE_FILE,
  SET_FRONTMATTER_FIELD,
} from "./tool.js";
import { instructions, buildPrompt, SEED_FILES } from "./prompt.js";

/**
 * Return ANTHROPIC_API_KEY. Prefer the ambient env; otherwise load the nearest
 * `.env` walking up from this file to the monorepo root (no hard-coded path, so
 * it survives moving the package around).
 */
function loadAnthropicKey(): string {
  if (!process.env.ANTHROPIC_API_KEY) {
    let dir = fileURLToPath(new URL(".", import.meta.url));
    for (let i = 0; i < 12; i++) {
      const candidate = join(dir, ".env");
      if (existsSync(candidate)) {
        process.loadEnvFile(candidate);
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break; // reached filesystem root
      dir = parent;
    }
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Export it, or add it to a .env at the monorepo root (see .env.example).",
    );
  }
  return key;
}

// -- Console styling -------------------------------------------------------

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const RULE = "─".repeat(60);

const OP_GLYPH: Record<string, string> = {
  [ADD_FILE]: "＋",
  [EDIT_FILE]: "✎",
  [REMOVE_FILE]: "🗑",
  [SET_FRONTMATTER_FIELD]: "✑",
};

/** Minimal shape of the fullStream parts we consume (real + synthetic in tests). */
export interface StreamPart {
  type: string;
  id?: string;
  delta?: string;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
}

/** Per-call streaming state, keyed by tool-call id. */
interface CallState {
  toolName: string;
  buffer: string;
  headerPrinted: boolean;
  printedOld: number;
  printedNew: number;
  newStarted: boolean;
  printedBody: number;
  /** Disk-mode: located splice point for editFile (null = cannot stream, e.g. ambiguous). */
  splice?: { head: string; tail: string } | null;
  diskCreated: boolean;
}

export interface RenderDeps {
  bundle: FileBundle;
  /** When set, mutations are streamed into the real filesystem. */
  disk?: DiskSink | undefined;
  /** Sink for console output (defaults to stdout). */
  out?: ((s: string) => void) | undefined;
}

/**
 * Consume a fullStream-like sequence: render the live diff to the console and,
 * in disk mode, stream each mutation into the real files. Factored out of
 * main() so tests can drive it with synthetic parts and assert on-disk states.
 */
export async function renderRun(
  stream: AsyncIterable<StreamPart>,
  deps: RenderDeps,
): Promise<void> {
  const { bundle, disk } = deps;
  const out = deps.out ?? ((s) => process.stdout.write(s));
  const calls = new Map<string, CallState>();

  const header = (toolName: string, path: string): void => {
    out(`\n${RULE}\n${OP_GLYPH[toolName] ?? "•"} ${toolName}  ${path}\n${RULE}\n`);
  };
  // Write `full`'s unprinted suffix in `color`, prefixing `gutter` at line starts.
  const gutter = (full: string, printed: number, color: string, g: string): number => {
    if (full.length <= printed) return printed;
    const suffix = full.slice(printed);
    const lead = printed === 0 ? g : "";
    out(`${color}${lead}${suffix.replace(/\n/g, `\n${g}`)}${RESET}`);
    return full.length;
  };
  const tryDisk = (fn: () => void): void => {
    if (!disk) return;
    try {
      fn();
    } catch (err) {
      out(`\n${RED}  ✗ disk: ${err instanceof Error ? err.message : String(err)}${RESET}\n`);
    }
  };

  for await (const part of stream) {
    switch (part.type) {
      case "text-delta": {
        out(`${DIM}${part.text ?? ""}${RESET}`);
        break;
      }

      case "tool-input-start": {
        calls.set(part.id!, {
          toolName: part.toolName!,
          buffer: "",
          headerPrinted: false,
          printedOld: 0,
          printedNew: 0,
          newStarted: false,
          printedBody: 0,
          diskCreated: false,
        });
        break;
      }

      case "tool-input-delta": {
        const st = calls.get(part.id!);
        if (!st) break;
        st.buffer += part.delta ?? "";
        const { value } = await parsePartialJson(st.buffer);
        if (!value || typeof value !== "object" || Array.isArray(value)) break;
        const v = value as Record<string, unknown>;

        if (!st.headerPrinted && typeof v.path === "string") {
          header(st.toolName, v.path);
          st.headerPrinted = true;
        }
        if (!st.headerPrinted || typeof v.path !== "string") break;
        const path = v.path;

        if (st.toolName === EDIT_FILE) {
          if (typeof v.oldString === "string") {
            st.printedOld = gutter(v.oldString, st.printedOld, RED, "  - ");
          }
          if (typeof v.newString === "string") {
            if (!st.newStarted) {
              out("\n");
              st.newStarted = true;
              // oldString is final once newString appears — locate (via the bundle's
              // own matcher, so the preview can't diverge from the commit) + remove it.
              tryDisk(() => {
                if (st.splice !== undefined) return;
                st.splice = bundle.locate(path, v.oldString as string);
                if (st.splice) disk!.write(path, st.splice.head + st.splice.tail);
              });
            }
            st.printedNew = gutter(v.newString, st.printedNew, GREEN, "  + ");
            tryDisk(() => {
              if (st.splice) disk!.write(path, st.splice.head + lf(v.newString as string) + st.splice.tail);
            });
          }
        } else if (st.toolName === ADD_FILE) {
          tryDisk(() => {
            if (!st.diskCreated) {
              disk!.write(path, "");
              st.diskCreated = true;
            }
          });
          if (typeof v.content === "string") {
            st.printedBody = gutter(v.content, st.printedBody, DIM, "  ");
            tryDisk(() => disk!.write(path, lf(v.content as string)));
          }
        }
        break;
      }

      case "tool-call": {
        const st = calls.get(part.toolCallId!);
        if (!st?.headerPrinted) break;
        if (st.toolName === SET_FRONTMATTER_FIELD) {
          const input = part.input as Record<string, unknown>;
          out(`${DIM}  ${String(input.key)}: ${JSON.stringify(input.value)}${RESET}`);
        }
        break;
      }

      case "tool-result": {
        const r = part.output as OpResult | undefined;
        const st = calls.get(part.toolCallId!);
        // Reconcile disk to the canonical bundle content (authoritative final
        // write; covers setFrontmatterField/removeFile and any streaming drift).
        if (r?.ok) {
          tryDisk(() => {
            if (r.op === "remove") disk!.remove(r.path);
            else disk!.write(r.path, bundle.read(r.path) ?? "");
          });
        }
        renderResult(out, r);
        if (st) calls.delete(part.toolCallId!);
        break;
      }

      case "tool-error": {
        out(`\n${RED}  ✗ tool error: ${String(part.error)}${RESET}\n`);
        if (part.toolCallId) calls.delete(part.toolCallId);
        break;
      }
    }
  }
}

function renderResult(out: (s: string) => void, r: OpResult | undefined): void {
  if (!r) return;
  if (r.ok) {
    if (r.warning) out(`\n${YELLOW}  ⚠ applied with warning — ${r.warning}${RESET}\n`);
    else if (r.status === "applied") out(`\n${GREEN}  ✓ applied${RESET}\n`);
    else if (r.status === "already-applied") out(`\n${DIM}  ↻ already applied — skipping${RESET}\n`);
    else out(`\n${DIM}  ∅ no change${RESET}\n`);
    return;
  }
  out(`\n${RED}  ✗ ${r.code}: ${r.message}${RESET}\n`);
  for (const c of r.candidates ?? []) {
    out(`${DIM}      L${c.line}: ${c.text}${RESET}\n`);
  }
}

/** Wraps a DiskSink to log every write/remove with a timestamp (MAIN_DISK_DEBUG=1). */
class DebugSink implements DiskSink {
  private t0 = Date.now();
  constructor(private inner: DiskSink) {}
  write(key: string, content: string): void {
    process.stderr.write(`[disk +${String(Date.now() - this.t0).padStart(6)}ms] write ${key} (${content.length}b)\n`);
    this.inner.write(key, content);
  }
  remove(key: string): void {
    process.stderr.write(`[disk +${String(Date.now() - this.t0).padStart(6)}ms] remove ${key}\n`);
    this.inner.remove(key);
  }
}

interface Args {
  root?: string | undefined;
  reset: boolean;
  instruction: string;
}

function parseArgs(argv: string[]): Args {
  let root: string | undefined;
  let reset = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") root = argv[++i];
    else if (argv[i] === "--reset") reset = true;
    else rest.push(argv[i]!);
  }
  return { root, reset, instruction: rest.join(" ").trim() };
}

async function main(): Promise<void> {
  const apiKey = loadAnthropicKey();
  const args = parseArgs(process.argv.slice(2));
  const instruction =
    args.instruction ||
    "Change the hello message from \"Hello, World!\" to \"Hi there!\" everywhere it appears in the spec.";

  let bundle: FileBundle;
  let disk: DiskMirror | undefined;
  if (args.root) {
    disk = new DiskMirror(args.root);
    if (args.reset) {
      const n = disk.reset(SEED_FILES);
      process.stdout.write(`${DIM}Reset ${args.root}/specs (${n} seed files).${RESET}\n`);
    } else if (disk.seedIfEmpty(SEED_FILES)) {
      process.stdout.write(`${DIM}Seeded ${args.root}/specs from the seed corpus.${RESET}\n`);
    }
    bundle = new FileBundle(disk.load(), { yamlMode: "warn" });
    process.stdout.write(`${DIM}Disk mode: mutating files under ${args.root}/${RESET}\n`);
  } else {
    bundle = new FileBundle(SEED_FILES);
  }

  const agent = new ToolLoopAgent({
    model: createModel({ apiKey }),
    instructions,
    tools: buildTools(bundle),
    stopWhen: stepCountIs(config.maxSteps),
  });

  process.stdout.write(`${DIM}Instruction:${RESET} ${instruction}\n`);

  const sink: DiskSink | undefined =
    disk && process.env.MAIN_DISK_DEBUG ? new DebugSink(disk) : disk;

  const result = await agent.stream({ prompt: buildPrompt(bundle.snapshot(), instruction) });
  await renderRun(result.fullStream as AsyncIterable<StreamPart>, { bundle, disk: sink });

  const usage = await result.totalUsage;
  const touched = bundle.touched();
  process.stdout.write(`\n${RULE}\n`);
  process.stdout.write(
    `✅ done — ${touched.length} file(s) touched: ${touched.join(", ") || "(none)"}\n`,
  );
  if (disk) process.stdout.write(`${DIM}written under ${args.root}/${RESET}\n`);
  process.stdout.write(
    `${DIM}tokens in/out: ${usage.inputTokens ?? "?"}/${usage.outputTokens ?? "?"}${RESET}\n`,
  );
}

// Run only when invoked directly (`tsx run.ts`), not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("[main-agent]", err);
    process.exitCode = 1;
  });
}
