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
 * Wireframes `.dsl` layout write-gate. The Excalidraw compiler renders every
 * coordinate verbatim (no auto-layout), so a mis-placed element ships as a
 * broken drawing: boxes off the frame edge, under the navbar/sidebar chrome,
 * or half-covering each other. Guidance alone proved unreliable — the model
 * occasionally slips on the arithmetic — so, like the design.json schema gate,
 * an invalid layout aborts the write with a self-correctable error and the
 * bundle stays byte-for-byte unchanged. Syntax stays ungated (a partial or
 * unparseable body is the compile path's concern, and the streaming preview
 * needs unparseable prefixes to pass through).
 */

import { validateWireframeLayout } from "@aep/excalidraw-dsl";

export interface WireframeLayoutProblem {
  code: "LAYOUT_VIOLATION";
  message: string;
}

/** Cap the echoed issues so one bad screen doesn't flood the tool result. */
const MAX_ISSUES = 8;

/** `erd`/`domain` basenames are the domain-model DSL — a different grammar. */
function isWireframesDslPath(path: string): boolean {
  if (!path.endsWith(".dsl")) return false;
  const base = (path.split("/").at(-1) ?? "").toLowerCase();
  return !(base.startsWith("erd") || base.startsWith("domain"));
}

/**
 * Validate a candidate wireframes `.dsl` body for `path`. Returns null when
 * the path is not a wireframes DSL or the layout is clean; otherwise the
 * problem, phrased for the model's self-correction.
 */
export function checkWireframeLayout(
  path: string,
  content: string,
): WireframeLayoutProblem | null {
  if (!isWireframesDslPath(path)) return null;
  const issues = validateWireframeLayout(content);
  if (issues.length === 0) return null;
  const shown = issues.slice(0, MAX_ISSUES);
  const more = issues.length - shown.length;
  return {
    code: "LAYOUT_VIOLATION",
    message:
      `${path} has ${issues.length} layout problem${issues.length === 1 ? "" : "s"} — the compiler draws coordinates verbatim, so these would render broken. The file is unchanged:\n` +
      shown.map((s) => `- ${s}`).join("\n") +
      (more > 0 ? `\n(+${more} more)` : "") +
      `\nRe-emit the WHOLE corrected file in ONE retry: fix every problem listed above, then re-check EVERY element near the right/bottom edges (x+width and y+height inside the frame) and every row of side-by-side elements (each starts past the previous one's x+width) — not just the flagged ones, so the retry passes in one shot.`,
  };
}
