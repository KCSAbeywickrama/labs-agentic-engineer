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
import type { ProjectDesign } from "../src/types.js";
import { toCellDiagramProject } from "../src/cell-diagram.js";

const DESIGN: ProjectDesign = {
  modelVersion: "0.4.0",
  id: "expense-claim",
  name: "expense-claim",
  skillsApplied: ["high-level-architecture"],
  components: [
    {
      id: "expense-api",
      type: "service",
      version: "0.2.0",
      build: { language: "Go" },
      services: {
        "expense-api": {
          id: "expense-api",
          label: "expense-api",
          type: "http",
          deploymentMetadata: { gateways: { internet: { isExposed: true }, intranet: { isExposed: false } } },
        },
      },
      connections: [
        { id: "datastore://postgres", type: "datastore", onPlatform: true },
        { id: "connector://email-gateway", type: "connector", onPlatform: false },
      ],
      artifacts: {},
    },
    {
      id: "expense-webapp",
      type: "webapp",
      version: "0.1.0",
      build: { language: "TypeScript" },
      connections: [{ id: "http://expense-api", type: "http", onPlatform: true }],
      artifacts: {},
    },
  ],
};

test("maps ProjectDesign to the cell-diagram Project shape (legacy buildProjectModel conventions)", () => {
  const p = toCellDiagramProject(DESIGN);
  assert.equal(p.id, "project");
  assert.equal(p.name, "expense-claim");
  assert.deepEqual(p.components.map((c) => c.id).sort(), ["expense-api", "expense-webapp"]);

  const web = p.components.find((c) => c.id === "expense-webapp")!;
  assert.equal(web.type, "web-app"); // cell diagram spells it web-app, not webapp
  assert.equal(web.buildPack, "TypeScript");
  // A webapp exposes a :web service whose dependencyIds point at sibling :api services.
  assert.deepEqual(web.services["expense-webapp:web"]!.dependencyIds, ["expense-api:api"]);
  // The sibling edge targets the in-project component.
  assert.deepEqual(web.connections, [
    { id: "default:project:expense-api", label: "expense-api", onPlatform: true },
  ]);

  const api = p.components.find((c) => c.id === "expense-api")!;
  assert.equal(api.type, "service");
  assert.equal(api.services["expense-api:api"]!.deploymentMetadata.gateways.internet.isExposed, true);
  // Non-component targets (datastore, external connector) group under external-apis.
  assert.deepEqual(api.connections, [
    { id: "default:external-apis:postgres", label: "postgres", tooltip: "datastore" },
    { id: "default:external-apis:email-gateway", label: "email-gateway", tooltip: "connector (off-platform)" },
  ]);
});
