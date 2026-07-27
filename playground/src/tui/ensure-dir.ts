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
 * ONE fence-and-create step for a project directory, shared by the picker and
 * the `play <dir>` entry so the rules can't drift. Order is load-bearing: the
 * path is FENCED first (`paths.ts` — never offer to create an illegal in-repo
 * path), then resolved:
 *
 *   - exists + directory → proceed.
 *   - exists + not a directory → refuse.
 *   - missing + interactive (TTY) → tell the user, ask, `mkdir -p` on yes.
 *   - missing + headless (no TTY) → refuse (we can't ask; never create silently).
 *
 * "Create" is a bare `mkdir -p`: `openSession` seeds `.aep-playground/` on first
 * open and the agent writes `specs/` on its first turn, so there is nothing else
 * to scaffold here.
 */

import { existsSync, mkdirSync, statSync } from "node:fs";
import * as clack from "@clack/prompts";
import { projectDirError } from "../paths.js";

export type EnsureResult = { ok: true; path: string } | { ok: false; message: string };

/** Fence, then ensure `abs` (an already-expanded absolute path) exists as a directory. */
export async function ensureProjectDir(abs: string, opts: { interactive: boolean }): Promise<EnsureResult> {
  const fence = projectDirError(abs);
  if (fence) return { ok: false, message: fence };

  if (existsSync(abs)) {
    return statSync(abs).isDirectory() ? { ok: true, path: abs } : { ok: false, message: `not a directory: ${abs}` };
  }

  if (!opts.interactive) {
    return { ok: false, message: `directory does not exist: ${abs} — create it, or run interactively to be prompted` };
  }
  const create = await clack.confirm({ message: `${abs} does not exist. Create it?` });
  if (clack.isCancel(create) || !create) return { ok: false, message: "aborted — directory not created" };
  mkdirSync(abs, { recursive: true });
  return { ok: true, path: abs };
}
