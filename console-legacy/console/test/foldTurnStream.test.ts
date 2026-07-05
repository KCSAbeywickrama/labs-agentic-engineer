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
 * Synthetic-stream tests for the transport-free fold: failure modes that are
 * awkward to capture live (mid-turn disconnects, missing tool-input-start)
 * built frame by frame. Recorded-cassette replays live in turnCassettes.test.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldTurnStream } from '../src/services/api/turnStream';

const encoder = new TextEncoder();

function sse(frames: (object | string)[], opts: { done?: boolean } = {}): ReadableStream<Uint8Array> {
  const lines = frames.map((f) => `data: ${typeof f === 'string' ? f : JSON.stringify(f)}\n\n`);
  if (opts.done !== false) lines.push('data: [DONE]\n\n');
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < lines.length) controller.enqueue(encoder.encode(lines[i++]));
      else controller.close();
    },
  });
}

const addFileCall = (path: string, content: string, id = 'tool-1') => [
  { type: 'tool-input-start', id, toolName: 'addFile' },
  { type: 'tool-input-delta', id, delta: JSON.stringify({ path, content }) },
  { type: 'tool-call', toolCallId: id, toolName: 'addFile', input: { path, content } },
  { type: 'tool-result', toolCallId: id, toolName: 'addFile', input: { path, content }, output: { ok: true, op: 'add', path } },
];

test('a complete turn folds files and is not truncated', async () => {
  const result = await foldTurnStream(
    sse([
      ...addFileCall('specs/requirements/requirements.md', '# Reqs\n'),
      { type: 'finish', finishReason: 'stop' },
    ]),
    {},
    {},
    { previewThrottleMs: 0 },
  );
  assert.ok(result.ok);
  assert.equal(result.files['specs/requirements/requirements.md'], '# Reqs\n');
  assert.equal(result.truncated, undefined);
});

// F1 — a stream that dies before `[DONE]` (network drop / BFF passthrough
// upstream failure) must NOT report a clean success: the fold is incomplete.
test('a mid-turn disconnect (no finish, no [DONE]) surfaces as truncated', async () => {
  const partialInput = JSON.stringify({
    path: 'specs/requirements/requirements.md',
    content: 'only half of the file arrived and then the connect',
  }).slice(0, -20); // input JSON never closes — no tool-call frame ever arrives
  const result = await foldTurnStream(
    sse(
      [
        { type: 'tool-input-start', id: 'tool-1', toolName: 'addFile' },
        { type: 'tool-input-delta', id: 'tool-1', delta: partialInput },
        // …connection dies here: no error frame, no finish, no [DONE].
      ],
      { done: false },
    ),
    {},
    {},
    { previewThrottleMs: 0 },
  );
  assert.ok(result.ok, 'a disconnect still returns the salvaged fold');
  assert.equal(result.truncated, true, 'an incomplete stream must be flagged truncated');
  assert.match(
    result.files['specs/requirements/requirements.md'] ?? '',
    /only half of the file/,
    'the partial addFile body is salvaged',
  );
});

// F1 — even when every tool-call closed cleanly, a missing finish/[DONE]
// means the turn did not run to completion.
test('eof after clean tool-calls but before finish is still truncated', async () => {
  const result = await foldTurnStream(
    sse([...addFileCall('specs/design/design.md', '# Design\n')], { done: false }),
    {},
    {},
    { previewThrottleMs: 0 },
  );
  assert.ok(result.ok);
  assert.equal(result.files['specs/design/design.md'], '# Design\n');
  assert.equal(result.truncated, true, 'no finish + no [DONE] ⇒ truncated');
});

// F2 — some providers/SDK versions omit `tool-input-start` (or carry the id
// only on the deltas). The live preview must prime itself from the first
// delta instead of showing nothing until the turn ends.
test('preview primes from tool-input-delta even without tool-input-start', async () => {
  const snapshots: Record<string, string>[] = [];
  const body = JSON.stringify({ path: 'specs/requirements/requirements.md', content: 'streaming body' });
  const mid = Math.floor(body.length / 2);
  const result = await foldTurnStream(
    sse([
      // NOTE: no tool-input-start frame at all.
      { type: 'tool-input-delta', id: 'tool-9', delta: body.slice(0, mid) },
      { type: 'tool-input-delta', id: 'tool-9', delta: body.slice(mid) },
      {
        type: 'tool-call',
        toolCallId: 'tool-9',
        toolName: 'addFile',
        input: { path: 'specs/requirements/requirements.md', content: 'streaming body' },
      },
      { type: 'finish', finishReason: 'stop' },
    ]),
    {},
    { onSnapshot: (files) => snapshots.push(files) },
    { previewThrottleMs: 0 },
  );
  assert.ok(result.ok);
  assert.ok(
    snapshots.length >= 2,
    `expected a partial-input preview before the folded snapshot, got ${snapshots.length} snapshot(s)`,
  );
  assert.match(
    snapshots[0]?.['specs/requirements/requirements.md'] ?? '',
    /streaming/,
    'the first snapshot previews the partial content',
  );
});

// F1 — an in-band error frame still wins over the truncation signal.
test('an error frame reports stream_error even without [DONE]', async () => {
  const result = await foldTurnStream(
    sse([{ type: 'error', error: 'boom' }], { done: false }),
    {},
    {},
    { previewThrottleMs: 0 },
  );
  assert.ok(!result.ok);
  assert.equal(result.code, 'stream_error');
  assert.equal(result.message, 'boom');
});
