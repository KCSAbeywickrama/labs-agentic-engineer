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
import { apiRetryLine, isStreamFrame, readApiRetry } from "./diagnostics.js";

// The literal wire shape, copied from a live SDK message rather than from the
// type declaration — the reader's job is to survive what actually arrives.
const RETRY = {
  type: "system",
  subtype: "api_retry",
  attempt: 3,
  max_retries: 10,
  retry_delay_ms: 4_200,
  error_status: 529,
  error: "overloaded",
  uuid: "u1",
  session_id: "s1",
};

test("readApiRetry: reads the real wire shape", () => {
  assert.deepEqual(readApiRetry(RETRY), {
    attempt: 3,
    maxRetries: 10,
    retryDelayMs: 4_200,
    errorStatus: 529,
    error: "overloaded",
  });
});

test("readApiRetry: a connection error keeps its null status rather than inventing one", () => {
  // error_status is null for a timeout or a refused connection — the case the
  // dead-endpoint probe produced, and the one most likely to strand a run.
  const info = readApiRetry({ ...RETRY, error_status: null, error: "unknown" });
  assert.equal(info?.errorStatus, null);
  assert.match(apiRetryLine(info!), /no response/);
  assert.doesNotMatch(apiRetryLine(info!), /HTTP/);
});

test("readApiRetry: every other message is not a retry", () => {
  // The run loop asks this of EVERY message, so a false positive would divert
  // real work away from the translator.
  for (const m of [
    { type: "system", subtype: "init" },
    { type: "system", subtype: "task_progress", task_id: "t1" },
    { type: "assistant", message: { content: [] } },
    { type: "result", subtype: "success" },
    { type: "stream_event", event: {} },
    null,
    undefined,
    "api_retry",
    42,
  ]) {
    assert.equal(readApiRetry(m), undefined, `treated as a retry: ${JSON.stringify(m)}`);
  }
});

test("readApiRetry: a renamed field degrades to a usable line, never to NaN", () => {
  // The image ships whatever SDK version it ships. A retry we can only half
  // read is still worth reporting; a line reading "retry NaN/undefined" is not.
  const info = readApiRetry({ type: "system", subtype: "api_retry" });
  assert.deepEqual(info, {
    attempt: 0,
    maxRetries: 0,
    retryDelayMs: 0,
    errorStatus: null,
    error: "unknown",
  });
  assert.doesNotMatch(apiRetryLine(info!), /NaN|undefined/);
});

test("apiRetryLine: names the attempt, the cause and the wait", () => {
  const line = apiRetryLine(readApiRetry(RETRY)!);
  assert.match(line, /retry 3\/10/);
  assert.match(line, /overloaded \(HTTP 529\)/);
  assert.match(line, /next attempt in 4s/);
});

test("isStreamFrame: only the streaming frames", () => {
  assert.ok(isStreamFrame({ type: "stream_event", event: {} }));
  assert.ok(!isStreamFrame({ type: "assistant", message: { content: [] } }));
  assert.ok(!isStreamFrame(RETRY));
  assert.ok(!isStreamFrame(null));
});
