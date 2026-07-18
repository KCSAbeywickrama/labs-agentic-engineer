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

/** Project directory picker: recent projects + "open directory…" (§7). */

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import * as clack from "@clack/prompts";
import { listRecentProjects } from "../state/project.js";

const OPEN = "\0open";
const QUIT = "\0quit";

/** Pick a project dir, or null to exit. First run confirms the exact directory (§12). */
export async function pickProject(): Promise<string | null> {
  const recents = listRecentProjects();
  if (recents.length > 0) {
    const choice = await clack.select({
      message: "Pick a project",
      options: [
        ...recents.map((p) => ({ value: p, label: p })),
        { value: OPEN, label: "＋ Open directory…" },
        { value: QUIT, label: "Quit" },
      ],
    });
    if (clack.isCancel(choice) || choice === QUIT) return null;
    if (choice !== OPEN) return choice;
  }

  const dir = await clack.text({
    message: "Project directory",
    placeholder: "~/work/todo-app",
    validate: (v) => {
      const p = expand((v ?? "").trim());
      if (p === "") return "enter a path";
      if (!existsSync(p) || !statSync(p).isDirectory()) return "not an existing directory";
      return undefined;
    },
  });
  if (clack.isCancel(dir)) return null;
  const path = expand(dir.trim());

  const confirmed = await clack.confirm({
    message: `The agents will read and WRITE inside ${path}. Continue?`,
  });
  if (clack.isCancel(confirmed) || !confirmed) return null;
  return path;
}

function expand(p: string): string {
  const home = process.env.HOME ?? "";
  // Relative paths resolve against where the user ran `pnpm play` (INIT_CWD),
  // not the playground package dir pnpm set as cwd.
  const base = process.env.INIT_CWD ?? process.cwd();
  return resolve(base, p.startsWith("~/") && home ? home + p.slice(1) : p);
}
