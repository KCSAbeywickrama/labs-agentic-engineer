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
 * The live cell-diagram projection used while a design turn streams. The three
 * bugs these tests pin (all observed in production):
 *   1. late first paint — a partial design.json never JSON.parses, so the
 *      component appeared only when its file closed;
 *   2. default-box flicker — the strict-parse fallback degraded a streaming
 *      component to a typeless default;
 *   3. re-layout flicker / vanish — every snapshot produced a NEW project
 *      object (or null), so the diagram re-laid-out ~12×/s and disappeared
 *      whenever an intermediate state projected to nothing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLiveDesignState,
  projectLiveDesign,
  repairPartialJson,
} from '../src/lib/liveDesignOverlay';

const DESIGN = (id: string) => `specs/design/components/${id}/design.json`;

const apiSvc = JSON.stringify(
  { type: 'service', exposure: 'internet', connections: [{ to: 'db', type: 'datastore' }] },
  null,
  2,
);

test('repairPartialJson completes streaming prefixes of a design.json', () => {
  for (let cut = 1; cut <= apiSvc.length; cut++) {
    const repaired = repairPartialJson(apiSvc.slice(0, cut));
    if (repaired === null) continue; // some prefixes are unrecoverable — fine
    const parsed = JSON.parse(repaired) as Record<string, unknown>;
    assert.equal(typeof parsed, 'object');
  }
  // The full document must survive untouched.
  assert.deepEqual(JSON.parse(repairPartialJson(apiSvc) ?? ''), JSON.parse(apiSvc));
});

test('a component appears while its design.json is still streaming (early paint)', () => {
  const state = createLiveDesignState();
  // Cut mid-way through the connections array — strict JSON.parse fails here.
  const partial = apiSvc.slice(0, Math.floor(apiSvc.length * 0.6));
  assert.throws(() => JSON.parse(partial), 'precondition: the partial must not strict-parse');

  const project = projectLiveDesign('proj', { [DESIGN('api')]: partial }, state);
  assert.ok(project, 'a streaming design.json must already project a diagram');
  assert.equal(project.components.length, 1);
  assert.equal(project.components[0]?.id, 'api');
});

test('the projection identity is stable while only immaterial bytes stream', () => {
  const state = createLiveDesignState();
  // Two cuts that differ only inside a not-yet-complete trailing section.
  const a = projectLiveDesign('proj', { [DESIGN('api')]: apiSvc.slice(0, 30) }, state);
  const b = projectLiveDesign('proj', { [DESIGN('api')]: apiSvc.slice(0, 31) }, state);
  assert.ok(a && b);
  assert.equal(a, b, 'an unchanged projected model must keep the SAME object identity');
});

test('a component never regresses to defaults once its file parsed (last-good wins)', () => {
  const state = createLiveDesignState();
  const webapp = JSON.stringify({ type: 'webapp' });
  const good = projectLiveDesign('proj', { [DESIGN('ui')]: webapp }, state);
  assert.equal(good?.components[0]?.type, 'web-app');

  // The agent now EDITS the file; mid-stream the content is a broken prefix
  // that would strict-parse to nothing and repair to a typeless {}.
  const brokenBeyondRepair = '{"type"';
  const during = projectLiveDesign('proj', { [DESIGN('ui')]: brokenBeyondRepair }, state);
  assert.equal(
    during?.components[0]?.type,
    'web-app',
    'the last successfully-parsed content must back the component while its file is unparseable',
  );
});

test('the diagram never vanishes mid-stream once it has appeared', () => {
  const state = createLiveDesignState();
  const withComponent = projectLiveDesign('proj', { [DESIGN('api')]: apiSvc }, state);
  assert.ok(withComponent && withComponent.components.length === 1);

  // An intermediate snapshot with NO component files at all (e.g. the agent is
  // writing design.md between components) must not blank the diagram.
  const empty = projectLiveDesign('proj', { 'specs/design/design.md': '# half-written' }, state);
  assert.ok(empty, 'projection must not return null once a diagram exists');
  assert.equal(empty.components.length, 1, 'the previous diagram is kept');
});

test('a fresh state with nothing parseable projects null (empty-state copy shows)', () => {
  const state = createLiveDesignState();
  assert.equal(projectLiveDesign('proj', {}, state), null);
  assert.equal(projectLiveDesign('proj', { 'specs/design/design.md': '# d' }, state), null);
});

test('a mid-string cut drops the half token instead of fabricating a truncated value', () => {
  // Observed live (reload #2 of a real generation): `"exposure": "inter` was
  // repaired to the literal "inter", matching neither gateway — the component
  // rendered OUTSIDE the cell until the full value streamed.
  const full = JSON.stringify({
    name: 'api',
    type: 'service',
    version: '0.1.0',
    language: 'Go',
    exposure: 'internet',
    connections: [],
  });
  const cut = full.slice(0, full.indexOf('"internet"') + '"inter'.length);
  const repaired = repairPartialJson(cut);
  assert.ok(repaired);
  const parsed = JSON.parse(repaired) as Record<string, unknown>;
  assert.equal('exposure' in parsed, false, 'the truncated exposure value must be dropped');
  assert.equal(parsed.type, 'service', 'complete fields before the cut survive');

  // End to end: the projected service must NEVER be gateway-less (that is what
  // drew it outside the cell) — a dropped exposure falls back to the default.
  const state = createLiveDesignState();
  const project = projectLiveDesign('proj', { [DESIGN('api')]: cut }, state);
  const gateways = project?.components[0]?.services['api:api']?.deploymentMetadata.gateways;
  assert.ok(gateways, 'the component still paints early');
  assert.ok(
    gateways.internet.isExposed || gateways.intranet.isExposed,
    'a streaming service must always be bound to a gateway',
  );
});

test('the diagram reacts ONLY to design.json changes — other file deltas keep identity', () => {
  const state = createLiveDesignState();
  const base = { [DESIGN('api')]: apiSvc, 'specs/design/design.md': '# v1' };
  const a = projectLiveDesign('proj', base, state);
  assert.ok(a);

  // design.md / openapi.yaml / wireframes.dsl stream on while every design.json
  // byte is unchanged — the projection must return the SAME object every time.
  const b = projectLiveDesign(
    'proj',
    { ...base, 'specs/design/design.md': '# v2 — longer, still irrelevant to the diagram' },
    state,
  );
  const c = projectLiveDesign(
    'proj',
    { ...base, 'specs/design/components/api/openapi.yaml': 'openapi: 3.0.3\npaths:' },
    state,
  );
  const d = projectLiveDesign(
    'proj',
    { ...base, 'specs/design/components/ui/wireframes.dsl': 'screen Home {' },
    state,
  );
  assert.equal(a, b);
  assert.equal(a, c);
  assert.equal(a, d);

  // ...and a design.json field the diagram consumes DOES re-project.
  const flipped = JSON.stringify({ type: 'webapp' });
  const e = projectLiveDesign('proj', { ...base, [DESIGN('api')]: flipped }, state);
  assert.ok(e);
  assert.notEqual(a, e);
  assert.equal(e.components[0]?.type, 'web-app');
});
