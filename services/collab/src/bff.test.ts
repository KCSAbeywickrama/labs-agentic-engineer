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
import {
  ApplyAuthError,
  ApplyConflictError,
  createBffClient,
} from "./bff.js";

test("applyFiles throws ApplyAuthError on 401", async () => {
  const bff = createBffClient("http://bff", async () =>
    new Response("nope", { status: 401 }),
  );
  await assert.rejects(
    () => bff.applyFiles("t", "proj", { writes: [], deletes: [], message: "m" }),
    (e: unknown) => e instanceof ApplyAuthError && e.status === 401,
  );
});

test("applyFiles throws ApplyAuthError on 403", async () => {
  const bff = createBffClient("http://bff", async () =>
    new Response("forbidden", { status: 403 }),
  );
  await assert.rejects(
    () => bff.applyFiles("t", "proj", { writes: [], deletes: [], message: "m" }),
    (e: unknown) =>
      e instanceof ApplyAuthError &&
      e.status === 403 &&
      e.message.includes("forbidden"),
  );
});

test("applyFiles still throws ApplyConflictError on 409", async () => {
  const bff = createBffClient("http://bff", async () =>
    new Response(JSON.stringify({ conflicts: [{ path: "a.md" }] }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    }),
  );
  await assert.rejects(
    () => bff.applyFiles("t", "proj", { writes: [], deletes: [], message: "m" }),
    (e: unknown) =>
      e instanceof ApplyConflictError && e.paths.includes("a.md"),
  );
});
