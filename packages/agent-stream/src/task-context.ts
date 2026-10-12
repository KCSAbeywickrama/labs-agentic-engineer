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
 * The read-only plan-turn context, parsed from the turn's `files` snapshot: the
 * one definition of a known component, which the design agent's accumulator
 * validates a build plan against. Pure, no I/O.
 */

/** Matches any file under a design component dir, capturing the component name. */
const COMPONENT_DIR_RE = /^specs\/design\/components\/([^/]+)\//;

/**
 * The known components: the directory names under `specs/design/components/`
 * present in the snapshot, sorted and de-duplicated.
 */
export function parseKnownComponents(files: Record<string, string>): string[] {
  const names = new Set<string>();
  for (const path of Object.keys(files)) {
    const m = COMPONENT_DIR_RE.exec(path);
    if (m) names.add(m[1]!);
  }
  return [...names].sort();
}
