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
 * In-process MOCK of aep-api's dependency-discovery MCP server
 * (`aep-api/internal/feature/dependencies/mcp_server.go` + `mcp_tools.go`) for
 * the eval tree. Speaks the same JSON-RPC subset (`initialize` accepted but not
 * required, `tools/list`, `tools/call` with `{ name, arguments }`, text-content
 * JSON results) and the same four read-only tools, over a DETERMINISTIC catalog:
 *
 *   - one external resource  `openweather`  (config key `OPENWEATHER_API_KEY`, secret)
 *   - one org endpoint       `employee-api` (project `hr-directory`, namespace-visible)
 *   - one resource type      `postgres-cnpg` (params version/storageGB/instances;
 *                                              outputs host/port/username/password/database)
 *
 * Used by both the deterministic eval tree (`test:eval` — proves the mock +
 * `loadMcpTools` client plumbing without a live model) and the live-model `eval`
 * suite (`cli.ts` boots one instance and pushes its `{ url, token }` as `mcp` on
 * every turn, standing in for the real aep-api server this repo doesn't run).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { listen0, type Listening } from "../../src/shared/listen.js";

export interface ConfigKeyView {
  key: string;
  secret: boolean;
}

export interface ExternalResourceView {
  name: string;
  description?: string;
  configKeys: ConfigKeyView[];
}

export interface OrgEndpointView {
  name: string;
  project: string;
  endpoint: string;
  type: string;
  namespaceVisible: boolean;
}

export interface ResourceTypeView {
  name: string;
  params: Record<string, string>;
  outputs: string[];
}

// --- The deterministic catalog -----------------------------------------------

export const EXTERNAL_RESOURCES: ExternalResourceView[] = [
  {
    name: "openweather",
    description: "OpenWeather current-conditions API",
    configKeys: [{ key: "OPENWEATHER_API_KEY", secret: true }],
  },
];

export const ORG_ENDPOINTS: OrgEndpointView[] = [
  { name: "employee-api", project: "hr-directory", endpoint: "employee-api", type: "HTTP", namespaceVisible: true },
];

export const RESOURCE_TYPES: ResourceTypeView[] = [
  {
    name: "postgres-cnpg",
    params: { version: "string", storageGB: "number", instances: "number" },
    outputs: ["host", "port", "username", "password", "database"],
  },
];

// --- tools/list descriptors (mirrors mcpTools() in mcp_tools.go) ------------

function mcpTools(): { name: string; description: string; inputSchema: unknown }[] {
  return [
    {
      name: "list_external_resources",
      description:
        "List the external resources (third-party APIs/services) already registered in this organization. Use " +
        "this BEFORE proposing an `external` dependency so you reuse an existing name + config-key schema.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_external_resource_schema",
      description: "Get the config-key schema for one registered external resource by name.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", description: "external resource name" } },
        required: ["name"],
      },
    },
    {
      name: "list_org_endpoints",
      description:
        "List the service endpoints published by OTHER projects in this organization — the catalog of " +
        "`org-service` dependency targets. Only propose one when `namespaceVisible` is true.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_platform_resource_types",
      description: "List the platform-provisioned resource types (databases, caches, queues) on the cluster.",
      inputSchema: { type: "object", properties: {} },
    },
  ];
}

// --- tools/call dispatch -----------------------------------------------------

interface ToolCallResult {
  content: { type: "text"; text: string }[];
  isError?: true;
}

function textResult(value: unknown): ToolCallResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function errorResult(text: string): ToolCallResult {
  return { content: [{ type: "text", text }], isError: true };
}

function callTool(name: string, args: Record<string, unknown>): ToolCallResult {
  switch (name) {
    case "list_external_resources":
      return textResult({ externalResources: EXTERNAL_RESOURCES });
    case "get_external_resource_schema": {
      const wanted = typeof args.name === "string" ? args.name : "";
      if (!wanted) return errorResult("missing required argument: name");
      const found = EXTERNAL_RESOURCES.find((r) => r.name === wanted);
      return found
        ? textResult({ found: true, externalResource: found })
        : textResult({ found: false, name: wanted });
    }
    case "list_org_endpoints":
      return textResult({ endpoints: ORG_ENDPOINTS });
    case "list_platform_resource_types":
      return textResult({ resourceTypes: RESOURCE_TYPES });
    default:
      return errorResult(`unknown tool: ${name}`);
  }
}

// --- The JSON-RPC http server -------------------------------------------------

export interface MockMcpServer extends Listening {
  /** Bearer token this instance accepts; a mismatch responds 401. */
  token: string;
  /** Every JSON-RPC method invoked so far, in order — asserted by tests. */
  calls: string[];
}

interface JsonRpcBody {
  id?: unknown;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c));
    req.on("end", () => resolve(raw));
  });
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

/** Start a fresh mock MCP server on an ephemeral port. Call `close()` when done. */
export async function startMockMcpServer(opts: { token?: string } = {}): Promise<MockMcpServer> {
  const token = opts.token ?? "mock-mcp-token";
  const calls: string[] = [];

  const server = createServer((req, res) => {
    void (async () => {
      if (req.headers.authorization !== `Bearer ${token}`) {
        writeJson(res, 401, { error: "unauthorized" });
        return;
      }
      const raw = await readBody(req);
      let body: JsonRpcBody;
      try {
        body = raw ? (JSON.parse(raw) as JsonRpcBody) : {};
      } catch {
        writeJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
        return;
      }
      const { id, method, params } = body;
      if (method) calls.push(method);

      // Notifications (no id) get a 202 with no body — e.g. notifications/initialized.
      if (id === undefined) {
        res.writeHead(202);
        res.end();
        return;
      }

      switch (method) {
        case "initialize":
          writeJson(res, 200, {
            jsonrpc: "2.0",
            id,
            result: { protocolVersion: "2024-11-05", capabilities: { tools: {} } },
          });
          return;
        case "ping":
          writeJson(res, 200, { jsonrpc: "2.0", id, result: {} });
          return;
        case "tools/list":
          writeJson(res, 200, { jsonrpc: "2.0", id, result: { tools: mcpTools() } });
          return;
        case "tools/call":
          writeJson(res, 200, {
            jsonrpc: "2.0",
            id,
            result: callTool(params?.name ?? "", params?.arguments ?? {}),
          });
          return;
        default:
          writeJson(res, 200, { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
      }
    })();
  });

  const { baseUrl, close } = await listen0(server.listen(0));
  return { baseUrl, close, token, calls };
}
