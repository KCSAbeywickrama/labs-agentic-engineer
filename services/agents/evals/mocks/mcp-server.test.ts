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
 * Deterministic (no-tokens) eval-tree test: proves the mock MCP server's
 * catalog AND the `loadMcpTools` client plumbing together, so the live-model
 * `eval` cases (weather-app / org-service / database) only need to add the
 * model's behavior on top of an already-proven transport.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMcpTools } from "../../src/shared/mcp-client.js";
import { startMockMcpServer } from "./mcp-server.js";

test("tools/list advertises the four read-only dependency-discovery tools", async () => {
  const mock = await startMockMcpServer();
  try {
    const tools = await loadMcpTools({ url: mock.baseUrl, token: mock.token });
    assert.deepEqual(
      Object.keys(tools).sort(),
      ["get_external_resource_schema", "list_external_resources", "list_org_endpoints", "list_platform_resource_types"].sort(),
    );
  } finally {
    await mock.close();
  }
});

test("list_external_resources returns the deterministic openweather catalog", async () => {
  const mock = await startMockMcpServer();
  try {
    const tools = await loadMcpTools({ url: mock.baseUrl, token: mock.token });
    const raw = await tools.list_external_resources!.execute!({}, {} as never);
    const parsed = JSON.parse(String(raw)) as { externalResources: { name: string; configKeys: { key: string; secret: boolean }[] }[] };
    assert.equal(parsed.externalResources.length, 1);
    assert.equal(parsed.externalResources[0]?.name, "openweather");
    assert.deepEqual(parsed.externalResources[0]?.configKeys, [{ key: "OPENWEATHER_API_KEY", secret: true }]);
  } finally {
    await mock.close();
  }
});

test("get_external_resource_schema: found:true for openweather, found:false for an unknown name", async () => {
  const mock = await startMockMcpServer();
  try {
    const tools = await loadMcpTools({ url: mock.baseUrl, token: mock.token });
    const exec = tools.get_external_resource_schema!.execute!;

    const hit = JSON.parse(String(await exec({ name: "openweather" }, {} as never))) as { found: boolean };
    assert.equal(hit.found, true);

    const miss = JSON.parse(String(await exec({ name: "nope" }, {} as never))) as { found: boolean };
    assert.equal(miss.found, false);
  } finally {
    await mock.close();
  }
});

test("list_org_endpoints returns the namespace-visible employee-api endpoint", async () => {
  const mock = await startMockMcpServer();
  try {
    const tools = await loadMcpTools({ url: mock.baseUrl, token: mock.token });
    const raw = await tools.list_org_endpoints!.execute!({}, {} as never);
    const parsed = JSON.parse(String(raw)) as {
      endpoints: { name: string; project: string; namespaceVisible: boolean }[];
    };
    assert.equal(parsed.endpoints.length, 1);
    assert.equal(parsed.endpoints[0]?.name, "employee-api");
    assert.equal(parsed.endpoints[0]?.project, "hr-directory");
    assert.equal(parsed.endpoints[0]?.namespaceVisible, true);
  } finally {
    await mock.close();
  }
});

test("list_platform_resource_types returns postgres-cnpg with its params + outputs", async () => {
  const mock = await startMockMcpServer();
  try {
    const tools = await loadMcpTools({ url: mock.baseUrl, token: mock.token });
    const raw = await tools.list_platform_resource_types!.execute!({}, {} as never);
    const parsed = JSON.parse(String(raw)) as {
      resourceTypes: { name: string; params: Record<string, string>; outputs: string[] }[];
    };
    assert.equal(parsed.resourceTypes.length, 1);
    const pg = parsed.resourceTypes[0]!;
    assert.equal(pg.name, "postgres-cnpg");
    assert.deepEqual(pg.params, { version: "string", storageGB: "number", instances: "number" });
    assert.deepEqual(pg.outputs, ["host", "port", "username", "password", "database"]);
  } finally {
    await mock.close();
  }
});

test("a wrong bearer token degrades to an empty tool set (mirrors the expired-token case)", async () => {
  const mock = await startMockMcpServer({ token: "correct" });
  try {
    const tools = await loadMcpTools({ url: mock.baseUrl, token: "wrong" });
    assert.deepEqual(tools, {});
  } finally {
    await mock.close();
  }
});

test("records the JSON-RPC methods invoked, in order (tools/list then tools/call)", async () => {
  const mock = await startMockMcpServer();
  try {
    const tools = await loadMcpTools({ url: mock.baseUrl, token: mock.token });
    await tools.list_org_endpoints!.execute!({}, {} as never);
    assert.deepEqual(mock.calls, ["tools/list", "tools/call"]);
  } finally {
    await mock.close();
  }
});
