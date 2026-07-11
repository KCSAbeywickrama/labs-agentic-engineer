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
  strokeColor?: string;
  backgroundColor?: string;
};

// Semantic *status* colors (danger/success/warning/info). These must only
// appear when an element opts in via a variant — never leak into plain chrome.
// (Brand orange from the Oxygen theme is expected on chrome and is NOT here.)
const STATUS_COLORS = /^#(d92d20|2e7d32|ed6c02|0288d1)$/i;

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

test("primary actions and active navigation use the Oxygen brand color", () => {
  const els = compile(`screen S
  navbar "BrandApp | Home | Reports"
  button "Create" 280,80 140x40 primary`);
  // primary button fills brand orange
  assert.ok(
    els.some((e) => e.type === "rectangle" && e.backgroundColor === "#fa7b3f"),
    "primary button not brand-filled",
  );
  // first navbar item (the app name) reads as active in brand
  assert.ok(
    els.some((e) => e.type === "text" && e.text === "BrandApp" && e.strokeColor === "#fa7b3f"),
    "active navbar item not branded",
  );
});

test("legacy kinds (rect/ellipse/button/text) still parse and flows still mark", () => {
  const els = compile(DESKTOP + "  rect \"x\" 16,16\n");
  const texts = els.filter((e) => e.type === "text");
  // Screen-order markers still render in the corner.
  assert.ok(texts.some((t) => /^Screen \d+$/.test(t.text ?? "")), "screen number marker missing");
});

test("a screen description renders as a subtitle above the frame", () => {
  const els = compile(`screen Dashboard "Where managers monitor open risk"
  heading "Risk" 280,80`);
  assert.ok(
    els.some((e) => e.type === "text" && e.text === "Where managers monitor open risk"),
    "screen description subtitle missing",
  );
  // the screen name is still present and separate
  assert.ok(els.some((e) => e.type === "text" && e.text === "Dashboard"), "screen name missing");
});

test("a screen description does not break the optional size", () => {
  const els = compile(`screen Modal "Confirm deletion" 480x320
  text "hi" 16,16`);
  assert.ok(els.some((e) => e.type === "rectangle" && e.width === 480 && e.height === 320), "sized frame missing");
  assert.ok(els.some((e) => e.type === "text" && e.text === "Confirm deletion"), "description missing");
});

test("a one-part card stays a simple panel title (back-compat)", () => {
  const els = compile(`screen S\n  card "Remediation progress" 280,120 300x120`);
  assert.ok(els.some((e) => e.type === "text" && e.text === "Remediation progress"), "panel title missing");
});

test("a multi-part card renders as a stat tile (label, big value, caption)", () => {
  const els = compile(`screen S\n  card "Open items | 47 | across 5 active audits" 280,120 300x120`);
  for (const t of ["Open items", "47", "across 5 active audits"]) {
    assert.ok(els.some((e) => e.type === "text" && e.text === t), `tile part "${t}" missing`);
  }
  const value = els.find((e) => e.type === "text" && e.text === "47") as (El & { fontSize?: number }) | undefined;
  const metric = els.find((e) => e.type === "text" && e.text === "Open items") as (El & { fontSize?: number }) | undefined;
  assert.ok((value?.fontSize ?? 0) > (metric?.fontSize ?? 0), "value not larger than its label");
});

test("the navbar groups links right and ends in a bell + account avatar", () => {
  const els = compile(`screen S\n  navbar "AuditHub | Dashboard | Reports"`);
  // brand stays left in brand color
  const brand = els.find((e) => e.type === "text" && e.text === "AuditHub");
  assert.ok(brand && brand.strokeColor === "#fa7b3f", "brand not left/branded");
  // nav links sit in the right half of the bar
  const link = els.find((e) => e.type === "text" && e.text === "Dashboard");
  assert.ok(link && link.x > 1280 / 2, "nav links not grouped right");
  // bell + avatar → at least 2 ellipses near the right edge
  const rightEllipses = els.filter((e) => e.type === "ellipse" && e.x > 1280 - 120);
  assert.ok(rightEllipses.length >= 2, "bell/avatar missing from navbar");
});

test("a heading renders an underline rule beneath it", () => {
  const before = compile(`screen S\n  text "x" 10,10`).filter((e) => e.type === "line").length;
  const after = compile(`screen S\n  heading "Recent activity" 10,10`).filter((e) => e.type === "line").length;
  assert.ok(after > before, "heading underline rule missing");
});

test("an element `-> Screen` renders a navigation marker beside that element", () => {
  const els = compile(`screen Catalog
  button "View product" 40,600 160x44 -> ProductDetail
screen ProductDetail
  heading "Details" 40,80`);
  // marker names the target screen + its number, next to the button
  assert.ok(
    els.some((e) => e.type === "text" && /^→ Screen 2 · ProductDetail$/.test(e.text ?? "")),
    "element nav marker missing/mis-formatted",
  );
  // the button label itself is intact (the -> suffix was stripped)
  assert.ok(els.some((e) => e.type === "text" && e.text === "View product"), "button label lost");
});

test("a `-> Screen` target that is a variant word is not mistaken for a variant", () => {
  // 'info' is both a variant and could be a screen name — the -> target wins.
  const els = compile(`screen A\n  button "Go" 10,10 120x40 -> Info\nscreen Info\n  heading "I" 10,10`);
  assert.ok(els.some((e) => e.type === "text" && /→ Screen 2 · Info/.test(e.text ?? "")), "nav to Info missing");
});

test("a `\\n` in a label becomes a real line break (card title + subtitle)", () => {
  const els = compile(`screen S\n  card "Speckled Mug\\n$28 · In stock" 40,40 260x160`);
  const label = els.find((e) => e.type === "text" && /^Speckled Mug/.test(e.text ?? ""));
  assert.ok(label, "card label missing");
  assert.ok(label!.text!.includes("\n") && !label!.text!.includes("\\n"), "backslash-n not converted to newline");
});

test("a taller-than-wide divider draws a vertical rule (column separator)", () => {
  const vert = compile(`screen S\n  divider "" 760,120 1x400`);
  const horiz = compile(`screen S\n  divider "" 40,120 900x1`);
  const vLine = vert.find((e) => e.type === "line") as (El & { points?: [number, number][] }) | undefined;
  const hLine = horiz.find((e) => e.type === "line") as (El & { points?: [number, number][] }) | undefined;
  // vertical: dy dominates; horizontal: dx dominates
  assert.ok(vLine && vLine.points![1]![1] > vLine.points![1]![0], "divider not vertical when tall");
  assert.ok(hLine && hLine.points![1]![0] > hLine.points![1]![1], "divider not horizontal when wide");
});

test("tryDslToExcalidraw reports a parse error instead of throwing", () => {
  const res = tryDslToExcalidraw("wireframes", "not a wireframe\n");
  assert.equal(res.ok, false);
  if (!res.ok) assert.ok(res.error.length > 0);
});

// ---------- Richer vocabulary ----------

test("new primitives parse and render (tabs, list, badge, avatar, toggle, chart)", () => {
  const els = compile(`screen S
  tabs "Overview | Activity | Settings" 280,80 480x40
  list "Alpha | Beta | Gamma" 280,140 320x120
  badge "Overdue" 640,80 90x28 danger
  avatar "Jane Doe" 760,80 40x40
  toggle "" 820,80 44x24 active
  progress "60%" 280,300 240x10 info
  chart "Spend by month" 280,340 320x180
  select "Team" 280,540 300x36
  search "Search risks" 620,540 320x36
  textarea "Notes" 280,600 400x96
  checkbox "Email me" 280,720 200x20 active
  radio "Weekly" 500,720 200x20 active
  divider "" 280,760 940x1
  breadcrumb "Home / Risks / Detail" 280,60
  link "View all" 900,80
`);
  // tabs: three labels present, first is ink, rest muted
  for (const t of ["Overview", "Activity", "Settings"]) {
    assert.ok(els.some((e) => e.type === "text" && e.text === t), `tab ${t} missing`);
  }
  // list rows
  for (const t of ["Alpha", "Beta", "Gamma"]) {
    assert.ok(els.some((e) => e.type === "text" && e.text === t), `list item ${t} missing`);
  }
  // avatar initials
  assert.ok(els.some((e) => e.type === "text" && e.text === "JD"), "avatar initials missing");
  // ellipses exist (avatar / toggle knob / radio)
  assert.ok(els.some((e) => e.type === "ellipse"), "no ellipse rendered");
});

test("a trailing variant paints an element with semantic color", () => {
  const els = compile(`screen S
  button "Delete" 280,80 140x40 danger
  button "Save" 440,80 140x40 primary
  badge "Live" 640,80 70x28 success
`);
  // danger button: red border
  assert.ok(
    els.some((e) => e.type === "rectangle" && e.strokeColor === "#d92d20"),
    "danger accent not applied",
  );
  // primary button: solid brand-orange fill + white text
  assert.ok(
    els.some((e) => e.type === "rectangle" && e.backgroundColor === "#fa7b3f"),
    "primary button not brand-filled",
  );
  assert.ok(
    els.some((e) => e.type === "text" && e.text === "Save" && e.strokeColor === "#ffffff"),
    "primary button text not white",
  );
  // success badge: green fill tint
  assert.ok(
    els.some((e) => e.type === "rectangle" && e.backgroundColor === "#e8f5e9"),
    "success badge tint missing",
  );
});

test("status color (danger/success/warning/info) appears ONLY via variants", () => {
  const els = compile(`screen S
  navbar "App | Home | Reports"
  sidebar "Overview | Settings"
  tabs "A | B | C" 280,80 480x40
  list "One | Two" 280,140 320x80
  progress "40%" 280,240 240x10
  avatar "Sam Lee" 640,80 40x40
  chart "Trend" 280,300 320x180
  select "Pick" 280,520 300x36
`);
  const leaked = els.filter(
    (e) =>
      (e.backgroundColor && STATUS_COLORS.test(e.backgroundColor)) ||
      (e.strokeColor && STATUS_COLORS.test(e.strokeColor)),
  );
  assert.deepEqual(leaked, [], `status color leaked without a variant: ${JSON.stringify(leaked)}`);
});

test("table `row` lines render real cell content", () => {
  const els = compile(`screen S
  table "Risk | Owner | Status" 280,120 900x200
    row "Edge servers | Platform | Open"
    row "Stale creds | Security | Overdue"
`);
  for (const cell of ["Edge servers", "Platform", "Open", "Stale creds", "Security", "Overdue"]) {
    assert.ok(els.some((e) => e.type === "text" && e.text === cell), `cell ${cell} missing`);
  }
});

test("long table cells are clipped to their column (no overflow into the next)", () => {
  const els = compile(`screen S
  table "Claim | When" 0,0 400x120
    row "Client dinner — Acme pitch and follow-up | Jul 8"
`);
  const cell = els.find((e) => e.type === "text" && /^Client dinner/.test(e.text ?? ""));
  assert.ok(cell, "claim cell missing");
  assert.ok(cell!.text!.endsWith("…"), `expected truncation, got "${cell!.text}"`);
  // the neighbour cell in the next column is untouched
  assert.ok(els.some((e) => e.type === "text" && e.text === "Jul 8"), "neighbour cell missing");
});

test("progress fill width tracks the fraction in the label", () => {
  const half = compile(`screen S\n  progress "50%" 0,0 200x10\n`);
  const full = compile(`screen S\n  progress "100%" 0,0 200x10\n`);
  // The fill bar is the height-10 rect painted the default bar color (#6c757d).
  const fillW = (els: El[]) =>
    Math.max(
      ...els
        .filter((e) => e.type === "rectangle" && e.height === 10 && e.backgroundColor === "#6c757d")
        .map((e) => e.width),
    );
  assert.ok(fillW(half) < fillW(full), `progress fill did not grow: ${fillW(half)} vs ${fillW(full)}`);
});
