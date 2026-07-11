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
 * Write-gate behavior for the two design.json rules this branch adds — the
 * canonical `web-application` type (aliases rejected) and the optional
 * `endpoint` block. These assert the zod source of truth directly; the Go fold
 * gate (agentfold/designgate.go) has its own parity tests, and the two must
 * agree — a design that passes one gate MUST pass the other.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { checkComponentDesign } from "../src/component-design-schema.ts";

const PATH = "specs/design/components/web/design.json";

/** A minimal design.json whose `name` matches PATH's directory ("web"). */
function design(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: "web",
    type: "web-application",
    version: "0.1.0",
    language: "typescript",
    buildpack: "docker",
    appPath: ".",
    entrypoint: "index.html",
    exposure: "internet",
    dependencies: [],
    description: "the SPA",
    ...overrides,
  });
}

test("accepts the canonical web-application type", () => {
  assert.equal(checkComponentDesign(PATH, design()), null);
});

for (const alias of ["webapp", "web-app", "webApplication", "web application", "WEBAPP", " web-app "]) {
  test(`rejects the web-application alias ${JSON.stringify(alias)}`, () => {
    const problem = checkComponentDesign(PATH, design({ type: alias }));
    assert.equal(problem?.code, "SCHEMA_VIOLATION");
    assert.match(problem!.message, /web-application/);
  });
}

test("accepts an endpoint block with a name", () => {
  assert.equal(checkComponentDesign(PATH, design({ endpoint: { name: "api" } })), null);
});

test("rejects an endpoint block with an empty name", () => {
  const problem = checkComponentDesign(PATH, design({ endpoint: { name: "" } }));
  assert.equal(problem?.code, "SCHEMA_VIOLATION");
});

test("rejects an endpoint block with an unknown key", () => {
  const problem = checkComponentDesign(PATH, design({ endpoint: { name: "api", port: 8080 } }));
  assert.equal(problem?.code, "SCHEMA_VIOLATION");
});

// --- config keys carry an optional description ------------------------------

const dep = (config: unknown) => ({ kind: "external", name: "stripe", config });

test("accepts a config key with an optional description", () => {
  const doc = design({
    dependencies: [dep([{ key: "STRIPE_API_KEY", secret: true, description: "Your Stripe secret API key" }])],
  });
  assert.equal(checkComponentDesign(PATH, doc), null);
});

test("rejects an unknown key on a config entry (e.g. the retired credentialClass)", () => {
  const doc = design({ dependencies: [dep([{ key: "STRIPE_API_KEY", credentialClass: "secret" }])] });
  const problem = checkComponentDesign(PATH, doc);
  assert.equal(problem?.code, "SCHEMA_VIOLATION");
});

// --- buildpack is pinned to "docker" (agent write-gate only; see the .refine) -

test("accepts buildpack docker", () => {
  assert.equal(checkComponentDesign(PATH, design({ buildpack: "docker" })), null);
});

for (const buildpack of ["go", "react", "node", "nodejs", "Docker", ""]) {
  test(`rejects non-docker buildpack ${JSON.stringify(buildpack)}`, () => {
    const problem = checkComponentDesign(PATH, design({ buildpack }));
    assert.equal(problem?.code, "SCHEMA_VIOLATION");
    assert.match(problem!.message, /buildpack|docker/);
  });
}
