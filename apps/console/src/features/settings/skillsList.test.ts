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

import { describe, expect, it } from "vitest";
import { paginateSkills } from "./skillsList";

const skill = (name: string, kind = "org", description = "") => ({
  name,
  kind,
  description,
});

const catalogue = [
  skill("react-webapp", "org", "How to build a React SPA on the platform."),
  skill("go", "org", "How to build a Go service on the platform."),
  skill("task-breakdown", "platform", "Breaks a design into buildable tasks."),
  skill("acme-deploy-checklist", "org", "Acme's internal checklist."),
  skill("find-skills", "imported", "Discover community AgentSkills."),
];

describe("paginateSkills", () => {
  it("sorts alphabetically by name across kinds", () => {
    const { rows } = paginateSkills(catalogue, "", 1, 10);
    expect(rows.map((s) => s.name)).toEqual([
      "acme-deploy-checklist",
      "find-skills",
      "go",
      "react-webapp",
      "task-breakdown",
    ]);
  });

  it("slices the requested page and reports the page count", () => {
    const many = Array.from({ length: 23 }, (_, i) =>
      skill(`skill-${String(i).padStart(2, "0")}`),
    );
    const page1 = paginateSkills(many, "", 1, 10);
    expect(page1.rows).toHaveLength(10);
    expect(page1.pageCount).toBe(3);
    expect(page1.total).toBe(23);

    const page3 = paginateSkills(many, "", 3, 10);
    expect(page3.rows).toHaveLength(3);
    expect(page3.rows[0]?.name).toBe("skill-20");
  });

  it("filters by name, description, raw kind, and displayed kind label", () => {
    expect(
      paginateSkills(catalogue, "go", 1, 10).rows.map((s) => s.name),
    ).toEqual(["go"]);
    expect(
      paginateSkills(catalogue, "community", 1, 10).rows.map((s) => s.name),
    ).toEqual(["find-skills"]);
    expect(
      paginateSkills(catalogue, "imported", 1, 10).rows.map((s) => s.name),
    ).toEqual(["find-skills"]);
    // The chip reads "Built-in" — that is what people will type. All three
    // "org" rows match (custom folds into org, so acme is one of them too).
    expect(
      paginateSkills(catalogue, "built-in", 1, 10).rows.map((s) => s.name),
    ).toEqual(["acme-deploy-checklist", "go", "react-webapp"]);
  });

  it("treats a blank or whitespace query as no filter", () => {
    expect(paginateSkills(catalogue, "   ", 1, 10).total).toBe(5);
  });

  it("clamps an out-of-range page to the nearest valid page", () => {
    const many = Array.from({ length: 23 }, (_, i) => skill(`skill-${i}`));
    // Page 4 no longer exists after the list shrank to 3 pages.
    const clamped = paginateSkills(many, "", 4, 10);
    expect(clamped.page).toBe(3);
    expect(clamped.rows).toHaveLength(3);
    // Below 1 clamps up.
    expect(paginateSkills(many, "", 0, 10).page).toBe(1);
  });

  it("returns one empty page for an empty or fully-filtered list", () => {
    const empty = paginateSkills([], "", 1, 10);
    expect(empty.rows).toEqual([]);
    expect(empty.pageCount).toBe(1);
    expect(empty.page).toBe(1);

    const noMatch = paginateSkills(catalogue, "zzz-no-such", 5, 10);
    expect(noMatch.rows).toEqual([]);
    expect(noMatch.pageCount).toBe(1);
    expect(noMatch.page).toBe(1);
    expect(noMatch.total).toBe(0);
  });
});
