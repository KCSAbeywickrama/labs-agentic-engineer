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

import type { components } from "../../../generated/aep-api";

type FileMeta = components["schemas"]["FileMeta"];

// Paths are the FULL repo-relative path verbatim (`specs/requirements/prd.md`)
// — the same scheme the Files API serves, the collab doc keys, and the agents'
// live-peer writes use. This module only classifies each file into a spec-view
// section; it no longer translates between two path schemes (the stripped
// room-key scheme of #113 decision 2 is retired — it double-prefixed
// agent-created files).

export type SpecGroup = "requirements" | "designs" | "validation";

export interface SpecFileEntry {
  /** Full repo-relative path (e.g. specs/requirements/prd.md) — also the
   *  collab doc key and the Files API read path. */
  path: string;
  /** Git blob sha at HEAD; changes when content changes. */
  sha: string;
  group: SpecGroup;
}

// Spec-view section per folder directly under specs/. Files outside these
// folders are hidden from the view (#113 decision 3).
const GROUP_BY_FOLDER: Record<string, SpecGroup> = {
  requirements: "requirements",
  design: "designs",
  validation: "validation",
};

export function toSpecEntry(meta: FileMeta): SpecFileEntry | null {
  // specs/<folder>/<…file>: needs the prefix, a known folder, and a file name
  // beyond it (segments.length >= 3).
  const segments = meta.path.split("/");
  if (segments[0] !== "specs" || segments.length < 3) return null;
  const group = GROUP_BY_FOLDER[segments[1] ?? ""];
  if (!group) return null;
  return { path: meta.path, sha: meta.sha, group };
}

export function toSpecEntries(metas: FileMeta[]): SpecFileEntry[] {
  return metas
    .map(toSpecEntry)
    .filter((e): e is SpecFileEntry => e !== null);
}
