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

// A dependency's definition file, as the pane renders it. The pane reads the
// FILE (live doc ahead of the commit, or the committed copy), the way the
// component view reads design.json — so the definition view is a renderer for
// a path, not a page over the read model. What the file cannot know (status,
// reason, flags, who uses it) the read model supplies on top.

import { dependencyDesignSchema } from "@aep/agent-stream";

/** The file's shape as the write-gate's schema reads it (optional fields absent, never undefined). */
export type DependencyDefinition = ReturnType<typeof dependencyDesignSchema.parse>;

export type ParsedDependencyDefinition =
  | { ok: true; definition: DependencyDefinition }
  | { ok: false; message: string };

/** Parse a dependency.json; the message names what is wrong with it. */
export function parseDependencyDefinition(text: string): ParsedDependencyDefinition {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "not valid JSON" };
  }
  const result = dependencyDesignSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return { ok: false, message: `${where}${issue?.message ?? "does not match the definition schema"}` };
  }
  return { ok: true, definition: result.data };
}
