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
 * Synthetic-stream tests for the transport-free fold: terminal-event handling
 * (`turn-committed` / `turn-failed`), severed-stream detection, manifest-part
 * tolerance, and the live-preview mechanics. Recorded-cassette replays live in
 * turnCassettes.test.ts; the attach/reconnect loop in turnClient.test.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldTurnStream, unescapeJsonPrefix } from '../src/services/api/turnStream';

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

test('a committed turn folds files and surfaces the terminal event', async () => {
  const result = await foldTurnStream(
    sse([
      ...addFileCall('specs/requirements/requirements.md', '# Reqs\n'),
      { type: 'finish', finishReason: 'stop' },
      { type: 'turn-committed', commitSha: 'abc123', noChanges: false },
    ]),
    {},
    {},
    { previewThrottleMs: 0 },
  );
  assert.equal(result.end.kind, 'committed');
  assert.ok(result.end.kind === 'committed');
  assert.equal(result.end.commitSha, 'abc123');
  assert.equal(result.end.noChanges, false);
  assert.equal(result.files['specs/requirements/requirements.md'], '# Reqs\n');
  assert.equal(result.changes.length, 1);
  // Every data frame consumed counts toward the ?from= resume offset.
  assert.equal(result.parts, 6);
});

test('a chat-only turn ends committed with noChanges', async () => {
  const result = await foldTurnStream(
    sse([
      { type: 'text-delta', text: 'Sure — nothing to change.' },
      { type: 'finish', finishReason: 'stop' },
      { type: 'turn-committed', commitSha: 'abc123', noChanges: true },
    ]),
    {},
    {},
    { previewThrottleMs: 0 },
  );
  assert.ok(result.end.kind === 'committed');
  assert.equal(result.end.noChanges, true);
});

test('a turn-failed terminal event surfaces reason + paths (base-moved)', async () => {
  const result = await foldTurnStream(
    sse([
      ...addFileCall('specs/design/design.md', '# Design\n'),
      {
        type: 'turn-failed',
        reason: 'base-moved',
        message: 'files changed under the turn',
        paths: ['specs/design/design.md', 'specs/design/components/api/design.json'],
      },
    ]),
    {},
    {},
    { previewThrottleMs: 0 },
  );
  assert.ok(result.end.kind === 'failed');
  assert.equal(result.end.reason, 'base-moved');
  assert.deepEqual(result.end.paths, [
    'specs/design/design.md',
    'specs/design/components/api/design.json',
  ]);
});

test('an unknown turn-failed reason degrades to internal', async () => {
  const result = await foldTurnStream(
    sse([{ type: 'turn-failed', reason: 'space-weather', message: 'boom' }]),
    {},
    {},
    { previewThrottleMs: 0 },
  );
  assert.ok(result.end.kind === 'failed');
  assert.equal(result.end.reason, 'internal');
  assert.equal(result.end.message, 'boom');
});

// The backend does not forward manifest frames, but tolerate one anyway: it
// must neither fold nor derail the terminal-event handling.
test('a manifest part is ignored', async () => {
  const result = await foldTurnStream(
    sse([
      ...addFileCall('specs/requirements/requirements.md', '# Reqs\n'),
      { type: 'manifest', files: { 'specs/requirements/requirements.md': 'deadbeef' }, deleted: [] },
      { type: 'turn-committed', commitSha: 'abc123', noChanges: false },
    ]),
    {},
    {},
    { previewThrottleMs: 0 },
  );
  assert.ok(result.end.kind === 'committed');
  assert.deepEqual(Object.keys(result.files), ['specs/requirements/requirements.md']);
});

// A stream that dies before any terminal event (network drop, replica crash)
// is a CONNECTION LOSS, not an outcome: the attach loop reconnects and the
// status GET is the final truth. No salvage — commits only come from the
// backend's manifest-verified fold.
test('a mid-turn disconnect (no terminal, no [DONE]) is severed', async () => {
  const partialInput = JSON.stringify({
    path: 'specs/requirements/requirements.md',
    content: 'only half of the file arrived and then the connect',
  }).slice(0, -20); // input JSON never closes — no tool-call frame ever arrives
  const result = await foldTurnStream(
    sse(
      [
        { type: 'tool-input-start', id: 'tool-1', toolName: 'addFile' },
        { type: 'tool-input-delta', id: 'tool-1', delta: partialInput },
        // …connection dies here: no error frame, no terminal, no [DONE].
      ],
      { done: false },
    ),
    {},
    {},
    { previewThrottleMs: 0 },
  );
  assert.ok(result.end.kind === 'severed');
  assert.equal(result.end.done, false);
  assert.equal(result.parts, 2);
  assert.equal(
    result.files['specs/requirements/requirements.md'],
    undefined,
    'no partial salvage — the display fold only carries applied tool-calls',
  );
});

test('[DONE] without a terminal event is still severed (done=true)', async () => {
  const result = await foldTurnStream(
    sse([...addFileCall('specs/design/design.md', '# Design\n'), { type: 'finish', finishReason: 'stop' }]),
    {},
    {},
    { previewThrottleMs: 0 },
  );
  assert.ok(result.end.kind === 'severed');
  assert.equal(result.end.done, true);
  assert.equal(result.files['specs/design/design.md'], '# Design\n');
});

// Some providers/SDK versions omit `tool-input-start` (or carry the id only on
// the deltas). The live preview must prime itself from the first delta instead
// of showing nothing until the turn ends.
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
      { type: 'turn-committed', commitSha: 'abc123', noChanges: false },
    ]),
    {},
    { onSnapshot: (files) => snapshots.push(files) },
    { previewThrottleMs: 0 },
  );
  assert.ok(result.end.kind === 'committed');
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

test('BFF `id:`-prefixed frames drive the live preview and fold (the real wire format)', async () => {
  // Regression for the dead live-preview: the committed-truth stream endpoint
  // writes `id: <index>\ndata: <json>\n\n` (Last-Event-ID resume), NOT a bare
  // `data:` line. The parser must read the data line inside the multi-line
  // frame; the previous `frame.startsWith('data:')` guard dropped EVERY part,
  // so onSnapshot never fired and the turn resolved severed. (Every other test
  // here feeds id-less frames, which is exactly why this slipped through.)
  const idFramed = (frames: object[]): ReadableStream<Uint8Array> => {
    const lines = frames.map((f, i) => `id: ${i}\ndata: ${JSON.stringify(f)}\n\n`);
    lines.push('data: [DONE]\n\n'); // the sentinel carries no id
    let i = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < lines.length) controller.enqueue(encoder.encode(lines[i++]));
        else controller.close();
      },
    });
  };
  const snapshots: Record<string, string>[] = [];
  const result = await foldTurnStream(
    idFramed([
      ...addFileCall('specs/requirements/requirements.md', '# Reqs\n'),
      { type: 'turn-committed', commitSha: 'abc123', noChanges: false },
    ]),
    {},
    { onSnapshot: (files) => snapshots.push(files) },
    { previewThrottleMs: 0 },
  );
  assert.ok(result.end.kind === 'committed', `expected committed, got ${result.end.kind}`);
  assert.ok(result.end.kind === 'committed' && result.end.commitSha === 'abc123');
  assert.ok(snapshots.length > 0, 'onSnapshot must fire — the live preview is driven by it');
  assert.equal(result.files['specs/requirements/requirements.md'], '# Reqs\n');
});

// An in-band error frame is diagnostics, not an outcome — the backend's
// terminal event follows it. When the stream severs first, the text rides
// along on the severed end.
test('an error frame then EOF is severed with the error captured', async () => {
  const result = await foldTurnStream(
    sse([{ type: 'error', error: 'boom' }], { done: false }),
    {},
    {},
    { previewThrottleMs: 0 },
  );
  assert.ok(result.end.kind === 'severed');
  assert.equal(result.end.streamError, 'boom');
});

// unescapeJsonPrefix drives the live typing-preview of a streaming addFile
// input. A partial/garbled \u escape at the buffer edge must never decode to
// garbage — it stays literal until (if ever) the real hex digits arrive.
test('unescapeJsonPrefix decodes valid escapes and leaves invalid \\u sequences literal', () => {
  // A valid \uXXXX still decodes.
  assert.equal(unescapeJsonPrefix('a\\u0041b'), 'aAb');
  // A genuinely truncated escape (<4 hex digits) at the edge drops, awaiting more.
  assert.equal(unescapeJsonPrefix('a\\u12'), 'a');
  // A full-width but non-hex quad (\u12zz) is left literal — no U+0000 garbage.
  assert.equal(unescapeJsonPrefix('a\\u12zzb'), 'a\\u12zzb');
  // A non-hex quad mid-string does not swallow the following characters.
  assert.equal(unescapeJsonPrefix('x\\uZZZZy'), 'x\\uZZZZy');
});

test('an error frame followed by turn-failed resolves to the terminal event', async () => {
  const result = await foldTurnStream(
    sse([
      { type: 'error', error: 'upstream exploded' },
      { type: 'turn-failed', reason: 'stream-died' },
    ]),
    {},
    {},
    { previewThrottleMs: 0 },
  );
  assert.ok(result.end.kind === 'failed');
  assert.equal(result.end.reason, 'stream-died');
  // The terminal event carried no message — the in-band error text stands in.
  assert.equal(result.end.message, 'upstream exploded');
});
