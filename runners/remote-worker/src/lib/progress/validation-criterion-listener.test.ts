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
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { startValidationCriterionListener } from "./validation-criterion-listener.js";
import { _resetEmitterForTesting } from "./emitter.js";

// POST a JSON body to the listener's Unix socket and wait for its ack.
function postToSock(sock: string, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: sock, path: "/criterion", method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Capture the NDJSON lines emit() writes to stdout while fn runs.
async function captureStdout(fn: () => Promise<void>): Promise<string[]> {
  _resetEmitterForTesting();
  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (chunk: string | Uint8Array): boolean => {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  };
  try {
    await fn();
  } finally {
    (process.stdout as { write: unknown }).write = original;
  }
  return lines.join("").split("\n").filter(Boolean);
}

function tmpSock(name: string): string {
  return path.join(os.tmpdir(), `aep-crit-test-${process.pid}-${name}.sock`);
}

test("criterion-listener: a POST emits a kind:criterion stdout line (live sink)", async () => {
  const sock = tmpSock("emit");
  await fs.promises.rm(sock, { force: true });
  // platformURL "" → sink 2 (durable POST) no-ops; we assert the live sink only.
  const listener = await startValidationCriterionListener(sock, { platformURL: "", taskId: "t", bearer: "" });

  const lines = await captureStdout(async () => {
    const code = await postToSock(sock, JSON.stringify({ criterionId: "AC-001-a", status: "validating", requirementId: "REQ-001" }));
    assert.equal(code, 204, "listener must ack 204");
    // The emit fan-out is scheduled after the ack; yield a tick for it.
    await new Promise((r) => setTimeout(r, 20));
  });

  await listener.close();
  const criterionLines = lines.map((l) => JSON.parse(l)).filter((e) => e.kind === "criterion");
  assert.equal(criterionLines.length, 1, `want 1 criterion line, got ${lines.join("|")}`);
  const ev = criterionLines[0];
  assert.equal(ev.step, "AC-001-a");
  assert.equal(ev.status, "validating");
  assert.equal(ev.summary, "REQ-001");
  assert.equal(ev.schemaVersion, 1);
});

test("criterion-listener: malformed / incomplete payloads emit nothing", async () => {
  const sock = tmpSock("bad");
  await fs.promises.rm(sock, { force: true });
  const listener = await startValidationCriterionListener(sock, { platformURL: "", taskId: "t", bearer: "" });

  const lines = await captureStdout(async () => {
    await postToSock(sock, "not json");
    await postToSock(sock, JSON.stringify({ criterionId: "", status: "passed" })); // blank id
    await postToSock(sock, JSON.stringify({ criterionId: "AC-001-a", status: "weird" })); // bad status
    await new Promise((r) => setTimeout(r, 20));
  });

  await listener.close();
  const criterionLines = lines.map((l) => JSON.parse(l)).filter((e) => e.kind === "criterion");
  assert.equal(criterionLines.length, 0, `want no criterion lines, got ${lines.join("|")}`);
});
