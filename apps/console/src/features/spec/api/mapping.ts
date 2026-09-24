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

/**
 * The PRD. Named here because more than one surface has to recognise it: the
 * file list pins it to the top of its group, and the editor carries the code
 * lenses for this path alone.
 */
export const PRD_PATH = "specs/requirements/prd.md";

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
  // `validation` is absent on purpose: the section is served by ONE subfolder
  // of it, admitted by ACCEPTANCE_PREFIX below. See that constant for why the
  // parent stays shut.
};

/**
 * One acceptance-criteria document,
 * `specs/validation/acceptance/<capability>.feature`.
 *
 * The single definition, because three places were carrying the same regex —
 * the pane's read-only routing, the Validations page's oracle read, and the
 * rail. A fourth copy is how one of them comes to disagree with the others
 * about what an acceptance file is.
 *
 * Narrower than ACCEPTANCE_PREFIX, and deliberately: the prefix decides which
 * SECTION a path belongs to, this decides which files the one rail entry stands
 * for. Anything else in that folder keeps its own row instead of disappearing.
 */
export function isAcceptanceCriteriaFile(path: string): boolean {
  return /^specs\/validation\/acceptance\/[^/]+\.feature$/.test(path);
}

// Reference documents (#383) are transient turn inputs, never committed
// (ADR-0017), so nothing under here should ever reach the spec view. The guard
// stays anyway: projects created under the feature's v1 DID commit them, and
// without it those paths fall through to the `requirements` group, become
// selectable, and pour a PDF's bytes into the editor pane — the exact incident
// #427 was opened to fix.
const REFERENCES_PREFIX = "specs/requirements/references/";

// The acceptance oracle's folder, admitted by prefix because its PARENT stays
// shut. `specs/validation/` also holds the build's own evaluation inputs —
// generated JSON with no viewer, which the rail would offer as an editable
// textarea over a document nobody hand-writes. Opening one subfolder admits the
// oracle and leaves whatever else the phase keeps there hidden until someone
// decides it is a document a reader should open. Both stay readable on GitHub,
// which is where they belong.
const ACCEPTANCE_PREFIX = "specs/validation/acceptance/";

/**
 * The spec-view group a path would belong to, or null for a path the view
 * hides. The declared plan (#576) sorts its entries into rail sections with
 * this — ONE definition of the folder rule, shared with `toSpecEntry` below,
 * so a planned path and the file it becomes can never land in different
 * sections.
 *
 * specs/<folder>/<…file>: needs the prefix, a known folder, and a file name
 * beyond it (segments.length >= 3). A trailing slash means the path names a
 * DIRECTORY, not a file: it clears the length check (the empty last segment
 * counts) and would otherwise become a selectable entry with no file name.
 * Checked before the path branches below, so it holds for every group — which
 * is also why `specs/validation/acceptance/` names no group on its own.
 *
 * Most groups are decided by the folder directly under specs/. Two are decided
 * by a deeper path instead, one denying and one admitting, and both are checked
 * first because a folder rule cannot express either.
 */
export function specGroupOf(path: string): SpecGroup | null {
  const segments = path.split("/");
  if (segments[0] !== "specs" || segments.length < 3) return null;
  if (segments[segments.length - 1] === "") return null;
  if (path.startsWith(REFERENCES_PREFIX)) return null;
  if (path.startsWith(ACCEPTANCE_PREFIX)) return "validation";
  return GROUP_BY_FOLDER[segments[1] ?? ""] ?? null;
}

export function toSpecEntry(meta: FileMeta): SpecFileEntry | null {
  const group = specGroupOf(meta.path);
  if (!group) return null;
  return { path: meta.path, sha: meta.sha, group };
}

export function toSpecEntries(metas: FileMeta[]): SpecFileEntry[] {
  return metas
    .map(toSpecEntry)
    .filter((e): e is SpecFileEntry => e !== null);
}
