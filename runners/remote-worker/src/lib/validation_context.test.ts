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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  fetchValidationContext,
  validationContextUrl,
  VALIDATION_CONTEXT_FILE,
} from "./validation_context.js";

const CYCLE = "9d90f001-67bb-4c51-a5f3-7fd808c06c36";
const BEARER = "task-jwt";

async function tmpFile(): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "aep-valctx-"));
  return path.join(dir, "validation-context.json");
}

/** A fetch stub that records the request it was handed. */
function stubFetch(status: number, body: string) {
  const calls: { url: string; auth: string }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(url), auth: headers.get("Authorization") ?? "" });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

// The path is keyed by the CYCLE the runner was dispatched for. It used to be
// /internal/v1/executions/{id}/validation-context, resolved against a table the
// milestone supervisor never writes — a 404 on every validation run.
test("validationContextUrl targets the cycle-scoped validation path", () => {
  assert.equal(
    validationContextUrl("https://bff.example", CYCLE),
    `https://bff.example/internal/v1/validation/${CYCLE}/context`,
  );
  // A trailing slash on AEP_PLATFORM_URL must not double up.
  assert.equal(
    validationContextUrl("https://bff.example/", CYCLE),
    `https://bff.example/internal/v1/validation/${CYCLE}/context`,
  );
});

test("writes the platform's payload verbatim and reports its endpoints", async () => {
  const file = await tmpFile();
  const payload = JSON.stringify({
    endpoints: [{ component: "hello-webapp", url: "https://hello.example" }],
    criteriaPath: "specs/validation/validation-criteria.json",
    somethingNewer: "must survive",
  });
  const { impl, calls } = stubFetch(200, payload);

  const ctx = await fetchValidationContext({
    platformUrl: "https://bff.example",
    cycleId: CYCLE,
    bearer: BEARER,
    file,
    fetchImpl: impl,
  });

  assert.equal(ctx.endpoints.length, 1);
  assert.equal(ctx.endpoints[0]?.url, "https://hello.example");
  assert.equal(calls[0]?.auth, `Bearer ${BEARER}`);
  // Verbatim: the skill's contract is the platform's payload, so a field this
  // runner does not model still reaches it.
  assert.equal(await fs.promises.readFile(file, "utf8"), payload);
});

// The failure that mattered: the platform does not recognise the runner's cycle
// id. This must throw so the caller can exit before the agent starts, rather than
// leave an agent to work out where the app is on its own.
test("a 404 throws and writes nothing", async () => {
  const file = await tmpFile();
  const { impl } = stubFetch(404, '{"code":"not_found","message":"no validation cycle with this id"}');

  await assert.rejects(
    fetchValidationContext({
      platformUrl: "https://bff.example",
      cycleId: CYCLE,
      bearer: BEARER,
      file,
      fetchImpl: impl,
    }),
    /HTTP 404/,
  );
  assert.equal(fs.existsSync(file), false);
});

// Validation is dispatched at deployed-green, so an empty endpoint list means the
// platform cannot say where the system is. "No targets" is precisely the state
// that made the agent start probing, so it is a failure and not an empty success.
test("a context with no endpoints throws", async () => {
  const file = await tmpFile();
  const { impl } = stubFetch(200, JSON.stringify({ endpoints: [], criteriaPath: "x" }));

  await assert.rejects(
    fetchValidationContext({
      platformUrl: "https://bff.example",
      cycleId: CYCLE,
      bearer: BEARER,
      file,
      fetchImpl: impl,
    }),
    /no deployed endpoints/,
  );
  assert.equal(fs.existsSync(file), false);
});

test("an unset platform URL throws before any request", async () => {
  const { impl, calls } = stubFetch(200, "{}");
  await assert.rejects(
    fetchValidationContext({ platformUrl: "", cycleId: CYCLE, bearer: BEARER, fetchImpl: impl }),
    /AEP_PLATFORM_URL is unset/,
  );
  assert.equal(calls.length, 0);
});

// The default target is outside the work tree AND outside `.aep/`, which the base
// skill forbids the agent from reading — it must not have to break that rule to
// find its own targets.
test("the default context file is outside the workspace and outside .aep", () => {
  assert.equal(VALIDATION_CONTEXT_FILE.startsWith("/tmp/"), true);
  assert.equal(VALIDATION_CONTEXT_FILE.includes("/.aep/"), false);
});
