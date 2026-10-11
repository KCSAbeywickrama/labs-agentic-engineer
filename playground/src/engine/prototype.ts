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
 * The prototype verb's file side: the review batch the preview saved, and the
 * preview itself. The review page is `@wso2/prototype-cli`'s preview on the
 * Oxygen theme, the theme the console's review frame and the design agent's
 * render check draw with; its saved batch is the submission the console sends.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { isPrototypeFeedback, type PrototypeFeedback } from "@aep/agent-stream";
import { FEEDBACK_PATH } from "@wso2/prototype-cli/feedback";
import { prototypeHash } from "@wso2/prototype-kit/feedback";
import { REPO_ROOT } from "../paths.js";

const PROTOTYPE_THEME = "@wso2/prototype-theme-oxygen";

/** Where a web application's prototype pair lives in the project. */
export function prototypeDir(projectDir: string, component: string): string {
  return join(projectDir, "specs/design/components", component);
}

export type SavedFeedback = { ok: true; feedback: PrototypeFeedback; file: string } | { ok: false; reason: string };

/**
 * The batch the preview saved for `component`, checked as the design agent
 * checks it and against the prototype on disk. A batch saved on an earlier
 * revision is refused: its element ids may name what the revision since
 * removed.
 */
export function savedFeedback(projectDir: string, component: string): SavedFeedback {
  const dir = prototypeDir(projectDir, component);
  const file = join(dir, FEEDBACK_PATH);
  if (!existsSync(file)) {
    return { ok: false, reason: `no saved review for ${component}: open the preview (--preview), comment, and Save feedback` };
  }
  let saved: { prototypeHash?: unknown; requests?: unknown };
  try {
    saved = JSON.parse(readFileSync(file, "utf8")) as typeof saved;
  } catch {
    return { ok: false, reason: `${file} is not JSON` };
  }
  const feedback = { component, prototypeHash: saved.prototypeHash, requests: saved.requests };
  if (!isPrototypeFeedback(feedback)) return { ok: false, reason: `${file} is not a valid review batch` };
  const manifest = join(dir, "prototype.json");
  const source = join(dir, "prototype.tsx");
  if (!existsSync(manifest) || !existsSync(source)) return { ok: false, reason: `${component} has no prototype to revise` };
  if (prototypeHash(readFileSync(manifest, "utf8"), readFileSync(source, "utf8")) !== feedback.prototypeHash) {
    return { ok: false, reason: `the review was saved on an earlier revision of ${component}'s prototype: review the current one and save again` };
  }
  return { ok: true, feedback, file };
}

/** A sent batch is done with: the next save starts a new review. */
export function clearSavedFeedback(file: string): void {
  rmSync(file, { force: true });
}

/**
 * Serve the preview until it is interrupted; resolves to its exit code. The
 * playground waits out its own Ctrl-C so the preview's shutdown finishes first.
 */
export function previewPrototype(projectDir: string, component: string, opts: { open: boolean }): Promise<number> {
  const bin = join(dirname(createRequire(import.meta.url).resolve("@wso2/prototype-cli/package.json")), "dist", "bin.js");
  const args = [bin, "preview", prototypeDir(projectDir, component), "--theme", PROTOTYPE_THEME, ...(opts.open ? ["--open"] : [])];
  const ignore = (): void => {};
  process.on("SIGINT", ignore);
  return new Promise((resolve) => {
    // The theme resolves from the playground package, which depends on it.
    const child = spawn(process.execPath, args, { cwd: join(REPO_ROOT, "playground"), stdio: "inherit" });
    const done = (code: number): void => {
      process.off("SIGINT", ignore);
      resolve(code);
    };
    child.on("error", () => done(2));
    child.on("close", (code, signal) => done(signal ? 0 : (code ?? 2)));
  });
}
