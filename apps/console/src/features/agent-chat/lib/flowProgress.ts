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

// Flow progress derivation (#372): the agent's current flow always shows its
// progress at the top of the chat panel — the interview stepper during the
// kickoff, the design-steps checklist during design turns. Both are DERIVED
// (from the spec file list and the question headings seen this conversation),
// never agent-reported, so they can neither lag nor lie.

export type StepState = "done" | "current" | "todo";

export interface FlowStep {
  label: string;
  state: StepState;
}

/** The PRD-section coverage walk, in the start skill's order. */
export const INTERVIEW_SECTIONS = [
  "Problem",
  "Actors",
  "Journey & stories",
  "Product decisions",
  "Phasing",
  "Out of scope",
] as const;

/**
 * Derive the interview stepper from the question headings seen so far this
 * conversation. A heading that names a section (the start skill titles each
 * form with its section) marks that section CURRENT and every earlier section
 * done — the walk is ordered, so the furthest section reached carries the
 * position.
 */
export function interviewSteps(questionHeadings: string[]): FlowStep[] {
  let reached = -1;
  for (const heading of questionHeadings) {
    const h = heading.toLowerCase();
    INTERVIEW_SECTIONS.forEach((section, i) => {
      const key = section.toLowerCase().split(" ")[0] ?? "";
      if (key !== "" && h.includes(key) && i > reached) reached = i;
    });
  }
  return INTERVIEW_SECTIONS.map((label, i) => ({
    label,
    state: i < reached ? "done" : i === reached ? "current" : "todo",
  }));
}

/**
 * Derive the design-steps checklist (the enforced emission order) from the
 * spec file paths present. "scaffold (platform)" is folded into the
 * components step — the platform lands skeletons with the cell, so their
 * presence is what the step reports.
 */
export function designSteps(paths: string[]): FlowStep[] {
  const has = (p: string) => paths.includes(p);
  const hasComponentFile = (suffix: string) =>
    paths.some((p) => /^specs\/design\/components\/[^/]+\//.test(p) && p.endsWith(suffix));

  const doneFlags = [
    has("specs/design/design.cell"),
    hasComponentFile("design.json"),
    has("specs/design/design.md") || has("specs/design/security.md"),
    hasComponentFile("openapi.yaml") || hasComponentFile("wireframes.dsl"),
    has("specs/validation/validation-criteria.json"),
  ];
  const labels = [
    "design.cell",
    "components (scaffold + enrich)",
    "design.md · security.md",
    "openapi · wireframes",
    "validation criteria",
  ];
  const firstTodo = doneFlags.indexOf(false);
  return labels.map((label, i) => ({
    label,
    state: doneFlags[i] ? "done" : i === firstTodo ? "current" : "todo",
  }));
}

/**
 * Which flow (if any) the progress header shows: the interview while the
 * project has no PRD yet, the design checklist once design work has started.
 * Nothing renders for plain chat on a settled spec.
 */
export function activeFlow(paths: string[], turnActive: boolean): "interview" | "design" | null {
  if (!turnActive) return null;
  if (!paths.includes("specs/requirements/prd.md")) return "interview";
  if (paths.some((p) => p.startsWith("specs/design/"))) return "design";
  return null;
}
