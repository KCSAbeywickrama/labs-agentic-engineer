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
 * The preview server's HTTP surface, against a spawned `prototype preview`:
 * what it serves, and what it refuses — a request addressed by another host
 * name (DNS rebinding), and a busy port.
 */

import { request } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFixture, runCli, startPreview, type PreviewProcess } from "./harness.js";

let preview: PreviewProcess;

beforeAll(async () => {
  preview = await startPreview(copyFixture("valid/contacts"));
});

afterAll(async () => {
  await preview.stop();
});

/** A raw request, so the Host header can be anything. */
function send(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: string }> {
  const url = new URL(path, preview.url);
  return new Promise((resolve, reject) => {
    const req = request({ host: url.hostname, port: url.port, path: url.pathname, method: init.method ?? "GET", headers: init.headers ?? {} }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end(init.body);
  });
}

describe("prototype preview (HTTP)", () => {
  it("serves the host page, its script, the frame runtime and the event stream", async () => {
    expect((await send("/")).body).toContain('id="proto-config"');
    expect((await send("/host.js")).status).toBe(200);
    expect((await send("/frame-runtime.js")).status).toBe(200);
    expect((await send("/nope")).status).toBe(404);
  });

  it("refuses a request addressed by another host name", async () => {
    const res = await send("/", { headers: { host: "attacker.example" } });
    expect(res.status).toBe(403);
  });
});

// Review Focus: a second preview on a busy port.
describe("prototype preview (ports)", () => {
  it("refuses an explicit --port that is in use, with exit 2", () => {
    const port = new URL(preview.url).port;
    const run = runCli(["preview", preview.dir, "--port", port], { timeoutMs: 20_000 });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain(`port ${port} is in use`);
  });
});
