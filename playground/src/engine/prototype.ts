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
 * The prototype verb's review side. The review page is `@wso2/prototype-cli`'s
 * preview on the Oxygen theme, the theme the console's review frame and the
 * design agent's render check draw with. Each Save feedback there becomes
 * draft comments on the prototype in `specs/design/review.json`, as the
 * console's review queue is its drafts; Address comments sends them.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, unwatchFile, watchFile } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { FEEDBACK_PATH } from "@wso2/prototype-cli/feedback";
import { parseFeedbackSubmission } from "@wso2/prototype-kit/feedback";
import { REPO_ROOT } from "../paths.js";
import { readReviewFile, withSavedDrafts, writeReviewFile } from "./review-file.js";

const PROTOTYPE_THEME = "@wso2/prototype-theme-oxygen";

/** Where a web application's prototype pair lives in the project. */
export function prototypeDir(projectDir: string, component: string): string {
  return join(projectDir, "specs/design/components", component);
}

/** The review file's key for a prototype: its manifest, as the console keys it. */
export function prototypeReviewPath(component: string): string {
  return `specs/design/components/${component}/prototype.json`;
}

export type FoldedReview = { ok: true; ids: string[]; count: number } | { ok: false; reason: string };

/**
 * Fold the review the preview saved for `component` into the project's
 * review file, as drafts that replace this session's earlier ones
 * (`previous`), then remove the saved file: its comments now live in the
 * review. Nothing saved is `{ ok: true, ids: previous, count: 0 }`.
 */
export function foldSavedReview(projectDir: string, component: string, previous: readonly string[], now: string): FoldedReview {
  const file = join(prototypeDir(projectDir, component), FEEDBACK_PATH);
  if (!existsSync(file)) return { ok: true, ids: [...previous], count: 0 };
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { ok: false, reason: `${file} is not JSON` };
  }
  const parsed = parseFeedbackSubmission(value);
  if ("reason" in parsed) return { ok: false, reason: `${file}: ${parsed.reason}` };
  const read = readReviewFile(projectDir);
  if (!read.ok) return { ok: false, reason: read.reason };
  const folded = withSavedDrafts(read.review, prototypeReviewPath(component), previous, parsed.submission.requests, now);
  writeReviewFile(projectDir, folded.review);
  rmSync(file, { force: true });
  return { ok: true, ids: folded.ids, count: folded.ids.length };
}

/**
 * Serve the preview until it is interrupted; resolves to its exit code. Each
 * Save feedback is folded into the review file as it lands, and once more at
 * the end. The playground waits out its own Ctrl-C so the preview's shutdown
 * finishes first.
 */
export function previewPrototype(
  projectDir: string,
  component: string,
  opts: { open: boolean; report: (line: string) => void },
): Promise<number> {
  const bin = join(dirname(createRequire(import.meta.url).resolve("@wso2/prototype-cli/package.json")), "dist", "bin.js");
  const args = [bin, "preview", prototypeDir(projectDir, component), "--theme", PROTOTYPE_THEME, ...(opts.open ? ["--open"] : [])];
  const saved = join(prototypeDir(projectDir, component), FEEDBACK_PATH);
  let session: string[] = [];
  const fold = (): void => {
    const folded = foldSavedReview(projectDir, component, session, new Date().toISOString());
    if (!folded.ok) return opts.report(`✗ ${folded.reason}`);
    session = folded.ids;
    if (folded.count > 0) opts.report(`✓ ${folded.count} comment(s) saved as drafts in specs/design/review.json: send them with address-comments`);
  };
  const onSave = (now: { mtimeMs: number }): void => {
    if (now.mtimeMs > 0) fold();
  };
  watchFile(saved, { interval: 300 }, onSave);
  const ignore = (): void => {};
  process.on("SIGINT", ignore);
  return new Promise((resolve) => {
    // The theme resolves from the playground package, which depends on it.
    const child = spawn(process.execPath, args, { cwd: join(REPO_ROOT, "playground"), stdio: "inherit" });
    const done = (code: number): void => {
      unwatchFile(saved, onSave);
      fold();
      process.off("SIGINT", ignore);
      resolve(code);
    };
    child.on("error", () => done(2));
    child.on("close", (code, signal) => done(signal ? 0 : (code ?? 2)));
  });
}
