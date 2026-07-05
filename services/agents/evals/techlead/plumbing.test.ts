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
 * Deterministic tech-lead eval-tree test (no tokens) — drives the real
 * `runTechLeadPlan` seal-rule with a MOCK structured-output model over the
 * all-four-dependency-kinds fixture, then grades it with the SAME `scorePlan`
 * the live eval uses. Proves the plumbing (seal-rule + validator + scorer)
 * before the paid run; the only thing the live run adds is the model's
 * behavior.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PlanRequestBody } from "../../src/agents/techlead/schema.js";
import { runTechLeadPlan } from "../../src/agents/techlead/run.js";
import { mockObjectArrayModel } from "../../src/shared/mock-model.js";
import { scorePlan, allPass, type TechLeadPlanFixture } from "./score.js";

const here = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): TechLeadPlanFixture {
  return JSON.parse(readFileSync(join(here, "fixtures", `${name}.json`), "utf8")) as TechLeadPlanFixture;
}

test("plan seal-rule + scorer over the all-four-kinds fixture (mock model, no tokens)", async () => {
  const fx = loadFixture("all-four-kinds");
  const input = PlanRequestBody.parse(fx.input);

  // A hand-authored plan that satisfies the fixture's expectations: consumers
  // list their providers, and the payments-api rationale names both gates.
  const model = mockObjectArrayModel(
    [
      {
        componentName: "payments-api",
        title: "Build the payments API",
        rationale:
          "Records the ledger and charges the customer; blocked until the 'stripe' external resource values are collected and the 'payments-db' platform resource is provisioned.",
        dependsOn: [],
      },
      {
        componentName: "orders-api",
        title: "Build the orders API",
        rationale: "Places orders, delegating charges to the payments service and identifying the user via the org identity service.",
        dependsOn: ["Build the payments API"],
      },
      {
        componentName: "orders-web",
        title: "Build the orders web app",
        rationale: "The storefront UI over the orders API.",
        dependsOn: ["Build the orders API"],
      },
    ],
    5, // chunk the JSON so partialObjectStream advances the seal-rule progressively
  );

  const { items, issues } = await runTechLeadPlan({ model, input });

  assert.equal(items.length, 3, "seal-rule should emit all three plan items");
  assert.deepEqual(
    items.map((i) => i.tempId),
    ["p-0", "p-1", "p-2"],
    "route-assigned tempIds are sequential",
  );
  assert.deepEqual(issues, [], `validator should be clean, got ${issues.map((i) => i.code).join(",")}`);

  const checks = scorePlan(
    items,
    fx.expect,
    input.slimDesign.map((c) => c.name),
  );
  assert.ok(allPass(checks), JSON.stringify(checks.filter((c) => !c.pass), null, 2));
});
