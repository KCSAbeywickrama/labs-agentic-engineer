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
 * The prototype half of a design's checks: which components owe a prototype,
 * and whether each passes the kit's own check.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPrototype, resolveTheme } from "@wso2/prototype-kit/check";

/**
 * The theme the design agent's prototype gate draws with: the organization's
 * UI design system (`skills/organization`, Oxygen). Resolved on the first
 * prototype check, so a run with no web application never needs its runtimes.
 */
let oxygenTheme: ReturnType<typeof resolveTheme> | undefined;
const prototypeTheme = (): ReturnType<typeof resolveTheme> =>
  (oxygenTheme ??= resolveTheme("@wso2/prototype-theme-oxygen", [dirname(fileURLToPath(import.meta.url))]));

/** The components whose design.json says `web-application`: each owes a prototype. */
export function webApplications(projectDir: string, components: string[]): string[] {
  return components.filter((name) => {
    const abs = join(projectDir, `specs/design/components/${name}/design.json`);
    const raw = existsSync(abs) ? readFileSync(abs, "utf8") : "";
    try {
      return (JSON.parse(raw) as { type?: unknown }).type === "web-application";
    } catch {
      return false;
    }
  });
}

/**
 * Every web application's prototype, through the kit's whole check — the
 * files, the manifest, the source's rules and types, and the render of every
 * screen × role × state — the check the design agent's write gate runs. A
 * prototype the gate refused never lands, so a problem here is a missing one,
 * or one a later edit broke.
 */
export async function prototypeProblems(projectDir: string, webApps: string[]): Promise<string[]> {
  const problems: string[] = [];
  for (const name of webApps) {
    const dir = join(projectDir, "specs/design/components", name);
    const findings = await checkPrototype(dir, { theme: prototypeTheme() });
    if (findings.length > 0) {
      problems.push(`${name}: ${findings.slice(0, 3).map((f) => `${f.code} ${f.message}`).join(" | ")}`);
    }
  }
  return problems;
}
