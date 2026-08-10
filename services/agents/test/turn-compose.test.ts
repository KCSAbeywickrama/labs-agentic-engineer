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
 * `composeInstruction` — a TurnSpec becomes prompt text HERE and nowhere else.
 * The assertions pin the properties a caller depends on (what leads, what is
 * appended to which kind, what a blank optional field does), not every byte of
 * wording: the text is meant to be edited, the structure is not.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { composeInstruction, eagerSkillsFor, toolsetFor } from "../src/prompts/turn.js";

test("chat rides verbatim, with the spec-paths rule appended", () => {
  const out = composeInstruction({ kind: "chat", text: "add a returns policy" });
  assert.ok(out.startsWith("add a returns policy"), "the user's words lead");
  assert.match(out, /Spec sources live under specs\//);
});

test("flow points at the skill, with the user's trailing text after a blank line", () => {
  assert.ok(
    composeInstruction({ kind: "flow", skill: "design" }).startsWith("Load the design skill and follow it."),
  );
  const withText = composeInstruction({ kind: "flow", skill: "amend", text: "add an actor" });
  assert.ok(withText.startsWith("Load the amend skill and follow it.\n\nadd an actor"));
  // Whitespace-only trailing text is not text.
  assert.ok(
    composeInstruction({ kind: "flow", skill: "amend", text: "   " }).startsWith(
      "Load the amend skill and follow it.\n\nSpec sources",
    ),
  );
});

test("start appends the captured idea, and appends NOTHING when there is none", () => {
  const withIdea = composeInstruction({ kind: "start", idea: "an expense tracker" });
  assert.match(withIdea, /^Load the start skill and follow it\.\n\nThe user's idea for this project:\n\nan expense tracker/);
  // A bare kickoff must be byte-identical to a skill load — the start skill
  // then asks the user for the idea instead of inventing one.
  const bare = composeInstruction({ kind: "start" });
  assert.equal(bare, composeInstruction({ kind: "start", idea: "  " }));
  assert.doesNotMatch(bare, /The user's idea/);
});

test("start lists the reference documents, and lists NOTHING when there are none", () => {
  const withRefs = composeInstruction({
    kind: "start",
    idea: "an expense tracker",
    references: ["specs/requirements/references/rfp.pdf", "specs/requirements/references/glossary.md"],
  });
  // Every path is named, and the agent is told to read them as the brief.
  assert.match(withRefs, /specs\/requirements\/references\/rfp\.pdf/);
  assert.match(withRefs, /specs\/requirements\/references\/glossary\.md/);
  assert.match(withRefs, /reference document/i);
  // The idea still rides alongside them — the two channels are independent.
  assert.match(withRefs, /The user's idea for this project:\n\nan expense tracker/);

  // Absent and empty are the same thing, and both are byte-identical to a turn
  // from before this channel existed — a docless project sees no change at all.
  const bare = composeInstruction({ kind: "start", idea: "an expense tracker" });
  assert.equal(bare, composeInstruction({ kind: "start", idea: "an expense tracker", references: [] }));
  assert.doesNotMatch(bare, /reference document/i);
});

test("target is rendered by the service, never formatted by the caller", () => {
  const out = composeInstruction({ kind: "chat", text: "tighten the spec" }, { target: "specs/requirements/prd.md" });
  assert.ok(out.endsWith("(target: specs/requirements/prd.md)"));
  // Absent or blank → no suffix at all.
  assert.doesNotMatch(composeInstruction({ kind: "chat", text: "x" }, { target: "  " }), /\(target:/);
});

test("a failed previous turn leads the instruction (D20)", () => {
  const out = composeInstruction({ kind: "chat", text: "carry on" }, { previousTurnFailed: true });
  assert.ok(out.startsWith("Note: your previous turn's changes were NOT applied;"));
  assert.match(out, /carry on/);
  assert.doesNotMatch(composeInstruction({ kind: "chat", text: "carry on" }), /NOT applied/);
});

test("headless forbids the question tools, and trails everything else", () => {
  const out = composeInstruction({ kind: "start", idea: "a shop" }, { target: "specs/requirements/prd.md", headless: true });
  assert.match(out, /do not call ask_question or ask_questions/);
  assert.ok(out.indexOf("(target:") < out.indexOf("No interview is possible"), "modifiers trail the body");
});

test("plan carries no spec-paths rule and no target — it writes no spec files", () => {
  const out = composeInstruction({ kind: "plan" }, { target: "specs/requirements/prd.md" });
  assert.ok(out.startsWith("Plan the implementation Tasks for this project."));
  assert.doesNotMatch(out, /Spec sources live under specs\//);
  assert.doesNotMatch(out, /\(target:/);
});

test("plan scope marks each story COVERED or NEEDS TASKS", () => {
  const out = composeInstruction({
    kind: "plan",
    scope: {
      phase: 2,
      tag: "spec-v3",
      stories: [
        { number: 1, title: "Sign in", covered: true },
        { number: 4, covered: false },
      ],
    },
  });
  assert.match(out, /## Milestone scope — Phase 2 \(spec spec-v3\)/);
  assert.match(out, /- Story 1: Sign in — COVERED/);
  assert.match(out, /- Story 4 — NEEDS TASKS/, "a story with no title still gets a row");
});

test("an empty or phase-0 scope renders nothing", () => {
  // The base directive mentions a "Milestone scope" section, so match the
  // HEADING — the thing the block actually emits.
  assert.doesNotMatch(
    composeInstruction({ kind: "plan", scope: { phase: 0, tag: "t", stories: [{ number: 1, covered: false }] } }),
    /## Milestone scope/,
  );
  assert.doesNotMatch(
    composeInstruction({ kind: "plan", scope: { phase: 3, tag: "t", stories: [] } }),
    /## Milestone scope/,
  );
});

test("plan context is sorted by path, so the same inputs give the same prompt", () => {
  const out = composeInstruction({
    kind: "plan",
    taskContext: [
      { path: "tasks/9.md", body: "nine" },
      { path: "tasks/2.md", body: "two" },
    ],
  });
  assert.match(out, /## Existing open Tasks in this version \(reference\)/);
  assert.ok(out.indexOf("tasks/2.md") < out.indexOf("tasks/9.md"), "deterministic order");
  assert.match(out, /\n--- tasks\/2\.md ---\ntwo\n/);
});

test("eager skills are derived from the flow, not supplied by the caller", () => {
  assert.deepEqual(eagerSkillsFor({ kind: "start" }), ["grilling"]);
  assert.deepEqual(eagerSkillsFor({ kind: "flow", skill: "amend" }), ["grilling"]);
  assert.deepEqual(eagerSkillsFor({ kind: "flow", skill: "design" }), ["design"]);
  // A flow with no eager entry still runs — its skill loads lazily.
  assert.deepEqual(eagerSkillsFor({ kind: "flow", skill: "wireframes" }), []);
  assert.deepEqual(eagerSkillsFor({ kind: "chat", text: "x" }), []);
  assert.deepEqual(eagerSkillsFor({ kind: "plan" }), []);
});

test("`organization` is never eager — it rides the system prompt on every turn", () => {
  for (const turn of [
    { kind: "start" } as const,
    { kind: "flow", skill: "amend" } as const,
    { kind: "flow", skill: "design" } as const,
  ]) {
    assert.ok(!eagerSkillsFor(turn).includes("organization"), `${JSON.stringify(turn)} must not inline it twice`);
  }
});

test("the tool set is derived from the kind", () => {
  assert.equal(toolsetFor({ kind: "plan" }), "task-plan");
  assert.equal(toolsetFor({ kind: "chat", text: "x" }), "files");
  assert.equal(toolsetFor({ kind: "start" }), "files");
  assert.equal(toolsetFor({ kind: "flow", skill: "design" }), "files");
});
