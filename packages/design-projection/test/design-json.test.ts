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
import { projectDesignJson, componentSlices } from "../src/design-json.js";

const BUNDLE: Record<string, string> = {
  "specs/design/design.md": `---
skillsApplied:
  - high-level-architecture
  - openapi-conventions
---

# Design
`,
  "specs/design/components/expense-api/design.md": `---
type: service
language: Go
buildpack: docker
appPath: expense-api
entrypoint: deployment/service
version: 0.2.0
exposure: internet
connections:
  - to: postgres
    type: datastore
  - to: email-gateway
    type: connector
    onPlatform: false
---

The API service.
`,
  "specs/design/components/expense-api/openapi.yaml": "openapi: 3.0.3\n",
  "specs/design/components/expense-webapp/design.md": `---
type: webapp
language: TypeScript
buildpack: docker
appPath: expense-webapp
entrypoint: deployment/webapp
connections:
  - to: expense-api
    type: http
---

The webapp.
`,
  "specs/design/components/expense-webapp/wireframes.dsl": "screen A\n",
};

test("projects the bundle into the cell-diagram-compatible design json", () => {
  const dj = projectDesignJson("expense-claim", BUNDLE);
  assert.equal(dj.name, "expense-claim");
  assert.equal(dj.modelVersion, "0.4.0");
  assert.deepEqual(dj.skillsApplied, ["high-level-architecture", "openapi-conventions"]);
  assert.deepEqual(dj.components.map((c) => c.id).sort(), ["expense-api", "expense-webapp"]);

  const api = dj.components.find((c) => c.id === "expense-api")!;
  assert.equal(api.type, "service");
  assert.equal(api.version, "0.2.0");
  assert.equal(api.build.language, "Go");
  assert.equal(api.services!["expense-api"]!.deploymentMetadata.gateways.internet.isExposed, true);
  assert.deepEqual(api.connections, [
    { id: "datastore://postgres", type: "datastore", onPlatform: true },
    { id: "connector://email-gateway", type: "connector", onPlatform: false },
  ]);
  assert.equal(api.artifacts.openapi, "specs/design/components/expense-api/openapi.yaml");

  const web = dj.components.find((c) => c.id === "expense-webapp")!;
  assert.equal(web.type, "webapp");
  assert.equal(web.version, "0.1.0"); // defaulted
  assert.equal(web.services, undefined); // webapps expose no services
  assert.deepEqual(web.connections, [{ id: "http://expense-api", type: "http", onPlatform: true }]);
  assert.equal(web.artifacts.wireframes, "specs/design/components/expense-webapp/wireframes.dsl");
});

test("a bundle without a design tree projects to an empty component list", () => {
  const dj = projectDesignJson("empty", { "requirements.md": "# hi\n" });
  assert.deepEqual(dj.components, []);
  assert.deepEqual(dj.skillsApplied, []);
});

test("componentSlices emits one per-component design.gen.json path with project context", () => {
  const dj = projectDesignJson("expense-claim", BUNDLE);
  const slices = componentSlices(dj);
  assert.deepEqual(Object.keys(slices).sort(), [
    "specs/design/components/expense-api/design.gen.json",
    "specs/design/components/expense-webapp/design.gen.json",
  ]);
  const api = slices["specs/design/components/expense-api/design.gen.json"]!;
  assert.equal(api.project.name, "expense-claim");
  assert.deepEqual(api.project.skillsApplied, ["high-level-architecture", "openapi-conventions"]);
  assert.equal(api.component.id, "expense-api");
  assert.equal(api.component.build.language, "Go");
});
