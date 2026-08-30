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

import { createServer, type Server } from "node:http";

export interface StubCall {
  method: string;
  path: string;
  operationId?: string | undefined;
}

interface Op {
  operationId?: string | undefined;
  example: unknown;
}

/** Index the contract by `METHOD path` so a request is one lookup. */
function indexOperations(spec: unknown): Map<string, Op> {
  const out = new Map<string, Op>();
  const paths = (spec as { paths?: Record<string, Record<string, unknown>> })?.paths ?? {};
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, opRaw] of Object.entries(methods)) {
      const op = opRaw as {
        operationId?: string;
        responses?: Record<string, { content?: Record<string, { example?: unknown }> }>;
      };
      const example = op.responses?.["200"]?.content?.["application/json"]?.example ?? [];
      out.set(`${method.toUpperCase()} ${path}`, { operationId: op.operationId, example });
    }
  }
  return out;
}

/**
 * A provider component's contract, served from its own declared examples.
 *
 * The world an evaluation runs in must be FIXED: the same prompt against the
 * same stubs twice must produce the same tool calls, or a score change cannot
 * be attributed to the prompt. Serving the contract's `example` also keeps the
 * fixture honest — it is what the provider itself documents, not data invented
 * for the test.
 */
export async function startStubServer(spec: unknown): Promise<{
  url: string;
  calls: StubCall[];
  close: () => Promise<void>;
}> {
  const ops = indexOperations(spec);
  const calls: StubCall[] = [];

  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0]!;
    const op = ops.get(`${(req.method ?? "GET").toUpperCase()} ${path}`);
    calls.push({ method: req.method ?? "GET", path, operationId: op?.operationId });
    res.setHeader("content-type", "application/json");
    if (!op) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "no such operation in the contract" }));
      return;
    }
    res.end(JSON.stringify(op.example));
  });

  // Port 0: the OS assigns a free port, so parallel test files never collide.
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
