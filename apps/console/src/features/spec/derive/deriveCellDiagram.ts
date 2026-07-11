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

import { toCellDsl } from "@aep/design-projection";

/**
 * Whole-architecture cell DSL, derived DIRECTLY from the component design.json
 * bundle. `designJsonByRepoPath` maps repo-relative
 * `specs/design/components/<c>/design.json` paths to their content (the
 * converter's regex requires the `specs/` prefix — mapping.ts's
 * SpecFileEntry.path already carries it). `projectName` becomes the diagram
 * title. Returns null when there are no valid components — a bad source never
 * throws into the render tree.
 *
 * This replaces the old `buildProjectDesign → toCellDiagramProject → wso2ToDsl`
 * path, which flattened dependency kind/resourceType and so placed nodes on the
 * wrong cell boundary. `toCellDsl` applies the same boundary rules the agent's
 * streamed design.cell uses, so the reloaded (derived) diagram matches it.
 */
export function deriveCellDsl(
  projectName: string,
  designJsonByRepoPath: Record<string, string>,
): string | null {
  try {
    return toCellDsl(projectName, designJsonByRepoPath);
  } catch {
    return null;
  }
}
