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

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { emit, _resetEmitterForTesting } from "./emitter.js";

// The emitter writes to the real stdout — that IS the progress feed — so these
// capture the fd and assert on the bytes a reader would actually get.
let captured: string[] = [];
let restore: (() => void) | undefined;

beforeEach(() => {
  captured = [];
  _resetEmitterForTesting();
  const original = process.stdout.write.bind(process.stdout);
  restore = () => {
    process.stdout.write = original;
  };
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  restore?.();
  restore = undefined;
});

function emitted(): string {
  assert.equal(captured.length, 1, `expected one line, got ${captured.length}`);
  return captured[0]!.replace(/\n$/, "");
}

// A header-shaped secret with NO space after the colon is the shape that used
// to break the envelope: the scrubber's `(\S+)` ran past the token into the
// JSON syntax behind it. Scrubbing values before serializing is what stops it.
test("a header secret at the end of a field cannot break the envelope", () => {
  emit({
    kind: "tool_use",
    tool: "Bash",
    summary: "curl -H authorization:sk-live-abcdefgh",
  });

  const line = emitted();
  const parsed = JSON.parse(line); // used to throw "Unterminated string in JSON"
  assert.equal(parsed.kind, "tool_use");
  assert.ok(!line.includes("sk-live-abcdefgh"), `token leaked: ${line}`);
});

// The quieter half of the same bug: with fields AFTER the match the greedy run
// ate those instead, so the line still parsed but arrived stripped of the
// attribution that groups it under its subagent.
test("a header secret does not swallow the fields after it", () => {
  emit({
    kind: "tool_use",
    tool: "Bash",
    summary: "curl -H authorization:sk-live-abcdefgh",
    toolUseId: "toolu_01ABC",
    emitter: "subagent",
    emitterId: "toolu_01PARENT",
    emitterLabel: "Build maintenance-api Ballerina service",
  });

  const parsed = JSON.parse(emitted());
  assert.equal(parsed.toolUseId, "toolu_01ABC");
  assert.equal(parsed.emitterId, "toolu_01PARENT");
  assert.equal(parsed.emitterLabel, "Build maintenance-api Ballerina service");
});

test("x-api-key at a field boundary keeps the envelope intact", () => {
  emit({ kind: "tool_use", tool: "Bash", summary: "grep x-api-key:abc123def456", toolUseId: "toolu_01XYZ" });

  const parsed = JSON.parse(emitted());
  assert.equal(parsed.toolUseId, "toolu_01XYZ");
  assert.ok(!parsed.summary.includes("abc123def456"));
});

// Nested strings are walked too, so a field added to the schema later is
// covered without anyone remembering to opt in.
test("nested values survive the walk and stay typed", () => {
  emit({
    kind: "result",
    status: "success",
    summary: "done",
    usage: {
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      model: "claude-opus-5",
      models: [
        {
          model: "claude-opus-5",
          inputTokens: 100,
          outputTokens: 200,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
      ],
    },
  });

  const parsed = JSON.parse(emitted());
  assert.equal(parsed.usage.inputTokens, 100, "numbers must not become strings");
  assert.equal(parsed.usage.model, "claude-opus-5");
  assert.equal(parsed.usage.models[0].outputTokens, 200);
});

test("ordinary output is untouched and still stamped", () => {
  emit({ kind: "phase", phase: "coding" });

  const parsed = JSON.parse(emitted());
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.seq, 1);
  assert.equal(parsed.phase, "coding");
  assert.ok(typeof parsed.ts === "string" && parsed.ts.length > 0);
});
