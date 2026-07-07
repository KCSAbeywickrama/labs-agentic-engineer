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
import { pullTaskSkillsWithRetry, type PullArgs, type SkillsPullResponse } from "./skills_pull.js";

const ARGS: PullArgs = { platformURL: "http://aep-api:9090", taskId: "exec-1", bearer: "b" };
const OK: SkillsPullResponse = { skills: [] };

test("pullTaskSkillsWithRetry: first-attempt success adds no sleeps", async () => {
  const sleeps: number[] = [];
  let calls = 0;
  const res = await pullTaskSkillsWithRetry(ARGS, {
    attempt: async () => {
      calls++;
      return OK;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    log: () => {},
  });
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
  assert.equal(res, OK);
});

test("pullTaskSkillsWithRetry: retries a transient failure then succeeds, backing off between attempts", async () => {
  const sleeps: number[] = [];
  let calls = 0;
  const res = await pullTaskSkillsWithRetry(ARGS, {
    backoffMs: [2000, 5000, 10000],
    attempt: async () => {
      calls++;
      if (calls < 3) throw new Error(`skills endpoint returned 404 (attempt ${calls})`);
      return OK;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    log: () => {},
  });
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [2000, 5000]); // two backoffs before the 3rd attempt
  assert.equal(res, OK);
});

test("pullTaskSkillsWithRetry: exhausts all attempts then throws the last error", async () => {
  const sleeps: number[] = [];
  let calls = 0;
  await assert.rejects(
    pullTaskSkillsWithRetry(ARGS, {
      backoffMs: [2000, 5000, 10000],
      attempt: async () => {
        calls++;
        throw new Error(`fail ${calls}`);
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      log: () => {},
    }),
    /fail 4/,
  );
  assert.equal(calls, 4); // 1 initial + 3 retries
  assert.deepEqual(sleeps, [2000, 5000, 10000]); // backoff before attempts 2, 3, 4
});

test("pullTaskSkillsWithRetry: logs each attempt outcome", async () => {
  const lines: string[] = [];
  let calls = 0;
  await pullTaskSkillsWithRetry(ARGS, {
    backoffMs: [1, 1],
    attempt: async () => {
      calls++;
      if (calls < 2) throw new Error("boom");
      return OK;
    },
    sleep: async () => {},
    log: (l) => lines.push(l),
  });
  assert.equal(lines.length, 2); // one failure line + one success line
  assert.match(lines[0], /attempt 1\/3 failed \(boom\) — retrying in 1ms/);
  assert.match(lines[1], /succeeded on attempt 2\/3/);
});

test("pullTaskSkillsWithRetry: retries on network errors too (not just non-200)", async () => {
  let calls = 0;
  const res = await pullTaskSkillsWithRetry(ARGS, {
    backoffMs: [1, 1, 1],
    attempt: async () => {
      calls++;
      if (calls < 4) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      return OK;
    },
    sleep: async () => {},
    log: () => {},
  });
  assert.equal(calls, 4);
  assert.equal(res, OK);
});
