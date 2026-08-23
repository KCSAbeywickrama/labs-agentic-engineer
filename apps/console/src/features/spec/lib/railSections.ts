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

// The rail IS the flow (#575).
//
// The spec workspace's left column is the one surface a user reads through the
// whole journey, and it used to be a file browser: three dead headings over a
// list of filenames, saying nothing about which part of the work was happening,
// finished, or still to come. This decides what each section says.
//
// Pure — no React, no queries — so the rules are testable without a workspace.

/** What a section is doing, in the order a reader meets them. */
export type SectionState = "not-started" | "active" | "attention" | "ready";

/**
 * Why a section wants attention, and where the user goes to deal with it.
 *
 * Reasons are ROWS in the rail rather than a tooltip on the header, for three
 * reasons: a section can want attention for several unrelated things at once
 * (requirements can hold assumptions AND open questions AND have drifted from
 * the design); each needs a DIFFERENT action, so a single summary would hide
 * which; and this ticket explicitly retires a gate tooltip on the grounds that
 * the rail should show such things "larger and better" — hiding actionable work
 * behind a hover is the same mistake in a new place.
 */
export interface SectionReason {
  /** Stable across renders — the rail keys rows on it. */
  key: string;
  label: string;
  /** `document` opens the requirements document, where the settle controls
   *  already live on the flagged lines; `update-design` re-derives. */
  action: "document" | "update-design";
}

export interface RailSection {
  id: "requirements" | "design" | "validation";
  title: string;
  state: SectionState;
  reasons: SectionReason[];
}

export interface RailInput {
  /** Does this section hold anything yet. */
  hasRequirements: boolean;
  hasDesign: boolean;
  hasValidation: boolean;
  /** An agent turn is running somewhere on this project. */
  agentWorking: boolean;
  /** The requirements moved since the design was last derived from them. */
  designOutdated: boolean;
  /** Judgments the agent made that the user may want to challenge. */
  assumptions: number;
  /** Gaps only the user can fill. */
  openQuestions: number;
}

const REQUIREMENTS_MOVED = "The requirements have changed since";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The requirements' own reasons.
 *
 * Assumptions and open questions are DIFFERENT things and are counted
 * separately: an assumption is a judgment the agent made and you may want to
 * overturn, an open question is a hole only you can fill. Both point at the
 * document, because that is where the controls that settle them already live —
 * the rail says there is something, and the document is where it is done.
 *
 * Neither GATES anything. Designing against assumptions is a deliberate part of
 * this product — the requirements arrive early, full of them, and are refined
 * in place — so the rail reports them and Design stays clickable throughout.
 */
function requirementsReasons(input: RailInput): SectionReason[] {
  const reasons: SectionReason[] = [];
  if (input.assumptions > 0) {
    reasons.push({
      key: "assumptions",
      label: `${plural(input.assumptions, "assumption", "assumptions")} to challenge`,
      action: "document",
    });
  }
  if (input.openQuestions > 0) {
    reasons.push({
      key: "open-questions",
      label: plural(input.openQuestions, "open question", "open questions"),
      action: "document",
    });
  }
  return reasons;
}

/**
 * The three sections, in journey order, each carrying its state and reasons.
 *
 * ACTIVE is claimed for at most ONE section — the earliest that has nothing in
 * it — and only while an agent is working. Once every section holds something
 * nothing pulses: a turn is known project-wide, never per document, so there is
 * no honest way to say which one is being worked on, and a pulse on the wrong
 * section is worse than a still rail. The per-document work that makes this
 * precise waits on agents declaring their plan before they write.
 *
 * ATTENTION never outranks ACTIVE: an agent working on a stale design is
 * already resolving it, and a warning about the thing being fixed while it is
 * being fixed reads as a fault.
 */
export function railSections(input: RailInput): RailSection[] {
  const outdatedReason: SectionReason[] = input.designOutdated
    ? [{ key: "requirements-moved", label: REQUIREMENTS_MOVED, action: "update-design" }]
    : [];

  const requirements = requirementsReasons(input);
  const has: Record<RailSection["id"], boolean> = {
    requirements: input.hasRequirements,
    design: input.hasDesign,
    validation: input.hasValidation,
  };

  // At most ONE section pulses, and only the earliest empty one.
  //
  // A turn is known project-wide — an agent is working — never per document.
  // Pulsing every empty section on that basis lit all three during the kickoff,
  // claiming the agent was writing a design and acceptance criteria while it
  // was still interviewing about requirements. The sections are ordered because
  // the work is: nothing downstream begins until what it derives from exists,
  // so the earliest empty one is the only honest candidate.
  const activeID = input.agentWorking
    ? (["requirements", "design", "validation"] as const).find((id) => !has[id])
    : undefined;

  const section = (
    id: RailSection["id"],
    title: string,
    reasons: SectionReason[],
  ): RailSection => ({
    id,
    title,
    // Nothing here yet reads as NOT STARTED unless this is the section being
    // worked on. Downstream sections stay dim through the whole of the
    // requirements interview, which is what they are: not begun, and not
    // beginnable until the thing they derive from exists.
    state: !has[id]
      ? id === activeID
        ? "active"
        : "not-started"
      : reasons.length > 0
        ? "attention"
        : "ready",
    reasons: has[id] ? reasons : [],
  });

  return [
    section("requirements", "Requirements", requirements),
    // "Design", not "Designs" — one design, written across several documents.
    section("design", "Design", outdatedReason),
    // The acceptance criteria are written against the same stories the design
    // is, and the same re-derivation rewrites both — so they go stale together
    // and clear together. Flagging only the design would quietly assert that
    // criteria written against a story you have since rewritten are still fine.
    section("validation", "Validation", outdatedReason),
  ];
}
