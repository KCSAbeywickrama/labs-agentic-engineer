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

import { describe, expect, it } from "vitest";
import { parseOpenApi } from "@aep/ui-openapi-view";
import type { components } from "../../../generated/aep-api";
import {
  connectionTable,
  curlFor,
  filterEndpoints,
  flattenEndpoints,
  methodTone,
  methodsIn,
  talksTo,
  usedBy,
} from "./deploymentDetail";
import type { EnvironmentInfo } from "./environments";
import type { ConnectionRow } from "./promotion";

type ComponentDependencies = components["schemas"]["ComponentDependencies"];

const design: ComponentDependencies[] = [
  {
    componentName: "expense-web",
    dependencies: [
      { kind: "component", name: "expense-api" },
      { kind: "platform-resource", name: "user-auth", resourceType: "thunder-app" },
    ],
  },
  {
    componentName: "expense-api",
    dependencies: [
      { kind: "platform-resource", name: "expense-db", resourceType: "postgres-cnpg" },
      { kind: "platform-resource", name: "user-auth", resourceType: "thunder-app" },
      { kind: "external", name: "currency-service", config: [{ key: "API_KEY", secret: true }, { key: "BASE_URL" }] },
    ],
  },
];

const SPEC = `openapi: 3.0.0
info: { title: expense-api, version: 1.0.0 }
paths:
  /expenses:
    get:
      summary: List expenses
      responses: { "200": { description: OK } }
    post:
      summary: Create expense
      responses: { "201": { description: Created } }
  /expenses/{id}:
    delete:
      summary: Delete
      responses: { "204": { description: Gone } }
`;

function ops() {
  const parsed = parseOpenApi(SPEC);
  if ("kind" in parsed) throw new Error("fixture spec did not parse");
  return flattenEndpoints(parsed);
}

describe("the component graph", () => {
  it("names the components a web app talks to, and who uses each dependency", () => {
    expect(talksTo(design, "expense-web")).toEqual(["expense-api"]);
    expect(talksTo(design, "expense-api")).toEqual([]);
    expect(talksTo(undefined, "expense-web")).toEqual([]);
    const by = usedBy(design);
    expect(by.get("user-auth")).toEqual(["expense-api", "expense-web"]);
    expect(by.get("currency-service")).toEqual(["expense-api"]);
    expect(by.has("expense-api")).toBe(false);
  });
});

describe("endpoints", () => {
  it("flattens the contract in document order and knows its methods", () => {
    const list = ops();
    expect(list.map((o) => `${o.method} ${o.path}`)).toEqual([
      "GET /expenses",
      "POST /expenses",
      "DELETE /expenses/{id}",
    ]);
    expect(methodsIn(list)).toEqual(["GET", "POST", "DELETE"]);
  });

  it("filters by method and by text across path and summary", () => {
    const list = ops();
    expect(filterEndpoints(list, "", "POST").map((o) => o.path)).toEqual(["/expenses"]);
    expect(filterEndpoints(list, "delete", "ALL").map((o) => o.method)).toEqual(["DELETE"]);
    expect(filterEndpoints(list, "{id}", "GET")).toEqual([]);
  });

  it("colours a verb by what it does", () => {
    expect(methodTone("GET")).toBe("success");
    expect(methodTone("POST")).toBe("warning");
    expect(methodTone("PUT")).toBe("info");
    expect(methodTone("DELETE")).toBe("error");
    expect(methodTone("HEAD")).toBe("neutral");
  });

  it("writes a curl for the deployed URL with a token placeholder, and a body for a write", () => {
    const [get, post] = ops();
    expect(curlFor("https://api.dev.example/expense-api-http/", get!)).toBe(
      [
        "curl -X GET 'https://api.dev.example/expense-api-http/expenses'",
        "-H 'Accept: application/json'",
        "-H 'Authorization: Bearer <token>'",
      ].join(" \\\n  "),
    );
    expect(curlFor("https://api.dev.example", post!)).toContain("-H 'Content-Type: application/json' \\\n  -d '{}'");
  });
});

describe("connectionTable", () => {
  const currency: ConnectionRow = {
    id: "external:currency-service",
    name: "currency-service",
    kind: "external",
    config: [{ key: "API_KEY", secret: true }, { key: "BASE_URL" }],
    provisioned: false,
  };
  const db: ConnectionRow = {
    id: "platform-resource:postgres-cnpg:expense-db",
    name: "expense-db",
    kind: "platform-resource",
    detail: "postgres-cnpg",
    config: [],
    provisioned: true,
  };

  // The environments the pipeline serves, as the page reads them.
  const development: EnvironmentInfo = {
    name: "development",
    displayName: "Development",
    isProduction: false,
    validation: "on",
    position: 0,
    promotesTo: "production",
  };
  const production: EnvironmentInfo = {
    name: "production",
    displayName: "Production",
    isProduction: true,
    validation: "off",
    position: 1,
  };

  it("joins type, users and keys onto the readiness state in development", () => {
    const rows = connectionTable(
      [currency, db],
      design,
      { configured: false, dependencies: [{ name: "currency-service", state: "unset", missingKeys: ["API_KEY"] }] },
      development,
      new Set(),
      false,
    );
    expect(rows.map((r) => [r.line.row.name, r.type, r.usedBy, r.keys, r.line.state, r.line.configure])).toEqual([
      ["currency-service", "External", ["expense-api"], ["API_KEY", "BASE_URL"], "missing", true],
      ["expense-db", "postgres-cnpg", ["expense-api"], [], "provisioned", false],
    ]);
  });

  it("reads production as unknown with no Edit — nothing reads or collects values there", () => {
    const rows = connectionTable(
      [currency, db],
      design,
      { configured: true, dependencies: [{ name: "currency-service", state: "configured", missingKeys: [] }] },
      production,
      new Set(),
      false,
    );
    expect(rows[0]?.line).toMatchObject({ state: "unknown", configure: false });
    expect(rows[1]?.line).toMatchObject({ state: "provisioned" });
  });
});
