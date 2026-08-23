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
import { railSections, type RailInput, type RailSection } from "./railSections";

function input(over: Partial<RailInput> = {}): RailInput {
  return {
    hasRequirements: true,
    hasDesign: true,
    hasValidation: true,
    agentWorking: false,
    designOutdated: false,
    assumptions: 0,
    openQuestions: 0,
    ...over,
  };
}

const of = (sections: RailSection[], id: RailSection["id"]) =>
  sections.find((s) => s.id === id)!;

describe("railSections — the rail is the flow", () => {
  it("reads in journey order", () => {
    expect(railSections(input()).map((s) => s.id)).toEqual([
      "requirements",
      "design",
      "validation",
    ]);
  });

  // "Design", not "Designs" — one design, written across several documents.
  it("names the design section in the singular", () => {
    expect(of(railSections(input()), "design").title).toBe("Design");
  });

  it("a settled project is ready throughout", () => {
    for (const s of railSections(input())) {
      expect(s.state).toBe("ready");
      expect(s.reasons).toEqual([]);
    }
  });

  it("an empty section with nobody working has not started", () => {
    const sections = railSections(
      input({ hasRequirements: false, hasDesign: false, hasValidation: false }),
    );
    for (const s of sections) expect(s.state).toBe("not-started");
  });

  it("an empty section with an agent working is active", () => {
    const sections = railSections(
      input({ hasRequirements: false, hasDesign: false, hasValidation: false, agentWorking: true }),
    );
    for (const s of sections) expect(s.state).toBe("active");
  });

  // A turn is known project-wide, never per document. While every section
  // holds something there is no honest way to say which is being worked on,
  // and a pulse on the wrong section is worse than a still rail.
  it("claims nothing active once every section holds something", () => {
    const sections = railSections(input({ agentWorking: true }));
    for (const s of sections) expect(s.state).not.toBe("active");
  });

  describe("the requirements have moved since the design", () => {
    const sections = railSections(input({ designOutdated: true }));

    // The acceptance criteria are written against the same stories, and one
    // re-derivation rewrites both — so they go stale together.
    it("marks design AND validation, not requirements", () => {
      expect(of(sections, "design").state).toBe("attention");
      expect(of(sections, "validation").state).toBe("attention");
      expect(of(sections, "requirements").state).toBe("ready");
    });

    it("gives each one row pointing at the same repair", () => {
      for (const id of ["design", "validation"] as const) {
        expect(of(sections, id).reasons).toEqual([
          {
            key: "requirements-moved",
            label: "The requirements have changed since",
            action: "update-design",
          },
        ]);
      }
    });

    // The agent is already resolving it; warning about the thing being fixed
    // while it is being fixed reads as a fault.
    it("yields to an agent that is working", () => {
      const working = railSections(
        input({ designOutdated: true, hasDesign: false, agentWorking: true }),
      );
      expect(of(working, "design").state).toBe("active");
    });
  });

  describe("the requirements' own reasons", () => {
    // Two different things: a judgment the agent made and you may overturn,
    // versus a hole only you can fill. Counted apart because the user does
    // different work on each.
    it("counts assumptions and open questions separately", () => {
      const sections = railSections(input({ assumptions: 3, openQuestions: 2 }));
      expect(of(sections, "requirements").state).toBe("attention");
      expect(of(sections, "requirements").reasons.map((r) => r.label)).toEqual([
        "3 assumptions to challenge",
        "2 open questions",
      ]);
    });

    it("says one thing once", () => {
      const sections = railSections(input({ assumptions: 1, openQuestions: 1 }));
      expect(of(sections, "requirements").reasons.map((r) => r.label)).toEqual([
        "1 assumption to challenge",
        "1 open question",
      ]);
    });

    // The controls that settle them already live on the flagged lines; the rail
    // says there is something, the document is where it is done.
    it("points them at the document", () => {
      const sections = railSections(input({ assumptions: 1, openQuestions: 1 }));
      for (const r of of(sections, "requirements").reasons) {
        expect(r.action).toBe("document");
      }
    });

    // Designing against assumptions is deliberate — the requirements arrive
    // early, full of them, and are refined in place. The rail reports; it does
    // not gate.
    it("does not touch the design section", () => {
      const sections = railSections(input({ assumptions: 5, openQuestions: 5 }));
      expect(of(sections, "design").state).toBe("ready");
      expect(of(sections, "design").reasons).toEqual([]);
    });

    // Nothing to have assumptions about yet.
    it("stays quiet before the requirements exist", () => {
      const sections = railSections(input({ hasRequirements: false, assumptions: 4 }));
      expect(of(sections, "requirements").reasons).toEqual([]);
    });
  });
});
