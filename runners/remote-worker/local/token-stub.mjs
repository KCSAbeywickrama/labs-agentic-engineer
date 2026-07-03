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

// Local-dev credential stub. Stands in for the platform's
// credentials/refresh endpoint so the runner can be exercised without
// the BFF/git-service:
//
//   POST /internal/v1/tasks/{taskId}/credentials/refresh
//     -> { "token": $GITHUB_PAT, "taskId": <echoed from path> }
//
// The taskId echo satisfies credhelper.sh's anti-misroute tripwire.
// Identity fields are deliberately omitted so the runner keeps the
// AEP_IDENTITY_* values it was launched with (no drift rewrite).
//
// SECURITY: every response carries a real GitHub PAT. Keep the bind
// address on loopback (the default) and never expose this beyond your
// machine.

import http from "node:http";

const pat = process.env.GITHUB_PAT ?? "";
if (pat === "") {
  console.error("[token-stub] GITHUB_PAT is not set");
  process.exit(1);
}
const port = Number(process.env.STUB_PORT || 8377);
const bind = process.env.STUB_BIND || "127.0.0.1";

const REFRESH_RE = /^\/internal\/v1\/tasks\/([^/]+)\/credentials\/refresh$/;

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/healthz") {
    res.writeHead(200).end("ok");
    return;
  }
  const m = req.method === "POST" ? REFRESH_RE.exec(url.pathname) : null;
  if (!m) {
    console.error(`[token-stub] 404 ${req.method} ${url.pathname}`);
    res
      .writeHead(404, { "Content-Type": "application/json" })
      .end('{"error":"not found"}');
    return;
  }
  const taskId = decodeURIComponent(m[1]);
  console.error(`[token-stub] 200 refresh for task ${taskId}`);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ token: pat, taskId }));
});

server.listen(port, bind, () => {
  console.error(`[token-stub] listening on http://${bind}:${port}`);
});
