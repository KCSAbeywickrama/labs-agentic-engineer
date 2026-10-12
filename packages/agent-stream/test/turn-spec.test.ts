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
 * `isTurnSpec` — the agents server's pre-stream 400 check. The point of the
 * guard is that a malformed body fails with a status code instead of composing
 * a nonsense instruction, so the cases that matter are the ones where a field
 * the kind DEPENDS on is missing or the wrong type.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isToolset, isTurnSpec, isView, TOOLSETS, VIEWS } from "../src/contracts/sse-events.js";

test("accepts each well-formed kind", () => {
  assert.ok(isTurnSpec({ kind: "chat", text: "add a returns policy" }));
  assert.ok(isTurnSpec({ kind: "flow", skill: "design" }));
  assert.ok(isTurnSpec({ kind: "flow", skill: "amend", text: "add an actor" }));
  assert.ok(isTurnSpec({ kind: "start" }));
  assert.ok(isTurnSpec({ kind: "start", idea: "an expense tracker" }));
  // Reference documents ride as paths; a non-string list is a caller bug and
  // must be refused before it reaches prompt composition.
  assert.ok(isTurnSpec({ kind: "start", references: ["specs/requirements/references/rfp.pdf"] }));
  assert.ok(isTurnSpec({ kind: "flow", skill: "design", references: ["specs/requirements/references/sketch.png"] }));
  assert.equal(isTurnSpec({ kind: "flow", skill: "design", references: [7] }), false);
  assert.ok(isTurnSpec({ kind: "start", references: [] }));
  assert.equal(isTurnSpec({ kind: "start", references: [1, 2] }), false);
  assert.equal(isTurnSpec({ kind: "start", references: "rfp.pdf" }), false);
  assert.ok(isTurnSpec({ kind: "plan" }));
});

test("rejects a missing or unknown discriminant", () => {
  assert.equal(isTurnSpec(undefined), false);
  assert.equal(isTurnSpec(null), false);
  assert.equal(isTurnSpec("chat"), false);
  assert.equal(isTurnSpec({}), false);
  assert.equal(isTurnSpec({ kind: "generate" }), false);
});

test("rejects a kind whose required field is missing, blank, or mistyped", () => {
  assert.equal(isTurnSpec({ kind: "chat" }), false);
  assert.equal(isTurnSpec({ kind: "chat", text: "   " }), false);
  assert.equal(isTurnSpec({ kind: "chat", text: 42 }), false);
  assert.equal(isTurnSpec({ kind: "flow" }), false);
  assert.equal(isTurnSpec({ kind: "flow", skill: "" }), false);
  assert.equal(isTurnSpec({ kind: "flow", skill: "design", text: 1 }), false);
  assert.equal(isTurnSpec({ kind: "start", idea: 7 }), false);
});

test("a plan scope is validated when present", () => {
  assert.ok(
    isTurnSpec({
      kind: "plan",
      scope: {
        tag: "v3",
        features: [{ id: "F1", name: "Claims" }, { id: "F2", needs: ["F1"] }],
        productWide: [{ id: "P1", text: "Sign in", appliesTo: ["all"] }],
        heldBack: ["F2.4"],
      },
    }),
  );
  assert.ok(isTurnSpec({ kind: "plan", scope: { tag: "t" } }), "a version that carries nothing named is still a scope");
  assert.equal(isTurnSpec({ kind: "plan", scope: { tag: 2 } }), false);
  assert.equal(isTurnSpec({ kind: "plan", scope: { tag: "t", features: [{ name: "no id" }] } }), false);
  assert.equal(isTurnSpec({ kind: "plan", scope: { tag: "t", heldBack: [3] } }), false);
});

test("unknown extra keys are tolerated", () => {
  assert.ok(isTurnSpec({ kind: "start", idea: "x", futureField: true }));
});

test("isView accepts exactly the known views", () => {
  assert.deepEqual([...VIEWS], ["issues", "issue"]);
  assert.ok(isView("issues"));
  assert.ok(isView("issue"));
  for (const v of ["boards", "", "Issues", "Issue", undefined, null, 1, {}]) assert.equal(isView(v), false, String(v));
});

test("each view's agent has a tool set of its own", () => {
  assert.deepEqual([...TOOLSETS], ["files", "task-plan", "issues", "issue"]);
  for (const view of VIEWS) assert.ok(isToolset(view), view);
});
