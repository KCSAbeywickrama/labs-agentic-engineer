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
 * Deterministic conformance test: a component this agent PRODUCES (via
 * DesignDoc → materialize(), openAPISpec split off the same way aep-api's
 * design_service.go does before writing `specs/design/components/<name>/
 * design.json`) must validate against the design.json contract from BOTH
 * sides of the wire:
 *
 *  1. The TS contract — `services/agents/src/contracts/component-design.ts`
 *     (ComponentDesign). agents-legacy is a separate deployable (package
 *     "agents", not workspace-linked to "@aep/agents", and slated for
 *     decommission at the E-phase cutover), so rather than adding a
 *     cross-service `workspace:*` dependency for one test, this file
 *     DUPLICATES that contract as a minimal Zod validator (`ComponentDesignTS`
 *     below) — kept in lockstep with the source file by the field-by-field
 *     comment mapping. Any future edit to component-design.ts should be
 *     mirrored here.
 *  2. The documented Go codec — `services/aep-api/internal/feature/artifacts/
 *     design_json.go` (`componentDesignJSON` / `dependencyJSON` structs). Go
 *     can't run in this test process, so parity is checked via a fixture
 *     round-trip note: the exact on-disk JSON key set is asserted against the
 *     Go structs' `json:"..."` tags, transcribed in `GO_COMPONENT_KEYS` /
 *     `GO_DEPENDENCY_KEYS` below (kept in lockstep with that file the same
 *     way). The one deliberate rename — wire `componentType` ↔ on-disk `type`
 *     — happens inside aep-api's own marshal step
 *     (`marshalComponentDesignJSON`), not here; this agent emits
 *     `componentType` on the wire, matching `models.DesignComponent`.
 *
 * Both sides agree: `status`/`reason` are NEVER emitted on a dependency
 * (platform-computed, read-time only) — this test asserts their absence
 * directly, not just their absence from the schema.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { DesignDoc } from "./doc.js";
import type { DesignComponent, SlimComponent } from "./schema.js";

// ── 1. TS contract mirror (component-design.ts) ────────────────────────────
// Field-by-field mapping to services/agents/src/contracts/component-design.ts:
//   name/type/version/language/buildpack/appPath/entrypoint/exposure/
//   dependencies/description/exposesAPI?/callerIdentity?/
//   componentAgentInstructions? — all present below, same required/optional
//   posture. `type` there is `string` (open, e.g. "scheduled-task"); this
//   agent only ever emits "service"|"web-app" today, which satisfies it.
const ConfigKeyTS = z.strictObject({
  key: z.string().min(1),
  secret: z.boolean().optional(),
  credentialClass: z.string().optional(),
});

const DependencyCandidateTS = z.strictObject({
  label: z.string().min(1),
  description: z.string().optional(),
  url: z.string().optional(),
});

// ONE flat strictObject — the Go codec is lenient across kinds (one struct,
// not a discriminated union; see design_json.go's header comment), so the
// TS mirror is too. `status`/`reason` are ABSENT: any occurrence is rejected
// by strictObject, exactly like Go's DisallowUnknownFields.
const DependencyTS = z.strictObject({
  kind: z.enum(["component", "org-service", "external", "platform-resource"]),
  name: z.string().min(1),
  description: z.string().optional(),
  needsSpec: z.boolean().optional(),
  specPath: z.string().optional(),
  specUrl: z.string().optional(),
  config: z.array(ConfigKeyTS).optional(),
  resourceType: z.string().optional(),
  parameters: z.record(z.string(), z.string()).optional(),
  candidates: z.array(DependencyCandidateTS).optional(),
});

const ExposesAPITS = z.strictObject({
  managed: z.boolean().optional(),
  auth: z.string().optional(),
  userContext: z.string().optional(),
  orgPublished: z.boolean().optional(),
});

const CallerIdentityTS = z.strictObject({
  mode: z.string().min(1),
});

const ComponentDesignTS = z.strictObject({
  name: z.string().min(1),
  type: z.string().min(1),
  version: z.string().min(1),
  language: z.string().min(1),
  buildpack: z.string().min(1),
  appPath: z.string().min(1),
  entrypoint: z.string().min(1),
  exposure: z.enum(["internet", "intranet"]),
  dependencies: z.array(DependencyTS),
  description: z.string().min(1),
  exposesAPI: ExposesAPITS.optional(),
  callerIdentity: CallerIdentityTS.optional(),
  componentAgentInstructions: z.string().optional(),
});

// ── 2. Documented Go shape (design_json.go) — round-trip note ──────────────
// Transcribed from `componentDesignJSON` / `dependencyJSON` struct tags.
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

// ── Helper: build a component with every field populated, one dependency of
// each of the four kinds, and strip openAPISpec the way aep-api's
// design_service.go does before handing the rest to the design.json codec. ──
function slim(): SlimComponent {
  return {
    name: "orders-api",
    componentType: "service",
    version: "0.1.0",
    language: "Go",
    dependencies: [
      { kind: "component", name: "orders-webapp" },
      {
        kind: "org-service",
        name: "hr-directory-employee-api",
        description: "org-wide employee directory",
      },
      {
        kind: "external",
        name: "stripe",
        description: "Stripe payments SDK",
        config: [{ key: "STRIPE_API_KEY", secret: true }],
        needsSpec: false,
        candidates: [{ label: "Stripe API docs", url: "https://stripe.com/docs/api" }],
      },
      {
        kind: "platform-resource",
        name: "orders-db",
        resourceType: "postgres-cnpg",
        description: "order records",
      },
    ],
    entrypoint: "deployment/service",
    buildpack: "docker",
    appPath: "orders-api",
    exposure: "internet",
    description: "Stores and serves customer orders. Does not handle payments directly.",
    componentAgentInstructions: "Implement a Go service exposing the order CRUD API.",
    exposesAPI: { auth: "end-user-required", orgPublished: true },
    callerIdentity: undefined,
  };
}

function toDesignJsonShape(materialized: DesignComponent): Record<string, unknown> {
  const { openAPISpec: _openAPISpec, componentType, ...rest } = materialized;
  // The wire emits `componentType`; design.json (on disk) renames it to
  // `type` inside aep-api's own marshal step — mirror that rename here so
  // the object we validate is the actual on-disk shape, not the wire shape.
  return { ...rest, type: componentType };
}

test("a generated component's design.json shape validates against the TS contract mirror (component-design.ts)", () => {
  const doc = new DesignDoc();
  doc.addComponent(slim());
  doc.setOpenApi(
    "orders-api",
    "openapi: 3.0.3\ninfo:\n  title: orders-api\n  version: 1.0.0\npaths:\n  /health:\n    get:\n      responses:\n        \"200\":\n          description: ok\n",
  );

  const materialized = doc.materialize().components[0]!;
  const designJson = toDesignJsonShape(materialized);

  const parsed = ComponentDesignTS.safeParse(designJson);
  assert.ok(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.format(), null, 2));
});

test("status/reason are NEVER present on an emitted dependency", () => {
  const doc = new DesignDoc();
  doc.addComponent(slim());
  const { dependencies } = doc.materialize().components[0]!;
  for (const dep of dependencies) {
    assert.ok(!("status" in dep), `dependency ${dep.name} must not carry status`);
    assert.ok(!("reason" in dep), `dependency ${dep.name} must not carry reason`);
  }
});

test("emitted design.json top-level key set matches the documented Go componentDesignJSON tags", () => {
  const doc = new DesignDoc();
  doc.addComponent(slim());
  doc.setOpenApi("orders-api", "openapi: 3.0.3\ninfo: {title: x, version: '1'}\npaths: {}\n");
  const materialized = doc.materialize().components[0]!;
  const designJson = toDesignJsonShape(materialized);

  // Keys actually present when values are non-empty (Go's `omitempty` — a
  // key with an empty/zero value is dropped on encode). callerIdentity is
  // undefined here (web-app-only field), so it is correctly absent from both
  // sides.
  const presentKeys = Object.keys(designJson)
    .filter((k) => {
      const v = (designJson as Record<string, unknown>)[k];
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
  const { dependencies } = doc.materialize().components[0]!;
  for (const dep of dependencies) {
    const presentKeys = Object.keys(dep).filter((k) => {
      const v = (dep as Record<string, unknown>)[k];
      return v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);
    });
    for (const k of presentKeys) {
      assert.ok(
        GO_DEPENDENCY_KEYS.includes(k),
        `dependency '${dep.name}' key '${k}' is not in the documented Go dependencyJSON tag set`,
      );
    }
  }
});

test("a component missing a required design.json field (e.g. empty description) fails the TS contract mirror", () => {
  const bad = { ...slim(), description: "" };
  const doc = new DesignDoc();
  doc.addComponent(bad);
  doc.setOpenApi("orders-api", "openapi: 3.0.3\ninfo: {title: x, version: '1'}\npaths: {}\n");
  const designJson = toDesignJsonShape(doc.materialize().components[0]!);
  const parsed = ComponentDesignTS.safeParse(designJson);
  assert.equal(parsed.success, false);
});
