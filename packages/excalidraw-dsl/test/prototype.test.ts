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
import { tryDslToPrototype, dslToExcalidraw } from "../src/index.js";

type El = {
  type: string; x: number; y: number; width: number; height: number;
  text?: string; link?: string | null;
};

const DSL = `screen Login "Sign-in for all roles"
  input "Email"
  button "Sign in" primary -> Dashboard
screen Dashboard
  navbar "App | Home"
  button "Log out" -> login
  button "Nowhere" -> Missing
flow
  Login -> Dashboard
`;

function model(dsl: string) {
  const res = tryDslToPrototype(dsl);
  assert.ok(res.ok, `expected ok, got ${!res.ok ? res.error : ""}`);
  return res.model;
}
function elements(sceneJson: string): El[] {
  return JSON.parse(sceneJson).elements as El[];
}

test("model lists every screen with metadata", () => {
  const m = model(DSL);
  assert.equal(m.screens.length, 2);
  assert.equal(m.screens[0]!.name, "Login");
  assert.equal(m.screens[0]!.description, "Sign-in for all roles");
  assert.equal(m.screens[0]!.width, 1280);
  assert.equal(m.screens[1]!.name, "Dashboard");
});

test("each scene is one screen with its frame at origin and no canvas decorations", () => {
  const m = model(DSL);
  const els = elements(m.screens[0]!.sceneJson);
  const frame = els.find((e) => e.type === "rectangle" && e.x === 0 && e.y === 0 && e.width === 1280);
  assert.ok(frame, "screen frame rect not at origin");
  const texts = els.filter((e) => e.type === "text").map((e) => e.text ?? "");
  assert.ok(!texts.includes("Login"), "screen title must be suppressed");
  assert.ok(!texts.some((t) => t.startsWith("Screen ")), "screen-number badge must be suppressed");
  assert.ok(!texts.some((t) => t.includes("→ Screen")), "nav markers must be suppressed");
  assert.ok(!texts.includes("Sign-in for all roles"), "description subtitle must be suppressed");
});

test("prototype scenes carry no Excalidraw links — navigation is overlay-driven, not link-driven", () => {
  const m = model(DSL);
  for (const s of m.screens) {
    const els = elements(s.sceneJson);
    assert.ok(
      els.every((e) => (e.link ?? null) === null),
      `screen ${s.name}: expected every element's link to be null`,
    );
  }
});

test("hotspot matches the navigable control's laid-out box and canonical target", () => {
  const m = model(DSL);
  const hs = m.screens[0]!.hotspots;
  assert.equal(hs.length, 1);
  assert.equal(hs[0]!.target, "Dashboard");
  const els = elements(m.screens[0]!.sceneJson);
  const btnRect = els.find((e) => e.type === "rectangle" && e.x === hs[0]!.x && e.y === hs[0]!.y)!;
  assert.equal(hs[0]!.width, btnRect.width);
  assert.equal(hs[0]!.height, btnRect.height);
});

test("target names resolve case-insensitively to the canonical screen name", () => {
  const m = model(DSL);
  const hs = m.screens[1]!.hotspots; // "Log out" -> login (lowercase)
  const toLogin = hs.find((h) => h.target === "Login");
  assert.ok(toLogin, "lowercase `-> login` should resolve to canonical Login");
});

test("a dead -> target compiles to no link and no hotspot", () => {
  const m = model(DSL);
  const els = elements(m.screens[1]!.sceneJson);
  const nowhere = els.find((e) => e.type === "text" && e.text === "Nowhere")!;
  assert.equal(nowhere.link ?? null, null);
  assert.ok(!m.screens[1]!.hotspots.some((h) => h.target === "Missing"));
});

// A `-> ThisScreen` says "go to where you already are". Agents reach for it to
// mean "this control acts in place" (an Add beside a search box that appends a
// row), so it renders a control that invites a click and then cannot change
// anything — indistinguishable from broken. The skill states the rule; the
// compiler refuses to advertise the affordance.
test("a self-targeting -> compiles to no hotspot", () => {
  const m = model(`screen LogSession
  search "Add exercise…"
  button "Add" -> LogSession
  button "Done" -> Summary
screen Summary
`);
  const logSession = m.screens[0]!;
  assert.ok(
    !logSession.hotspots.some((h) => h.target === "LogSession"),
    "a self-target must not produce a hotspot",
  );
  assert.equal(logSession.hotspots.length, 1, "the cross-screen target survives");
  assert.equal(logSession.hotspots[0]!.target, "Summary");
});

test("a self-target is dropped case-insensitively", () => {
  const m = model(`screen LogSession
  button "Add" -> logsession
screen Summary
`);
  assert.equal(m.screens[0]!.hotspots.length, 0);
});

test("prototype compile is deterministic", () => {
  const a = model(DSL).screens[0]!.sceneJson;
  const b = model(DSL).screens[0]!.sceneJson;
  assert.equal(a, b);
});

test("empty and screenless sources fail softly", () => {
  assert.equal(tryDslToPrototype("").ok, false);
  assert.equal(tryDslToPrototype("// just a comment\n").ok, false);
});

test("canvas compile is unchanged: decorations present, links null", () => {
  const els = JSON.parse(dslToExcalidraw("wireframes", DSL)).elements as El[];
  const texts = els.filter((e) => e.type === "text").map((e) => e.text ?? "");
  assert.ok(texts.some((t) => t.includes("→ Screen")), "canvas keeps nav markers");
  assert.ok(texts.includes("Login"), "canvas keeps screen titles");
  assert.ok(els.every((e) => (e.link ?? null) === null), "canvas emits no links");
});
