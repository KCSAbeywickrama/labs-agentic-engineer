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

// Loopback reverse-proxy in front of POST /internal/v1/mcp.
//
// The Claude Agent SDK's HTTP MCP config only accepts static headers, so a
// token minted at query() construction time cannot rotate. This proxy is the
// SDK's MCP URL; it attaches a live bearer (ClientCredentialsTokenProvider
// or a snapshot) and runs fetchWith401Retry. Local and cloud use the same
// proxy — canRefresh is true iff publisher CC creds were mounted, not iff
// the platform URL is https.

import http from "node:http";
import type { AddressInfo } from "node:net";
import { FatalAuthError, fetchWith401Retry, type AccessTokenSource } from "./auth_retry.js";

export interface McpAuthProxy {
  url: string;
  close: () => Promise<void>;
}

export interface StartMcpAuthProxyOpts {
  upstreamUrl: string;
  source: AccessTokenSource;
  canRefresh: boolean;
  onToken?: (token: string) => void | Promise<void>;
  onFatal: (err: FatalAuthError) => void;
}

const HOP = new Set(["host", "connection", "transfer-encoding", "keep-alive", "authorization", "content-length"]);

export async function startMcpAuthProxy(opts: StartMcpAuthProxyOpts): Promise<McpAuthProxy> {
  const server = http.createServer((req, res) => {
    void handle(req, res, opts);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}/`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: StartMcpAuthProxyOpts,
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of req) {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  }
  const body = Buffer.concat(chunks);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || HOP.has(k.toLowerCase())) continue;
    headers[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  try {
    const upstream = await fetchWith401Retry(
      opts.upstreamUrl,
      {
        method: req.method,
        headers,
        body: body.length > 0 ? body : undefined,
      },
      { source: opts.source, canRefresh: opts.canRefresh, onToken: opts.onToken },
    );
    const outHeaders: Record<string, string> = {};
    upstream.headers.forEach((value, key) => {
      if (key.toLowerCase() === "transfer-encoding") return;
      outHeaders[key] = value;
    });
    res.writeHead(upstream.status, outHeaders);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    if (err instanceof FatalAuthError) {
      opts.onFatal(err);
      res.writeHead(401, { "content-type": "text/plain" });
      res.end("unauthorized");
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(msg);
  }
}
