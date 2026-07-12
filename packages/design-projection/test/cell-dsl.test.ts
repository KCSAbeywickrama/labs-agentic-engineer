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
import { toCellDsl } from "../src/cell-dsl.js";

// The real ceramics-store bundle from the design-cell iteration.
const BUNDLE: Record<string, string> = {
  "specs/design/components/ceramics-api/design.json": JSON.stringify({
    name: "ceramics-api",
    type: "service",
    exposure: "internet",
    dependencies: [
      { kind: "platform-resource", name: "ceramics-db", resourceType: "postgres" },
      { kind: "platform-resource", name: "user-auth", resourceType: "thunder-app" },
      { kind: "external", name: "payment-provider" },
      { kind: "external", name: "email-provider" },
    ],
  }),
  "specs/design/components/ceramics-webapp/design.json": JSON.stringify({
    name: "ceramics-webapp",
    type: "web-application",
    exposure: "internet",
    dependencies: [
      { kind: "component", name: "ceramics-api" },
      { kind: "platform-resource", name: "user-auth", resourceType: "thunder-app" },
    ],
  }),
};

test("places each dependency kind on the correct boundary", () => {
  const dsl = toCellDsl("Handmade Ceramics", BUNDLE);
  assert.ok(dsl);
  const lines = dsl.split("\n");

  assert.equal(lines[0], "title Handmade Ceramics");

  // Own components, inside the cell.
  assert.ok(dsl.includes('component ceramics-api as "Ceramics Api" service'));
  assert.ok(dsl.includes('component ceramics-webapp as "Ceramics Webapp" web-application'));
  // postgres platform-resource → inside as a database component.
  assert.ok(dsl.includes('component ceramics-db as "Ceramics Db" database'));

  // thunder-app → east identity-server, declared exactly once despite two uses.
  assert.equal(dsl.match(/^east user-auth /gm)?.length, 1);
  assert.ok(dsl.includes('east user-auth as "User Auth" identity-server'));

  // externals → south.
  assert.ok(dsl.includes('south payment-provider as "Payment Provider" service'));
  assert.ok(dsl.includes('south email-provider as "Email Provider" service'));

  // exposure internet → north exposure edges for both exposed components.
  assert.ok(dsl.includes("north -> ceramics-api"));
  assert.ok(dsl.includes("north -> ceramics-webapp"));

  // dependency edges present.
  assert.ok(dsl.includes("ceramics-webapp -> ceramics-api"));
  assert.ok(dsl.includes("ceramics-api -> ceramics-db"));
  assert.ok(dsl.includes("ceramics-api -> user-auth"));
  assert.ok(dsl.includes("ceramics-webapp -> user-auth"));
  assert.ok(dsl.includes("ceramics-api -> payment-provider"));

  // No invented keywords.
  assert.ok(!/^\s*resource /m.test(dsl));
  assert.ok(!/^\s*external /m.test(dsl));
});

test("intranet exposure maps to the west gateway", () => {
  const dsl = toCellDsl("Proj", {
    "specs/design/components/internal-api/design.json": JSON.stringify({
      name: "internal-api",
      type: "service",
      exposure: "intranet",
      dependencies: [],
    }),
  });
  assert.ok(dsl);
  assert.ok(dsl.includes("west -> internal-api"));
  assert.ok(!dsl.includes("north ->"));
});

test("is deterministic (components sorted by id)", () => {
  const a = toCellDsl("P", BUNDLE);
  const b = toCellDsl("P", BUNDLE);
  assert.equal(a, b);
  // ceramics-api declared before ceramics-webapp.
  const dsl = a!;
  assert.ok(dsl.indexOf("component ceramics-api") < dsl.indexOf("component ceramics-webapp"));
});

test("skips malformed design.json and returns null when none remain", () => {
  assert.equal(toCellDsl("P", {}), null);
  assert.equal(
    toCellDsl("P", { "specs/design/components/broken/design.json": "{ not json" }),
    null,
  );
  // One broken, one valid → only the valid one is emitted.
  const dsl = toCellDsl("P", {
    "specs/design/components/broken/design.json": "{ not json",
    "specs/design/components/ok/design.json": JSON.stringify({ name: "ok", type: "service", exposure: "intranet" }),
  });
  assert.ok(dsl);
  assert.ok(dsl.includes("component ok as"));
  assert.ok(!dsl.includes("broken"));
});
