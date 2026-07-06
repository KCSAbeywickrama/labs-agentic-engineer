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
 * Transport-free tests for the committed-truth turn client:
 *   - start-turn error classification (the 409 variants + activeTurnId),
 *   - the attach/reconnect loop (turnStream.ts `runTurnAttachLoop`) — the
 *     refresh-attach state machine: terminal events, reconnect-on-silent-EOF
 *     with the `?from=` offset advanced, expired-replay fallback to the status
 *     GET, and bounded retries. Fold mechanics live in foldTurnStream.test.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyStartTurnError,
  filterTurnSeed,
  runTurnAttachLoop,
  type TurnStatus,
  type TurnStreamConnection,
} from '../src/services/api/turnStream';

// ---------------------------------------------------------------------------
// classifyStartTurnError
// ---------------------------------------------------------------------------

test('409 turn_in_progress extracts the activeTurnId', () => {
  const err = classifyStartTurnError(409, {
    code: 'turn_in_progress',
    activeTurnId: 'turn-42',
    detail: 'a turn is already running',
  });
  assert.equal(err.code, 'turn_in_progress');
  assert.equal(err.activeTurnId, 'turn-42');
  assert.equal(err.message, 'a turn is already running');
});

test('409 turn_in_progress without an activeTurnId still classifies', () => {
  const err = classifyStartTurnError(409, { code: 'turn_in_progress' });
  assert.equal(err.code, 'turn_in_progress');
  assert.equal(err.activeTurnId, undefined);
});

test('409 requirements_not_approved by machine code', () => {
  const err = classifyStartTurnError(409, {
    code: 'requirements_not_approved',
    message: 'approve requirements first',
  });
  assert.equal(err.code, 'requirements_not_approved');
  assert.equal(err.message, 'approve requirements first');
});

test('409 with no machine code falls back to the approval gate', () => {
  const err = classifyStartTurnError(409, { detail: 'no requirements version' });
  assert.equal(err.code, 'requirements_not_approved');
});

test('status mapping: 400/404/502/503/504/500', () => {
  assert.equal(classifyStartTurnError(400, { detail: 'no key' }).code, 'missing_org_key');
  assert.equal(classifyStartTurnError(404, {}).code, 'not_found');
  assert.equal(classifyStartTurnError(502, {}).code, 'upstream');
  assert.equal(classifyStartTurnError(503, {}).code, 'upstream');
  assert.equal(classifyStartTurnError(504, {}).code, 'upstream');
  assert.equal(classifyStartTurnError(500, {}).code, 'request_failed');
});

test('400 classification: only a missing-key message maps to missing_org_key', () => {
  // The missing-key 400 (the Go server's ErrNoAnthropicKey message).
  const missingKey = classifyStartTurnError(400, {
    detail: 'organization has no Anthropic API key configured',
  });
  assert.equal(missingKey.code, 'missing_org_key');

  // Other 400 causes must NOT show the "add a key" prompt; they surface the
  // server's real message under a generic code.
  const invalidUseCase = classifyStartTurnError(400, { detail: 'invalid use case' });
  assert.equal(invalidUseCase.code, 'request_failed');
  assert.equal(invalidUseCase.message, 'invalid use case');

  const invalidConv = classifyStartTurnError(400, { detail: 'invalid conversation id' });
  assert.equal(invalidConv.code, 'request_failed');
  assert.equal(invalidConv.message, 'invalid conversation id');
});

test('an unparseable body falls back to the raw text / status message', () => {
  const err = classifyStartTurnError(500, undefined, 'gateway exploded');
  assert.equal(err.code, 'request_failed');
  assert.equal(err.message, 'gateway exploded');
  const empty = classifyStartTurnError(500, undefined, '');
  assert.equal(empty.message, 'Turn failed (HTTP 500).');
});

// ---------------------------------------------------------------------------
// filterTurnSeed (display-fold parity with the agents-side snapshot read)
// ---------------------------------------------------------------------------

test('filterTurnSeed keeps *.md/*.dsl/design.json and drops the rest', () => {
  const out = filterTurnSeed({
    'specs/requirements/requirements.md': '# R',
    'specs/requirements/wireframes.dsl': 'page x',
    'specs/requirements/wireframes.excalidraw': '{}',
    'specs/design/components/api/design.json': '{}',
    'specs/design/components/api/openapi.yaml': 'openapi: 3.0.0',
    'specs/design/cell-diagram.gen.json': '{}',
    'specs/.hidden/notes.md': 'x',
    'specs/requirements/binary.md': 'a\0b',
  });
  assert.deepEqual(Object.keys(out).sort(), [
    'specs/design/components/api/design.json',
    'specs/requirements/requirements.md',
    'specs/requirements/wireframes.dsl',
  ]);
});

// ---------------------------------------------------------------------------
// runTurnAttachLoop
// ---------------------------------------------------------------------------

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

const addFileCall = (path: string, content: string, id: string) => [
  { type: 'tool-call', toolCallId: id, toolName: 'addFile', input: { path, content } },
  { type: 'tool-result', toolCallId: id, toolName: 'addFile', input: { path, content }, output: { ok: true, op: 'add', path } },
];

const runningStatus: TurnStatus = {
  turnId: 't1',
  conversationId: 'c1',
  useCase: 'requirements-generate',
  status: 'running',
  createdAt: 'now',
  updatedAt: 'now',
};

test('attach: one leg ending in turn-committed resolves ok', async () => {
  const connects: number[] = [];
  const result = await runTurnAttachLoop(
    async (from) => {
      connects.push(from);
      return {
        ok: true,
        body: sse([
          ...addFileCall('specs/requirements/requirements.md', '# R\n', 'a'),
          { type: 'turn-committed', commitSha: 'sha-1', noChanges: false },
        ]),
      };
    },
    async () => runningStatus,
    { seed: {}, reconnectDelayMs: 0 },
  );
  assert.deepEqual(connects, [0]);
  assert.ok(result.ok);
  assert.equal(result.commitSha, 'sha-1');
  assert.equal(result.files['specs/requirements/requirements.md'], '# R\n');
});

test('attach: turn-failed(base-moved) resolves to a typed failure with paths', async () => {
  const result = await runTurnAttachLoop(
    async () => ({
      ok: true,
      body: sse([
        { type: 'turn-failed', reason: 'base-moved', message: 'overlap', paths: ['specs/design/design.md'] },
      ]),
    }),
    async () => runningStatus,
    { seed: {}, reconnectDelayMs: 0 },
  );
  assert.ok(!result.ok);
  assert.equal(result.code, 'turn_failed');
  assert.equal(result.reason, 'base-moved');
  assert.deepEqual(result.paths, ['specs/design/design.md']);
});

test('attach: a silent EOF reconnects with from advanced past the consumed parts', async () => {
  const connects: number[] = [];
  const legs: TurnStreamConnection[] = [
    // Leg 1: 2 data frames, then the connection dies (no [DONE], no terminal).
    { ok: true, body: sse(addFileCall('specs/requirements/requirements.md', '# R\n', 'a'), { done: false }) },
    // Leg 2 (replay from=2): the rest of the turn + the terminal event.
    {
      ok: true,
      body: sse([
        ...addFileCall('specs/requirements/notes.md', 'hi\n', 'b'),
        { type: 'turn-committed', commitSha: 'sha-2', noChanges: false },
      ]),
    },
  ];
  const result = await runTurnAttachLoop(
    async (from) => {
      connects.push(from);
      return legs[connects.length - 1]!;
    },
    async () => runningStatus,
    { seed: { 'specs/requirements/seeded.md': 'seed\n' }, reconnectDelayMs: 0 },
  );
  assert.deepEqual(connects, [0, 2], 'the reconnect resumes past the 2 consumed frames');
  assert.ok(result.ok);
  assert.equal(result.commitSha, 'sha-2');
  // The fold carried across the reconnect: seed + leg-1 + leg-2 files all present.
  assert.equal(result.files['specs/requirements/seeded.md'], 'seed\n');
  assert.equal(result.files['specs/requirements/requirements.md'], '# R\n');
  assert.equal(result.files['specs/requirements/notes.md'], 'hi\n');
});

test('attach: an expired replay window (404) falls back to the status GET', async () => {
  const result = await runTurnAttachLoop(
    async () => ({ ok: false, notFound: true, message: 'gone' }),
    async () => ({
      ...runningStatus,
      status: 'completed',
      commitSha: 'sha-3',
      noChanges: true,
    }),
    { seed: {}, reconnectDelayMs: 0 },
  );
  assert.ok(result.ok);
  assert.equal(result.commitSha, 'sha-3');
  assert.equal(result.noChanges, true);
});

test('attach: 404 + no status row resolves not_found', async () => {
  const result = await runTurnAttachLoop(
    async () => ({ ok: false, notFound: true, message: 'gone' }),
    async () => null,
    { seed: {}, reconnectDelayMs: 0 },
  );
  assert.ok(!result.ok);
  assert.equal(result.code, 'not_found');
});

test('attach: retries exhausted while the turn still runs resolves stream_lost', async () => {
  let connects = 0;
  const result = await runTurnAttachLoop(
    async () => {
      connects++;
      return { ok: true, body: sse([], { done: false }) }; // instant silent EOF
    },
    async () => runningStatus,
    { seed: {}, maxReconnects: 2, reconnectDelayMs: 0 },
  );
  assert.equal(connects, 3, 'initial attach + 2 reconnects');
  assert.ok(!result.ok);
  assert.equal(result.code, 'stream_lost');
});

test('attach: retries exhausted resolves via a failed status row', async () => {
  const result = await runTurnAttachLoop(
    async () => ({ ok: true, body: sse([], { done: false }) }),
    async () => ({
      ...runningStatus,
      status: 'failed',
      reason: 'stream-died',
      message: 'agents connection dropped',
    }),
    { seed: {}, maxReconnects: 1, reconnectDelayMs: 0 },
  );
  assert.ok(!result.ok);
  assert.equal(result.code, 'turn_failed');
  assert.equal(result.reason, 'stream-died');
  assert.equal(result.message, 'agents connection dropped');
});

test('attach: abort surfaces as an AbortError, not a result', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runTurnAttachLoop(
      async () => ({ ok: true, body: sse([], { done: false }) }),
      async () => runningStatus,
      { seed: {}, signal: controller.signal, reconnectDelayMs: 0 },
    ),
    (err: unknown) => err instanceof Error && err.name === 'AbortError',
  );
});
