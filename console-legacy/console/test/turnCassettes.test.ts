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
 * Recorded-stream replay tests. The fixtures under `test/fixtures/turns/` are
 * REAL production streams captured through the `@aep/sse-cassette` recording
 * proxy (exact bytes, exact chunk boundaries, real inter-chunk delays — see
 * the package README for the recording procedure). Each test folds a cassette
 * exactly the way the browser does and pins the streaming behavior the UI
 * depends on. Golden files: run with `UPDATE_GOLDENS=1` to (re)write
 * `test/fixtures/turns/golden/`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cassetteToStream, loadCassettes, type Cassette } from '@aep/sse-cassette';
import { foldTurnStream } from '../src/services/api/turnStream';
import { createLiveDesignState, projectLiveDesign } from '../src/lib/liveDesignOverlay';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'turns');
const GOLDEN_DIR = join(FIXTURES, 'golden');

interface TurnRequestBody {
  useCase?: string;
  files?: Record<string, string>;
}

const ALL_CASSETTES = existsSync(FIXTURES) ? loadCassettes(FIXTURES) : [];

function cassettesByUseCase(useCase: string): Cassette[] {
  return ALL_CASSETTES.filter(
    (c) => (c.request.body as TurnRequestBody | undefined)?.useCase === useCase,
  );
}

/** Stable golden name per cassette: conversation-id tail of the recorded path. */
const goldenName = (c: Cassette): string => {
  const m = /\/conversations\/([^/]+)\/turns/.exec(c.request.path);
  return `${(c.request.body as TurnRequestBody).useCase}-${(m?.[1] ?? 'x').slice(0, 8)}`;
};

const seedOf = (c: Cassette): Record<string, string> =>
  (c.request.body as TurnRequestBody | undefined)?.files ?? {};

function checkGolden(name: string, files: Record<string, string>): void {
  const goldenFile = join(GOLDEN_DIR, `${name}.files.json`);
  if (process.env.UPDATE_GOLDENS === '1') {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(goldenFile, `${JSON.stringify(files, null, 2)}\n`);
    return;
  }
  assert.ok(
    existsSync(goldenFile),
    `golden ${goldenFile} missing — run UPDATE_GOLDENS=1 pnpm test once and commit it`,
  );
  assert.deepEqual(
    files,
    JSON.parse(readFileSync(goldenFile, 'utf8')),
    'the folded files must match the committed golden byte for byte',
  );
}

const requirements = cassettesByUseCase('requirements-generate');
const designs = cassettesByUseCase('design-generate');

test('every recorded turn folds cleanly to completion (fold sanity, all use cases)', {
  skip: ALL_CASSETTES.length === 0 && 'no cassettes recorded yet',
}, async () => {
  for (const cassette of ALL_CASSETTES) {
    const result = await foldTurnStream(cassetteToStream(cassette), seedOf(cassette), {}, {
      previewThrottleMs: 0,
    });
    assert.ok(result.ok, `${goldenName(cassette)}: fold failed: ${JSON.stringify(result)}`);
    assert.equal(result.truncated, undefined, `${goldenName(cassette)}: unexpectedly truncated`);
  }
});

test('requirements-generate: the recorded streams fold with live progress', {
  skip: requirements.length === 0 && 'no requirements-generate cassette recorded yet',
}, async () => {
  for (const cassette of requirements) {
    const snapshots: Record<string, string>[] = [];
    const result = await foldTurnStream(
      cassetteToStream(cassette),
      seedOf(cassette),
      { onSnapshot: (files) => snapshots.push(files) },
      { previewThrottleMs: 0 },
    );

    assert.ok(result.ok, `fold failed: ${JSON.stringify(result)}`);
    assert.equal(result.truncated, undefined, 'the recorded stream completed — not truncated');

    const reqPath = Object.keys(result.files).find((p) => /requirements\.md$/.test(p));
    assert.ok(reqPath, 'the turn authored a requirements.md');
    assert.ok(result.files[reqPath]!.length > 200, 'requirements.md has real content');

    // The whole point of the typing preview: MANY intermediate snapshots, with
    // the requirements body growing monotonically — not one snapshot at the end.
    assert.ok(
      snapshots.length > 10,
      `expected live streaming previews, got ${snapshots.length} snapshot(s)`,
    );
    let prevLen = -1;
    let growths = 0;
    for (const snap of snapshots) {
      const body = snap[reqPath] ?? '';
      if (body.length > prevLen) growths++;
      prevLen = Math.max(prevLen, body.length);
    }
    assert.ok(growths > 10, 'the previewed requirements body grows as the stream arrives');

    checkGolden(goldenName(cassette), result.files);
  }
});

test('design-generate: the live cell diagram paints early, never vanishes, never regresses', {
  skip: designs.length === 0 && 'no design-generate cassette recorded yet',
}, async () => {
  for (const cassette of designs) await checkDesignCassette(cassette);
});

async function checkDesignCassette(cassette: Cassette): Promise<void> {
  const state = createLiveDesignState();
  const strictParsed = new Set<string>(); // design.json paths seen fully parseable
  const settledTypes = new Map<string, string>(); // component id → type after its file closed
  let sawProject = false;
  let paintedBeforeAnyStrictParse = false;
  let snapshotCount = 0;

  const result = await foldTurnStream(
    cassetteToStream(cassette),
    seedOf(cassette),
    {
      onSnapshot: (files) => {
        snapshotCount++;
        const project = projectLiveDesign('cassette-proj', files, state);

        for (const [path, content] of Object.entries(files)) {
          if (!/^specs\/design\/components\/[^/]+\/design\.json$/.test(path)) continue;
          try {
            JSON.parse(content);
            strictParsed.add(path);
          } catch {
            /* still streaming */
          }
        }

        if (project) {
          if (strictParsed.size === 0) paintedBeforeAnyStrictParse = true;
          if (sawProject) {
            // Diagram must never blank out mid-stream…
            assert.ok(project.components.length > 0, 'diagram vanished mid-stream');
          }
          sawProject = true;
          for (const comp of project.components) {
            const settled = settledTypes.get(comp.id);
            if (settled !== undefined) {
              // …and a component whose file completed must never change shape again.
              assert.equal(
                comp.type,
                settled,
                `component ${comp.id} regressed from ${settled} to ${comp.type} mid-stream`,
              );
            } else if (strictParsed.has(`specs/design/components/${comp.id}/design.json`)) {
              settledTypes.set(comp.id, comp.type);
            }
          }
        } else {
          assert.ok(!sawProject, 'projection returned null after a diagram had appeared');
        }
      },
    },
    { previewThrottleMs: 0 },
  );

  assert.ok(result.ok, `fold failed: ${JSON.stringify(result)}`);
  assert.equal(result.truncated, undefined, 'the recorded stream completed — not truncated');
  assert.ok(sawProject, 'a diagram appeared during the stream');
  assert.ok(snapshotCount > 10, `expected live streaming, got ${snapshotCount} snapshot(s)`);
  assert.ok(
    paintedBeforeAnyStrictParse,
    'the diagram must appear while the first design.json is still streaming (early paint)',
  );
  assert.ok(
    Object.keys(result.files).some((p) => /design\.json$/.test(p)),
    'the turn authored component design.json files',
  );

  checkGolden(goldenName(cassette), result.files);
}

test('a mid-stream cut of a real recording is reported as truncated, not success', {
  skip: designs.length === 0 && requirements.length === 0 && 'no cassettes recorded yet',
}, async () => {
  const cassette = (designs[0] ?? requirements[0])!;
  const cut: Cassette = { ...cassette, chunks: cassette.chunks.slice(0, Math.floor(cassette.chunks.length / 2)) };
  const result = await foldTurnStream(cassetteToStream(cut), seedOf(cut), {}, { previewThrottleMs: 0 });
  assert.ok(result.ok, 'a disconnect still returns the salvaged fold');
  assert.equal(result.truncated, true, 'half a stream must NOT look like a completed turn');
});

test('the fold is chunking-independent: seeded re-chunk replays produce identical files', {
  skip: requirements.length === 0 && 'no requirements-generate cassette recorded yet',
}, async () => {
  const cassette = requirements[0]!;
  const baseline = await foldTurnStream(cassetteToStream(cassette), seedOf(cassette), {}, { previewThrottleMs: 0 });
  assert.ok(baseline.ok);
  for (const seed of [1, 2, 3]) {
    const result = await foldTurnStream(
      cassetteToStream(cassette, { rechunk: { seed, minBytes: 1, maxBytes: 97 } }),
      seedOf(cassette),
      {},
      { previewThrottleMs: 0 },
    );
    assert.ok(result.ok);
    assert.deepEqual(result.files, baseline.files, `re-chunk seed ${seed} changed the fold`);
  }
});
