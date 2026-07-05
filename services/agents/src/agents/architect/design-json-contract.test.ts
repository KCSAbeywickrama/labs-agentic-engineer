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
 * Single-source-of-truth conformance: a component this agent PRODUCES (via
 * DesignDoc → materialize(), with openAPISpec split off exactly the way
 * aep-api's design_service.go does before the Go codec writes
 * `specs/design/components/<name>/design.json`) must validate against THIS
 * service's own design.json contract — the same `componentDesignSchema` the
 * MAIN agent authors through (`../main/component-design.ts`). We import it
 * directly (no duplicated mirror) so the architect and the main agent are
 * pinned to ONE schema: the architect cannot drift a "parallel" design.json.
 *
 * The Go codec (`aep-api/internal/feature/artifacts/design_json.go`) is the
 * third party to this contract; Go can't run here, so its on-disk key set is
 * transcribed in GO_COMPONENT_KEYS / GO_DEPENDENCY_KEYS and asserted against
 * the emitted shape. The one deliberate rename — wire `componentType` ↔ on-disk
 * `type` — happens inside aep-api's marshal step; this agent emits
 * `componentType` on the wire (matching `models.DesignComponent`), which
 * `toDesignJsonShape` renames here to model that step. `status`/`reason` are
 * NEVER emitted (platform-computed, read-time only) — asserted directly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DesignDoc } from "./doc.js";
import type { DesignComponent, SlimComponent } from "./schema.js";
import { componentDesignSchema } from "../main/component-design.js";

// Transcribed from `componentDesignJSON` / `dependencyJSON` struct tags in
// design_json.go (kept in lockstep with that file).
const GO_COMPONENT_KEYS = [
  "name",
  "type", // wire `componentType` ↔ on-disk `type`; renamed by aep-api's marshal step
  "version",
  "language",
  "buildpack",
  "appPath",
  "entrypoint",
  "exposure",
  "description",
  "dependencies",
  "exposesAPI",
  "callerIdentity",
  "componentAgentInstructions",
].sort();

const GO_DEPENDENCY_KEYS = [
  "kind",
  "name",
  "description",
  "needsSpec",
  "specPath",
  "specUrl",
  "config",
  "resourceType",
  "parameters",
  "candidates",
  // deliberately NOT present: "status", "reason" (read-time computed)
].sort();

function slim(): SlimComponent {
  return {
    name: "orders-api",
    componentType: "service",
    version: "0.1.0",
    language: "Go",
    dependencies: [
      { kind: "component", name: "orders-webapp" },
      { kind: "org-service", name: "hr-directory-employee-api", description: "org-wide employee directory" },
      {
        kind: "external",
        name: "stripe",
        description: "Stripe payments SDK",
        config: [{ key: "STRIPE_API_KEY", secret: true }],
        needsSpec: false,
        candidates: [{ label: "Stripe API docs", url: "https://stripe.com/docs/api" }],
      },
      { kind: "platform-resource", name: "orders-db", resourceType: "postgres-cnpg", description: "order records" },
    ],
    entrypoint: "deployment/service",
    buildpack: "docker",
    appPath: "orders-api",
    exposure: "internet",
    description: "Stores and serves customer orders. Does not handle payments directly.",
    componentAgentInstructions: "Implement a Go service exposing the order CRUD API.",
    exposesAPI: { auth: "end-user-required", orgPublished: true },
  };
}

/** Strip openAPISpec + rename componentType→type, exactly as aep-api does before
 * the Go codec writes design.json. The result is the on-disk shape. */
function toDesignJsonShape(materialized: DesignComponent): Record<string, unknown> {
  const { componentType, ...rest } = materialized;
  const out: Record<string, unknown> = { ...rest, type: componentType };
  delete out.openAPISpec; // stays in the sibling openapi.yaml, not design.json
  return out;
}

test("a generated component's design.json validates against THIS service's componentDesignSchema", () => {
  const doc = new DesignDoc();
  doc.addComponent(slim());
  doc.setOpenApi(
    "orders-api",
    'openapi: 3.0.3\ninfo:\n  title: orders-api\n  version: 1.0.0\npaths:\n  /health:\n    get:\n      responses:\n        "200":\n          description: ok\n',
  );

  const designJson = toDesignJsonShape(doc.materialize().components[0]!);
  const parsed = componentDesignSchema.safeParse(designJson);
  assert.ok(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.format(), null, 2));
});

test("status/reason are NEVER present on an emitted dependency", () => {
  const doc = new DesignDoc();
  doc.addComponent(slim());
  for (const dep of doc.materialize().components[0]!.dependencies) {
    assert.ok(!("status" in dep), `dependency ${dep.name} must not carry status`);
    assert.ok(!("reason" in dep), `dependency ${dep.name} must not carry reason`);
  }
});

test("emitted design.json top-level key set is a subset of the documented Go componentDesignJSON tags", () => {
  const doc = new DesignDoc();
  doc.addComponent(slim());
  doc.setOpenApi("orders-api", "openapi: 3.0.3\ninfo: {title: x, version: '1'}\npaths: {}\n");
  const designJson = toDesignJsonShape(doc.materialize().components[0]!);

  const presentKeys = Object.keys(designJson)
    .filter((k) => {
      const v = designJson[k];
      if (v === undefined || v === null) return false;
      if (Array.isArray(v) && k !== "dependencies") return v.length > 0;
      if (typeof v === "string") return v.length > 0;
      return true;
    })
    .sort();

  for (const k of presentKeys) {
    assert.ok(GO_COMPONENT_KEYS.includes(k), `key '${k}' is not in the documented Go componentDesignJSON tag set`);
  }
});

test("emitted dependency key sets are each a subset of the documented Go dependencyJSON tags", () => {
  const doc = new DesignDoc();
  doc.addComponent(slim());
  for (const dep of doc.materialize().components[0]!.dependencies) {
    const presentKeys = Object.keys(dep).filter((k) => {
      const v = (dep as Record<string, unknown>)[k];
      return v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);
    });
    for (const k of presentKeys) {
      assert.ok(GO_DEPENDENCY_KEYS.includes(k), `dependency '${dep.name}' key '${k}' is not in the documented Go dependencyJSON tag set`);
    }
  }
});

test("a component missing a required design.json field (empty description) fails the contract", () => {
  const doc = new DesignDoc();
  doc.addComponent({ ...slim(), description: "" } as SlimComponent);
  doc.setOpenApi("orders-api", "openapi: 3.0.3\ninfo: {title: x, version: '1'}\npaths: {}\n");
  const designJson = toDesignJsonShape(doc.materialize().components[0]!);
  assert.equal(componentDesignSchema.safeParse(designJson).success, false);
});
