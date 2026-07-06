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
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createMcpResolver } from "./mcp.js";
import { listen0 } from "../src/shared/listen.js";

type Handler = (req: IncomingMessage, res: ServerResponse, body: unknown) => void;

/** A tiny http server driven by a per-test handler — mirrors src/shared/mcp-client.test.ts. */
async function fakeServer(handle: Handler) {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c));
    req.on("end", () => {
      let body: unknown;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = undefined;
      }
      handle(req, res, body);
    });
  });
  return listen0(server.listen(0));
}

function jsonOk(res: ServerResponse, payload: unknown): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

test("neither AEP_MCP_URL nor AEP_MCP_TOKEN set → resolves undefined, no fetch attempted", async () => {
  const resolver = createMcpResolver({}, () => assert.fail("must not warn"));
  assert.equal(await resolver.resolve(), undefined);
});

test("AEP_MCP_TOKEN set wins verbatim — never mints, even when a mint endpoint is reachable", async () => {
  const hits: unknown[] = [];
  const { baseUrl, close } = await fakeServer((_req, res, body) => {
    hits.push(body);
    jsonOk(res, { token: "should-not-be-used" });
  });
  try {
    const resolver = createMcpResolver({ url: baseUrl, token: "operator-token" }, () => assert.fail("must not warn"));
    const mcp = await resolver.resolve();
    assert.deepEqual(mcp, { url: baseUrl, token: "operator-token" });
    assert.equal(hits.length, 0, "token-env must win without ever calling the mint endpoint");
  } finally {
    await close();
  }
});

test("AEP_MCP_TOKEN unset, AEP_MCP_URL set → auto-mints against {url}/playground-token with the org body", async () => {
  const seen: { url?: string | undefined; body?: unknown } = {};
  const { baseUrl, close } = await fakeServer((req, res, body) => {
    seen.url = req.url;
    seen.body = body;
    jsonOk(res, { token: "minted-abc", expiresInSeconds: 300 });
  });
  try {
    const resolver = createMcpResolver({ url: baseUrl, org: "acme" }, () => assert.fail("must not warn"));
    const mcp = await resolver.resolve();
    assert.deepEqual(mcp, { url: baseUrl, token: "minted-abc" });
    assert.equal(seen.url, "/playground-token", "must POST to {AEP_MCP_URL}/playground-token");
    assert.deepEqual(seen.body, { orgHandle: "acme" });
  } finally {
    await close();
  }
});

test("org defaults to \"default\" when AEP_MCP_ORG is unset", async () => {
  const seen: { body?: unknown } = {};
  const { baseUrl, close } = await fakeServer((_req, res, body) => {
    seen.body = body;
    jsonOk(res, { token: "minted-xyz" });
  });
  try {
    const resolver = createMcpResolver({ url: baseUrl }, () => assert.fail("must not warn"));
    await resolver.resolve();
    assert.deepEqual(seen.body, { orgHandle: "default" });
  } finally {
    await close();
  }
});

test("mints fresh on every call — two resolve() calls hit the mint endpoint twice, no caching", async () => {
  let count = 0;
  const { baseUrl, close } = await fakeServer((_req, res) => {
    count += 1;
    jsonOk(res, { token: `minted-${count}` });
  });
  try {
    const resolver = createMcpResolver({ url: baseUrl }, () => assert.fail("must not warn"));
    const first = await resolver.resolve();
    const second = await resolver.resolve();
    assert.equal(count, 2, "each resolve() call must re-mint, never reuse a cached token");
    assert.equal(first?.token, "minted-1");
    assert.equal(second?.token, "minted-2");
  } finally {
    await close();
  }
});

test("mint failure (non-2xx) degrades to undefined and warns exactly once across repeated calls", async () => {
  const { baseUrl, close } = await fakeServer((_req, res) => {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "boom" }));
  });
  const warnings: string[] = [];
  try {
    const resolver = createMcpResolver({ url: baseUrl }, (msg) => warnings.push(msg));
    const first = await resolver.resolve();
    const second = await resolver.resolve();
    assert.equal(first, undefined);
    assert.equal(second, undefined);
    assert.equal(warnings.length, 1, `expected exactly one warning, got ${warnings.length}: ${warnings.join(" | ")}`);
  } finally {
    await close();
  }
});

test("mint failure (network error — server unreachable) degrades to undefined and warns once", async () => {
  // Port 1 is never listening — fetch rejects (ECONNREFUSED-equivalent).
  const warnings: string[] = [];
  const resolver = createMcpResolver({ url: "http://127.0.0.1:1" }, (msg) => warnings.push(msg));
  const mcp = await resolver.resolve();
  assert.equal(mcp, undefined);
  assert.equal(warnings.length, 1);
});
