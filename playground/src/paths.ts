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
 * ONE place project paths are resolved and fenced — the picker and the CLI
 * both use it, so the rules can't drift:
 *
 *  - Relative paths resolve against where the user launched `pnpm play`
 *    (pnpm's INIT_CWD) — pnpm sets the process cwd to the package dir.
 *  - The default project home is `<invocation dir>/playground/projects/`
 *    (gitignored; excluded from repo lint + license gates), so from the repo
 *    root the default lands under the playground dir as expected.
 *  - Anywhere else inside the repo checkout is refused: the agents would
 *    write specs/undo copies/generated app source into the monorepo.
 */

import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The repo checkout (playground/src → up 2). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The gitignored subtree where playground projects may live inside the repo. */
export const PROJECTS_HOME = join(REPO_ROOT, "playground", "projects");

/** Where the user actually ran `pnpm play` (pnpm rewrites the process cwd). */
export function invocationDir(): string {
  return process.env.INIT_CWD ?? process.cwd();
}

/** The suggested default shown in the picker: `<invocation>/playground/projects/my-app`. */
export function defaultProjectDir(): string {
  return join(invocationDir(), "playground", "projects", "my-app");
}

/** Expand `~/` and resolve relative paths against the invocation dir. */
export function expandProjectPath(p: string): string {
  const home = process.env.HOME ?? homedir();
  return resolve(invocationDir(), p.startsWith("~/") && home ? home + p.slice(1) : p);
}

const within = (root: string, p: string): boolean => p === root || p.startsWith(root + sep);

/**
 * The project-dir fence: returns an error message when `p` (absolute) is an
 * illegal project location, or null when it's fine. Inside the repo checkout
 * only the gitignored `playground/projects/` subtree is allowed.
 */
export function projectDirError(p: string): string | null {
  if (within(REPO_ROOT, p) && !(within(PROJECTS_HOME, p) && p !== PROJECTS_HOME)) {
    return `refusing to use ${p} — inside the AEP repo checkout. Use ${PROJECTS_HOME}/<name> or any directory outside the repository.`;
  }
  return null;
}
