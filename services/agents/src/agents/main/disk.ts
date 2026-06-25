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
 * DiskMirror — the real-filesystem backing for the main agent's disk mode.
 *
 * The in-memory FileBundle stays the canonical model; this mirror is what the
 * live streaming writes into so you can open `<root>/specs/.../openapi.yaml`
 * and watch it change token by token. Writes are SYNCHRONOUS so each streamed
 * delta is on disk (and visible to an editor's file watcher) before the next
 * one is computed. Every path is sandboxed to `root` — the model supplies the
 * keys, so a `..` escape must never reach the real FS.
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/** The minimal write surface the stream consumer drives (run.ts / tests). */
export interface DiskSink {
  write(key: string, content: string): void;
  remove(key: string): void;
}

export class DiskMirror implements DiskSink {
  readonly root: string;
  private readonly rootAbs: string;

  constructor(root: string) {
    this.root = root;
    this.rootAbs = resolve(root);
  }

  /** Resolve a bundle key to an absolute path, refusing anything outside root. */
  private resolveKey(key: string): string {
    const abs = resolve(this.rootAbs, key);
    if (abs !== this.rootAbs && !abs.startsWith(this.rootAbs + sep)) {
      throw new Error(`path "${key}" escapes the root directory`);
    }
    return abs;
  }

  write(key: string, content: string): void {
    const abs = this.resolveKey(key);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }

  remove(key: string): void {
    const abs = this.resolveKey(key);
    if (existsSync(abs)) unlinkSync(abs);
  }

  exists(key: string): boolean {
    return existsSync(this.resolveKey(key));
  }

  read(key: string): string | undefined {
    const abs = this.resolveKey(key);
    return existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
  }

  /** Recursively read every file under root → record keyed root-relative (forward slashes). */
  load(): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue; // skip .git etc.
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) {
          out[relative(this.rootAbs, full).split(sep).join("/")] = readFileSync(full, "utf8");
        }
      }
    };
    if (existsSync(this.rootAbs)) walk(this.rootAbs);
    return out;
  }

  /** True when `<root>/specs` is missing or empty. */
  private specsEmpty(): boolean {
    const specs = join(this.rootAbs, "specs");
    return !existsSync(specs) || readdirSync(specs).length === 0;
  }

  /** Write the seed files only if there is nothing under `specs/` yet. Returns whether it seeded. */
  seedIfEmpty(files: Record<string, string>): boolean {
    if (!this.specsEmpty()) return false;
    this.writeAll(files);
    return true;
  }

  /** Wipe `<root>/specs` and write the seed files fresh. Returns the file count. */
  reset(files: Record<string, string>): number {
    rmSync(join(this.rootAbs, "specs"), { recursive: true, force: true });
    return this.writeAll(files);
  }

  private writeAll(files: Record<string, string>): number {
    let n = 0;
    for (const [key, content] of Object.entries(files)) {
      this.write(key, content);
      n++;
    }
    return n;
  }
}
