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

// Mock of the two BFF operations this service consumes, so the REAL auth and
// seed code paths run end-to-end while the Go implementations land (#81 /
// #86 phase 2). This is the collab-stack sibling of the console's MSW layer —
// same fixtures, same spirit. Enabled via COLLAB_MOCK_BFF=1; never in cluster.
//
// Behavior contract (kept deliberately boring):
// - GET /api/v1/collab/validate
//     401 without a Bearer token; 403 when the token is literally "deny"
//     (test hook for the rejection path); otherwise 200 with an identity —
//     decoded from the token's JWT payload (name/email claims) when it looks
//     like a JWT, else a fixed mock identity — plus `projectName` resolved
//     from the room ID. The real BFF splits `spec-<org>-<project>` using the
//     caller's org; the mock uses its configured org ("acme" by default).
// - GET /api/v1/projects/{project}/spec
//     200 with the demo-shop fixture bundle for any known project
//     ("demo-shop" by default); 404 otherwise.

import http from "node:http";
import type { SpecFile } from "./bff.js";
import { devSpecBundle } from "./fixtures.js";

export interface MockBffOptions {
  /** Projects that have a spec bundle; others 404. */
  projects?: Record<string, SpecFile[]>;
  /** The org used to split room IDs, like the real oracle does. */
  org?: string;
}

interface MockIdentity {
  name: string;
  email: string;
}

function identityFromToken(token: string): MockIdentity {
  const fallback = { name: "Mock User", email: "mock@localhost" };
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return fallback;
  try {
    const claims = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    return {
      name: typeof claims.name === "string" ? claims.name : fallback.name,
      email: typeof claims.email === "string" ? claims.email : fallback.email,
    };
  } catch {
    return fallback;
  }
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const SPEC_PATH = /^\/api\/v1\/projects\/([^/]+)\/spec$/;

export function createMockBff(options: MockBffOptions = {}): http.Server {
  const projects = options.projects ?? { "demo-shop": devSpecBundle };
  const org = options.org ?? "acme";

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

    if (req.method === "GET" && url.pathname === "/api/v1/collab/validate") {
      if (!token) return json(res, 401, { title: "Unauthorized" });
      if (token === "deny") return json(res, 403, { title: "Forbidden" });
      const room = req.headers["x-room-id"];
      const prefix = `spec-${org}-`;
      if (typeof room !== "string" || !room.startsWith(prefix)) {
        return json(res, 403, { title: "room not in caller org" });
      }
      return json(res, 200, {
        ...identityFromToken(token),
        projectName: room.slice(prefix.length),
      });
    }

    const specMatch = req.method === "GET" && url.pathname.match(SPEC_PATH);
    if (specMatch) {
      if (!token) return json(res, 401, { title: "Unauthorized" });
      const project = decodeURIComponent(specMatch[1] ?? "");
      const files = projects[project];
      if (!files) return json(res, 404, { title: "project not found" });
      return json(res, 200, { files });
    }

    return json(res, 404, { title: "not found" });
  });
}

export function startMockBff(
  port: number,
  options: MockBffOptions = {},
): Promise<http.Server> {
  const server = createMockBff(options);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
