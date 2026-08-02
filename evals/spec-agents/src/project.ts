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

/** Throwaway eval project directories under the sanctioned gitignored home. */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES_DIR, PROJECTS_HOME } from "./config.js";

/**
 * Fresh project dir for one run; `fixture` (a dir name under
 * scenarios/fixtures/) seeds its starting `specs/` state — the section-alone
 * input decided in #356 (captured-then-curated).
 */
export function prepareProject(name: string, fixture?: string): string {
  const dir = join(PROJECTS_HOME, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  if (fixture) {
    const src = join(FIXTURES_DIR, fixture);
    if (!existsSync(src)) throw new Error(`fixture not found: ${src}`);
    cpSync(src, dir, { recursive: true });
  }
  return dir;
}

/** Read a project file, "" when absent (structural checks handle emptiness). */
export function readProjectFile(projectDir: string, rel: string): string {
  const abs = join(projectDir, rel);
  return existsSync(abs) ? readFileSync(abs, "utf8") : "";
}
