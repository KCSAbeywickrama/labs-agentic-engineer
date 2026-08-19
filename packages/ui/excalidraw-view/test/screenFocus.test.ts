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
import {
  elementsOfScreens,
  firstScreenName,
  changedScreenNames,
  openingFocusElements,
  focusTargetScreens,
} from "../src/screenFocus.js";

type El = { id: string; y: number; version: number; customData?: { screen: string } };
const el = (id: string, screen: string, y: number, version = 1): El => ({
  id,
  y,
  version,
  customData: { screen },
});

const SCENE: El[] = [
  el("h1", "Home", 0),
  el("h2", "Home", 40),
  el("l1", "Login", 900),
  el("l2", "Login", 940),
  el("d1", "Detail", 1800),
];

test("elementsOfScreens returns only the named screens' elements", () => {
  assert.deepEqual(
    elementsOfScreens(SCENE, ["Login"]).map((e) => e.id),
    ["l1", "l2"],
  );
  assert.deepEqual(
    elementsOfScreens(SCENE, ["Home", "Detail"]).map((e) => e.id),
    ["h1", "h2", "d1"],
  );
});

test("elementsOfScreens ignores elements with no screen tag", () => {
  const scene = [...SCENE, { id: "x", y: 5, version: 1 } as El];
  assert.deepEqual(elementsOfScreens(scene, ["Home"]).map((e) => e.id), ["h1", "h2"]);
});

test("firstScreenName is the screen whose topmost element is highest on the canvas", () => {
  assert.equal(firstScreenName(SCENE), "Home");
  assert.equal(firstScreenName([...SCENE].reverse()), "Home");
});

test("firstScreenName is null for an empty or untagged scene", () => {
  assert.equal(firstScreenName([]), null);
  assert.equal(firstScreenName([{ id: "x", y: 0, version: 1 } as El]), null);
});

test("an edited element names its screen as changed", () => {
  const next = SCENE.map((e) => (e.id === "l2" ? { ...e, version: 2 } : e));
  assert.deepEqual(changedScreenNames(SCENE, next), ["Login"]);
});

test("edits across several screens name them all, in canvas order", () => {
  const next = SCENE.map((e) => (e.id === "d1" || e.id === "h1" ? { ...e, version: 2 } : e));
  assert.deepEqual(changedScreenNames(SCENE, next), ["Home", "Detail"]);
});

test("a screen that gained an element is changed", () => {
  const next = [...SCENE, el("l3", "Login", 980)];
  assert.deepEqual(changedScreenNames(SCENE, next), ["Login"]);
});

test("a screen that lost an element is changed", () => {
  const next = SCENE.filter((e) => e.id !== "d1");
  assert.deepEqual(changedScreenNames(SCENE, next), ["Detail"]);
});

test("a brand-new screen is changed", () => {
  const next = [...SCENE, el("s1", "Settings", 2700)];
  assert.deepEqual(changedScreenNames(SCENE, next), ["Settings"]);
});

test("a restyled element is changed even when its id and version are identical", () => {
  // The compiler stamps `version: 1` on every element and builds ids from
  // kind + label + position, so a variant-only edit (button → primary) keeps
  // BOTH stable while the rendered colours change. Comparing version alone
  // would report no change and strand the reader on another screen.
  const next = SCENE.map((e) =>
    e.id === "l1" ? { ...e, backgroundColor: "#fa7b3f" } : e,
  ) as El[];
  assert.deepEqual(changedScreenNames(SCENE, next), ["Login"]);
});

test("a screen that only shifted down is NOT changed", () => {
  // Screens stack in one column, so growing an earlier screen pushes every
  // later one down. Those screens are untouched — reporting them would make
  // the focus target the whole board and zoom the canvas out to nothing,
  // which is the failure this guards.
  const next: El[] = [
    el("h1", "Home", 0),
    el("h2", "Home", 40),
    el("h3", "Home", 80), // Home grew by one element…
    // …so Login and Detail shift down by 270, unchanged in themselves.
    el("l1", "Login", 900 + 270),
    el("l2", "Login", 940 + 270),
    el("d1", "Detail", 1800 + 270),
  ];
  assert.deepEqual(changedScreenNames(SCENE, next), ["Home"]);
});

test("a change spanning most of the wireframe is not a focus target", () => {
  // Mid-stream the document is transiently incomplete — screens disappear and
  // come back as the agent rewrites the file — so across those frames every
  // screen looks edited. Focusing their union is the whole board, i.e. the
  // zoomed-out-to-nothing state this feature exists to prevent. A change that
  // broad is a rewrite, not an edit: leave the viewport alone.
  const wiped: El[] = [el("h1", "Home", 0)]; // Login and Detail momentarily gone
  assert.deepEqual(focusTargetScreens(SCENE, wiped), []);
});

test("an edit touching a minority of screens is still a focus target", () => {
  const next = SCENE.map((e) => (e.id === "l2" ? { ...e, backgroundColor: "#fa7b3f" } : e)) as El[];
  assert.deepEqual(focusTargetScreens(SCENE, next), ["Login"]);
});

test("identical scenes report no change", () => {
  assert.deepEqual(changedScreenNames(SCENE, SCENE.map((e) => ({ ...e }))), []);
});

test("with no previous scene nothing is reported as changed", () => {
  assert.deepEqual(changedScreenNames(null, SCENE), []);
});

test("the opening focus is the first screen plus a peek band of the second", () => {
  const scene = [
    { id: "a1", y: 0, height: 32, version: 1, customData: { screen: "Home" } },
    { id: "a2", y: 32, height: 800, version: 1, customData: { screen: "Home" } },
    // second screen: title at 952, frame 984..1784, a body element deep inside
    { id: "b1", y: 952, height: 32, version: 1, customData: { screen: "Login" } },
    { id: "b2", y: 984, height: 800, version: 1, customData: { screen: "Login" } },
    { id: "b3", y: 1500, height: 40, version: 1, customData: { screen: "Login" } },
    { id: "c1", y: 1904, height: 32, version: 1, customData: { screen: "Detail" } },
  ];
  const ids = openingFocusElements(scene).map((e) => e.id);
  assert.ok(ids.includes("a1") && ids.includes("a2"), "whole first screen");
  assert.ok(ids.includes("b1"), "second screen's title is in the peek band");
  assert.ok(!ids.includes("b2"), "second screen's full-height frame is NOT — it would fit both screens");
  assert.ok(!ids.includes("b3"), "deep body of the second screen is not");
  assert.ok(!ids.includes("c1"), "third screen is not");
  const marker = openingFocusElements(scene).find((e) => e.id === "__peek-marker")!;
  assert.ok(marker, "a bounds marker pins the peek depth");
  assert.ok(marker.y > 952 && marker.y < 1500, "marker sits inside the second screen's top band");
});

test("the opening focus falls back to the first screen alone when there is no second", () => {
  const scene = [
    { id: "a1", y: 0, height: 32, version: 1, customData: { screen: "Home" } },
    { id: "a2", y: 32, height: 800, version: 1, customData: { screen: "Home" } },
  ];
  assert.deepEqual(openingFocusElements(scene).map((e) => e.id), ["a1", "a2"]);
});

test("the opening focus is empty for an untagged scene", () => {
  assert.deepEqual(openingFocusElements([{ id: "x", y: 0, height: 10, version: 1 }]), []);
});
