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
import { validateWireframeLayout } from "../src/index.js";

test("a clean screen produces no issues", () => {
  const issues = validateWireframeLayout(`screen Dashboard "Admin overview"
  navbar "Hub"
  sidebar "Home | Reports"
  heading "Overview" 280,84
  card "Open items | 47 | across 5 projects" 280,160 280x160
  card "Overdue | 12 | needs escalation" 576,160 280x160
  table "A | B" 280,360 940x200
  button "New" 1080,84 140x40 primary
`);
  assert.deepEqual(issues, []);
});

test("two partially overlapping cards are flagged with coordinates", () => {
  // Mirrors the real failure: "Overdue" 1180..1460 vs "Open findings" 1420..1700.
  const issues = validateWireframeLayout(`screen S
  card "Overdue | 12 | needs escalation" 1180,240 280x160
  card "Open findings | 5 | 2 high severity" 1420,240 280x160
`);
  assert.ok(issues.some((i) => /Overdue/.test(i) && /Open findings/.test(i) && /overlap/i.test(i)),
    `expected an overlap issue, got: ${JSON.stringify(issues)}`);
});

test("a badge fully inside a card is layering, not an overlap", () => {
  const issues = validateWireframeLayout(`screen S
  card "SOC 2 · EXTERNAL" 60,120 400x180
  badge "On track" 354,132 90x28 success
  text "68 of 92 controls" 76,260
`);
  assert.deepEqual(issues, []);
});

test("a badge straddling its card's border is a partial overlap", () => {
  const issues = validateWireframeLayout(`screen S
  card "SOC 2" 60,120 400x180
  badge "On track" 420,132 90x28 success
`);
  assert.ok(issues.some((i) => /badge/.test(i) && /overlap/i.test(i)),
    `expected the straddling badge flagged, got: ${JSON.stringify(issues)}`);
});

test("an element extending past the frame's right edge is flagged", () => {
  // Mirrors the real failure: a select whose right edge passes 1280.
  const issues = validateWireframeLayout(`screen S
  select "All frameworks" 1230,104 168x36
`);
  assert.ok(issues.some((i) => /All frameworks/.test(i) && /frame/i.test(i)),
    `expected an out-of-frame issue, got: ${JSON.stringify(issues)}`);
});

test("an element below the frame's bottom edge is flagged", () => {
  const issues = validateWireframeLayout(`screen S
  button "Save" 280,780 140x40
`);
  assert.ok(issues.some((i) => /Save/.test(i) && /frame/i.test(i)));
});

test("content under the sidebar rail is flagged only when a sidebar exists", () => {
  const withRail = validateWireframeLayout(`screen S
  sidebar "Home | Reports"
  heading "Overview" 40,84
`);
  assert.ok(withRail.some((i) => /sidebar/i.test(i)),
    `expected an under-sidebar issue, got: ${JSON.stringify(withRail)}`);

  const noRail = validateWireframeLayout(`screen S
  heading "Overview" 40,84
`);
  assert.deepEqual(noRail, []);
});

test("content under the navbar band is flagged only when a navbar exists", () => {
  const withBar = validateWireframeLayout(`screen S
  navbar "Hub"
  text "EYEBROW" 280,40
`);
  assert.ok(withBar.some((i) => /navbar/i.test(i)),
    `expected an under-navbar issue, got: ${JSON.stringify(withBar)}`);

  const noBar = validateWireframeLayout(`screen S
  text "EYEBROW" 280,40
`);
  assert.deepEqual(noBar, []);
});

test("free text is never overlap-checked (estimated widths would false-positive)", () => {
  const issues = validateWireframeLayout(`screen S
  heading "A very long heading that stretches far to the right side" 280,84
  text "another long line of copy sitting near the heading row" 600,84
`);
  assert.deepEqual(issues, []);
});

test("unparseable DSL yields no layout issues (the compile gate owns syntax)", () => {
  assert.deepEqual(validateWireframeLayout("garbage {{{"), []);
});

test("side-by-side elements sharing an edge do not overlap", () => {
  const issues = validateWireframeLayout(`screen S
  button "Cancel" 600,584 140x40
  button "Create" 740,584 160x40 primary
`);
  assert.deepEqual(issues, []);
});
