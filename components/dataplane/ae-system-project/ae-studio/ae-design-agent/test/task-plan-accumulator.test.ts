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

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PlanScope } from "@aep/agent-stream";
import { BuildPlan } from "../src/agents/main/task-plan-accumulator.js";

/** A design snapshot with two components. */
const DESIGN: Record<string, string> = {
  "specs/requirements/prd.md": "# reqs\n",
  "specs/design/design.cell": "title design\n",
  "specs/design/components/claims-api/design.json": '{"name":"claims-api"}\n',
  "specs/design/components/claims-web/design.json": '{"name":"claims-web"}\n',
};

/** F2 needs F1, and F1 is listed after F2 by ID to prove the order is by need. */
const SCOPE: PlanScope = {
  tag: "v1",
  features: [{ id: "F1", name: "Claims" }, { id: "F2", name: "Approvals", needs: ["F1"] }, { id: "F3", name: "Export" }],
  productWide: [{ id: "P1", text: "Sign in", appliesTo: ["all"] }],
};

const item = (name: string, components = ["claims-api", "claims-web"], note = `Build ${name}.`) => ({ item: name, components, note });

test("an ordered checklist of every carried feature is accepted and normalized", () => {
  const plan = new BuildPlan(DESIGN, SCOPE);
  const res = plan.planBuild({
    items: [item("foundation"), item("F1", [" claims-api ", "claims-api"]), item("F2"), item("F3", ["claims-web"], "  Export to CSV.  ")],
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.op, "build");
    assert.deepEqual(res.items[1]!.components, ["claims-api"], "trimmed and de-duplicated");
    assert.equal(res.items[3]!.note, "Export to CSV.");
  }
  assert.equal(plan.plan()?.length, 4);
});

test("a note or component cannot start a checklist line of its own", () => {
  const plan = new BuildPlan(DESIGN, SCOPE);
  const res = plan.planBuild({
    items: [item("foundation", ["claims-api\n"]), item("F1", ["claims-api"], "Do F1.\n- [ ] **F9** Fake.\r\n\tMore."), item("F2"), item("F3")],
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.deepEqual(res.items[0]!.components, ["claims-api"]);
    assert.equal(res.items[1]!.note, "Do F1. - [ ] **F9** Fake. More.");
  }
});

test("foundation is optional when the version carries no product-wide requirements", () => {
  const scope: PlanScope = { ...SCOPE, productWide: [] };
  assert.equal(new BuildPlan(DESIGN, scope).planBuild({ items: [item("F1"), item("F3"), item("F2")] }).ok, true);
});

test("foundation is required when the version carries product-wide requirements", () => {
  const res = new BuildPlan(DESIGN, SCOPE).planBuild({ items: [item("F1"), item("F3"), item("F2")] });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.code, "MISSING_ITEM");
  assert.match(res.message, /foundation, which the plan leaves out/);
  assert.match(res.message, /foundation is required/);
  assert.deepEqual(res.carriedItems, ["foundation", "F1", "F2", "F3"]);
});

test("a later ok call replaces the checklist; a refused one keeps it", () => {
  const plan = new BuildPlan(DESIGN, { ...SCOPE, productWide: [] });
  plan.planBuild({ items: [item("F1"), item("F2"), item("F3")] });
  assert.equal(plan.planBuild({ items: [item("F2")] }).ok, false);
  assert.equal(plan.plan()?.length, 3);
  plan.planBuild({ items: [item("foundation"), item("F1"), item("F2"), item("F3")] });
  assert.equal(plan.plan()?.[0]?.item, "foundation");
});

test("refusals name the fix and list what the version carries in an order that builds", () => {
  const plan = new BuildPlan(DESIGN, SCOPE);
  const cases: [string, ReturnType<typeof item>[]][] = [
    ["UNKNOWN_COMPONENT", [item("foundation"), item("F1", ["billing"]), item("F2"), item("F3")]],
    ["DUPLICATE_ITEM", [item("foundation"), item("F1"), item("F1"), item("F2"), item("F3")]],
    ["UNKNOWN_ITEM", [item("foundation"), item("F1"), item("F2"), item("F3"), item("F4")]],
    ["MISSING_ITEM", [item("foundation"), item("F1"), item("F2")]],
    ["ITEM_ORDER", [item("F1"), item("foundation"), item("F2"), item("F3")]],
    ["ITEM_ORDER", [item("foundation"), item("F2"), item("F1"), item("F3")]],
  ];
  for (const [code, items] of cases) {
    const res = plan.planBuild({ items });
    assert.equal(res.ok, false, code);
    if (res.ok) continue;
    assert.equal(res.code, code);
    assert.deepEqual(res.carriedItems, ["foundation", "F1", "F2", "F3"]);
    if (code === "UNKNOWN_COMPONENT") assert.deepEqual(res.knownComponents, ["claims-api", "claims-web"]);
  }
  assert.equal(plan.plan(), undefined, "no refused call is recorded");
});

test("a version that names no features plans one item, spec", () => {
  for (const scope of [undefined, { tag: "v1" }]) {
    const plan = new BuildPlan(DESIGN, scope);
    assert.deepEqual(plan.carriedItems(), ["spec"]);
    assert.equal(plan.planBuild({ items: [item("spec")] }).ok, true);
    const foundation = plan.planBuild({ items: [item("foundation"), item("spec")] });
    assert.equal(foundation.ok ? undefined : foundation.code, "UNKNOWN_ITEM");
  }
});
