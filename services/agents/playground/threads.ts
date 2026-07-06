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
 * A thread is a folder under `chat_playground/` whose name doubles as the
 * conversation-id suffix (the playground namespaces it per §12). This module is
 * the only place that touches that tree: list threads, validate a name, read
 * the folder into the path→content map the playground materializes into a
 * workspace snapshot, and reconcile the agent's reconstructed snapshot back to
 * disk. Keys are POSIX-relative; dot-entries and binary files are skipped;
 * every write is sandboxed inside the thread dir (the model supplies the keys).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Thread data lives next to the code, under `services/agents/chat_playground/` (gitignored). */
export const THREADS_ROOT = join(here, "..", "chat_playground");

// A legal directory name AND a clean conversation-id suffix — no separators,
// no `..`, and no `--` (the namespaced id's segment delimiter, §12).
const NAME_RE = /^[A-Za-z0-9._-]+$/;

export function isValidThreadName(name: string): boolean {
  return NAME_RE.test(name) && name !== "." && name !== ".." && !name.includes("--") && !name.startsWith(".");
}

export function threadDir(name: string): string {
  return join(THREADS_ROOT, name);
}

/** Create the thread folder if absent (reopen-on-exist; no scaffolding). */
export function ensureThread(name: string): void {
  mkdirSync(threadDir(name), { recursive: true });
}

export interface ThreadInfo {
  name: string;
  fileCount: number;
}

/** Every thread folder, sorted, with its current text-file count. */
export function listThreads(): ThreadInfo[] {
  if (!existsSync(THREADS_ROOT)) return [];
  return readdirSync(THREADS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => ({ name: d.name, fileCount: Object.keys(readSnapshot(d.name)).length }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function walk(dir: string, rel: string, out: Record<string, string>): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue; // skip dot-entries (.git, .DS_Store, …)
    const abs = join(dir, e.name);
    const key = rel ? `${rel}/${e.name}` : e.name; // POSIX-relative key
    if (e.isDirectory()) {
      walk(abs, key, out);
      continue;
    }
    if (!e.isFile()) continue;
    // Derived artifacts (compiled .excalidraw, projected *.gen.json) never
    // enter the bundle: the agent must not see or edit them, and inlining
    // generated JSON into every turn's prompt would be pure token waste.
    if (e.name.endsWith(".excalidraw") || e.name.endsWith(".gen.json")) continue;
    const buf = readFileSync(abs);
    if (buf.includes(0)) continue; // a NUL byte → binary; the agent only edits text
    out[key] = buf.toString("utf8");
  }
}

/** Read the whole thread folder into the map a turn's workspace snapshot is built from. */
export function readSnapshot(name: string): Record<string, string> {
  const out: Record<string, string> = {};
  const root = threadDir(name);
  if (existsSync(root)) walk(root, "", out);
  return out;
}

export type ChangeKind = "add" | "edit" | "remove";
export interface FileChange {
  kind: ChangeKind;
  path: string;
}

/** Resolve a snapshot key under `root`, refusing anything that escapes it. */
function resolveWithin(root: string, key: string): string {
  const abs = resolve(root, key);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`path "${key}" escapes the thread directory`);
  }
  return abs;
}

/**
 * Diff `before` (read at turn start) against `after` (the agent's reconstructed
 * snapshot) and, unless `dryRun`, write the changes to disk: new/edited files
 * written, vanished files deleted. Returns the change list either way.
 */
export function reconcile(
  name: string,
  before: Record<string, string>,
  after: Record<string, string>,
  dryRun: boolean,
): FileChange[] {
  const root = resolve(threadDir(name));
  const changes: FileChange[] = [];

  for (const [path, content] of Object.entries(after)) {
    if (!(path in before)) changes.push({ kind: "add", path });
    else if (before[path] !== content) changes.push({ kind: "edit", path });
    else continue; // unchanged
    if (!dryRun) {
      const abs = resolveWithin(root, path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf8");
    }
  }

  for (const path of Object.keys(before)) {
    if (path in after) continue;
    changes.push({ kind: "remove", path });
    if (!dryRun) rmSync(resolveWithin(root, path), { force: true });
  }

  return changes;
}
