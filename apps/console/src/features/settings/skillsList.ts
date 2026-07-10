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

import { kindLabel, normalizeKind } from "./skillKind";

// Structural subset of the generated SkillSummary — keeps this module a pure
// list pipeline, testable without the generated client types.
interface SkillLike {
  name: string;
  kind: string;
  description?: string;
}

export interface SkillsPage<T extends SkillLike> {
  rows: T[];
  /** The page actually shown — the requested page clamped to [1, pageCount]. */
  page: number;
  pageCount: number;
  /** Matching skills across all pages. */
  total: number;
}

// Filter → sort → clamp → slice, in one pure derivation (issue #172): the
// catalogue is fully loaded (tens of skills), so paging is client-side like
// the #96 filter. Clamping here — rather than resetting page state in an
// effect — is what keeps a shrinking list (delete, sync) on the nearest
// still-valid page.
export function paginateSkills<T extends SkillLike>(
  skills: T[],
  query: string,
  requestedPage: number,
  pageSize: number,
): SkillsPage<T> {
  const q = query.trim().toLowerCase();
  // Match the displayed kind label as well as the raw value — the chip reads
  // "Organization", so that is what people will type.
  const matches = (skill: T) =>
    !q ||
    [
      skill.name,
      skill.description,
      skill.kind,
      kindLabel(normalizeKind(skill.kind)),
    ].some((field) => (field ?? "").toLowerCase().includes(q));

  const filtered = skills
    .filter(matches)
    .sort((a, b) => a.name.localeCompare(b.name));

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(requestedPage, 1), pageCount);

  return {
    rows: filtered.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageCount,
    total: filtered.length,
  };
}
