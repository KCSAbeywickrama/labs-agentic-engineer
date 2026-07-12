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
 * Write-gate behavior for wireframes `.dsl` layout: the compiler renders
 * coordinates verbatim, so out-of-frame and partially-overlapping elements are
 * rejected at write time with coordinates the model can self-correct from —
 * the same seam as the design.json schema gate.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { checkWireframeLayout } from "../src/wireframe-layout.ts";
import { FileBundle } from "../src/bundle.ts";

const PATH = "specs/design/components/shop-webapp/wireframes.dsl";

const CLEAN = `screen Dashboard "Admin overview"
  navbar "Hub"
  sidebar "Home | Reports"
  heading "Overview" 280,84
  card "Open items | 47 | across 5 projects" 280,160 280x160
  card "Overdue | 12 | needs escalation" 576,160 280x160
`;

const OVERLAPPING = `screen Dashboard "Admin overview"
  navbar "Hub"
  card "Overdue | 12 | needs escalation" 780,160 280x160
  card "Open findings | 5 | 2 high severity" 1020,160 280x160
`;

test("accepts a clean wireframe layout", () => {
  assert.equal(checkWireframeLayout(PATH, CLEAN), null);
});

test("rejects partially overlapping elements with coordinates in the message", () => {
  const problem = checkWireframeLayout(PATH, OVERLAPPING);
  assert.equal(problem?.code, "LAYOUT_VIOLATION");
  assert.match(problem!.message, /Overdue/);
  assert.match(problem!.message, /Open findings/);
  assert.match(problem!.message, /x1020/);
});

test("rejects an element extending past the frame", () => {
  const problem = checkWireframeLayout(
    PATH,
    `screen S\n  select "All frameworks" 1230,104 168x36\n`,
  );
  assert.equal(problem?.code, "LAYOUT_VIOLATION");
  assert.match(problem!.message, /frame/);
});

test("ignores non-wireframe paths and non-dsl files", () => {
  assert.equal(checkWireframeLayout("specs/requirements/requirements.md", OVERLAPPING), null);
  assert.equal(
    checkWireframeLayout("specs/design/components/api/erd.dsl", OVERLAPPING),
    null,
  );
});

test("does not gate syntax — an unparseable .dsl passes this gate", () => {
  assert.equal(checkWireframeLayout(PATH, "garbage {{{"), null);
});

test("FileBundle.addFile rejects an overlapping wireframe and stays unchanged", () => {
  const bundle = new FileBundle({});
  const res = bundle.addFile(PATH, OVERLAPPING);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, "LAYOUT_VIOLATION");
  assert.equal(bundle.has(PATH), false);
});

test("FileBundle.addFile applies a clean wireframe", () => {
  const bundle = new FileBundle({});
  const res = bundle.addFile(PATH, CLEAN);
  assert.equal(res.ok, true);
  assert.equal(bundle.has(PATH), true);
});

test("FileBundle.editFile that introduces an overlap is rejected, file unchanged", () => {
  const bundle = new FileBundle({ [PATH]: CLEAN });
  const res = bundle.editFile(
    PATH,
    'card "Overdue | 12 | needs escalation" 576,160 280x160',
    'card "Overdue | 12 | needs escalation" 500,160 280x160',
  );
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, "LAYOUT_VIOLATION");
  assert.match(bundle.read(PATH) ?? "", /576,160/);
});
