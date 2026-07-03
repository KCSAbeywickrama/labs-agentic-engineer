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
import { dslToExcalidraw, tryDslToExcalidraw } from "../src/index.js";

type El = {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  backgroundColor?: string;
};

function compile(dsl: string): El[] {
  return JSON.parse(dslToExcalidraw("wireframes", dsl)).elements as El[];
}

const DESKTOP = `screen Dashboard
  navbar "RiskHub | Dashboard | Risks | Reports"
  sidebar "Overview | My Risks | Audits | Settings"
  heading "Risk Overview" 280,80
  table "Risk | Owner | Severity | Status" 280,130 940x240
  button "New risk" 280,400 140x40
screen Detail
  heading "Risk Detail" 280,80
flow
  Dashboard -> Detail
`;

test("screens default to desktop 1280x800", () => {
  const els = compile(DESKTOP);
  const outline = els.find((e) => e.type === "rectangle" && e.width === 1280 && e.height === 800);
  assert.ok(outline, "no 1280x800 screen outline found");
});

test("an explicit screen size overrides the default", () => {
  const els = compile("screen Modal 480x320\n  text \"hi\" 16,16\n");
  assert.ok(els.some((e) => e.type === "rectangle" && e.width === 480 && e.height === 320));
});

test("navbar spans the screen width without coordinates and renders its items", () => {
  const els = compile(DESKTOP);
  const bar = els.find((e) => e.type === "rectangle" && e.width === 1280 && e.height === 56);
  assert.ok(bar, "navbar bar missing");
  for (const item of ["RiskHub", "Dashboard", "Risks", "Reports"]) {
    assert.ok(els.some((e) => e.type === "text" && e.text === item), `navbar item ${item} missing`);
  }
});

test("sidebar renders as a left rail with stacked items", () => {
  const els = compile(DESKTOP);
  const rail = els.find((e) => e.type === "rectangle" && e.width === 240 && e.height > 600);
  assert.ok(rail, "sidebar rail missing");
  const overview = els.find((e) => e.type === "text" && e.text === "Overview");
  const settings = els.find((e) => e.type === "text" && e.text === "Settings");
  assert.ok(overview && settings && settings.y > overview.y, "sidebar items not stacked");
});

test("table renders a header row, column headers, and row lines", () => {
  const els = compile(DESKTOP);
  for (const col of ["Risk", "Owner", "Severity", "Status"]) {
    assert.ok(els.some((e) => e.type === "text" && e.text === col), `column ${col} missing`);
  }
  assert.ok(els.some((e) => e.type === "line"), "table grid lines missing");
});

test("image placeholder renders a crossed box", () => {
  const els = compile('screen S\n  image "logo" 16,16 200x120\n');
  assert.equal(els.filter((e) => e.type === "line").length, 2);
});

test("the palette is grayscale (structural wireframe style)", () => {
  const els = compile(DESKTOP);
  const colored = els.filter(
    (e) =>
      e.backgroundColor &&
      e.backgroundColor !== "transparent" &&
      !/^#(f8f9fa|f1f3f5|e9ecef|dee2e6|ced4da|ffffff)$/i.test(e.backgroundColor),
  );
  assert.deepEqual(colored, []);
});

test("legacy kinds (rect/ellipse/button/text) still parse and flows still mark", () => {
  const els = compile(DESKTOP + "  rect \"x\" 16,16\n");
  const texts = els.filter((e) => e.type === "text");
  assert.ok(texts.some((t) => /→\(\d+\)/.test(t.text ?? "")), "flow marker missing");
});

test("tryDslToExcalidraw reports a parse error instead of throwing", () => {
  const res = tryDslToExcalidraw("wireframes", "not a wireframe\n");
  assert.equal(res.ok, false);
  if (!res.ok) assert.ok(res.error.length > 0);
});
