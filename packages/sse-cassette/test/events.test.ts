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
import { CASSETTE_VERSION, type Cassette } from "../src/cassette.js";
import { cassetteEvents } from "../src/events.js";

function makeCassette(chunks: string[]): Cassette {
  return {
    version: CASSETTE_VERSION,
    recordedAt: "2026-01-01T00:00:00.000Z",
    request: { method: "POST", path: "/x/turns", headers: {} },
    response: { status: 200, headers: {} },
    chunks: chunks.map((s, i) => ({
      tMs: i * 100,
      b64: Buffer.from(s, "utf8").toString("base64"),
    })),
  };
}

test("events are ordered with per-frame chunk provenance and completion time", () => {
  const events = cassetteEvents(
    makeCassette([
      // chunk 0 (t=0): one complete frame + the START of a second frame
      'data: {"type":"tool-input-start","id":"t1","toolName":"addFile"}\n\ndata: {"type":"tool-inp',
      // chunk 1 (t=100): continues the split frame
      'ut-delta","id":"t1","delta":"{\\"pa',
      // chunk 2 (t=200): completes it, then a keep-alive comment
      'th\\""}\n\n: keep-alive\n\n',
      // chunk 3 (t=300): two frames arriving together in one chunk
      'data: {"type":"tool-call","toolCallId":"t1","toolName":"addFile","input":{}}\n\ndata: {"type":"finish","finishReason":"stop"}\n\n',
      // chunk 4 (t=400): the sentinel
      "data: [DONE]\n\n",
    ]),
  );

  assert.deepEqual(
    events.map((e) => [e.index, e.kind, e.type ?? e.raw, e.chunkStart, e.chunkEnd, e.tMs]),
    [
      [0, "data", "tool-input-start", 0, 0, 0],
      [1, "data", "tool-input-delta", 0, 2, 200], // spans chunks 0→2, usable at t=200
      [2, "comment", ": keep-alive", 2, 2, 200],
      [3, "data", "tool-call", 3, 3, 300], // two frames from the same chunk…
      [4, "data", "finish", 3, 3, 300], // …share arrival time, keep frame order
      [5, "done", "data: [DONE]", 4, 4, 400],
    ],
  );

  // The split frame's payload survived reassembly.
  assert.equal(events[1]?.part?.delta, '{"pa' + 'th"');
});
