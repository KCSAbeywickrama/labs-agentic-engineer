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

const WIREFRAME = `screen Login
  text "Sign in" 24,24 200x32
  rect "email input" 24,80 320x40
  button "Sign In" 24,140 160x44
screen Dashboard
  text "Welcome" 24,24 200x32
flow
  Login -> Dashboard
`;

test("wireframes DSL compiles to a valid Excalidraw scene", () => {
  const out = JSON.parse(dslToExcalidraw("wireframes", WIREFRAME));
  assert.equal(out.type, "excalidraw");
  assert.ok(Array.isArray(out.elements) && out.elements.length > 0);
  // Only the legal element vocabulary appears.
  const legal = new Set(["rectangle", "ellipse", "diamond", "arrow", "line", "text", "frame"]);
  for (const el of out.elements) assert.ok(legal.has(el.type), `illegal element type: ${el.type}`);
  // Flows render as numbered "→(N)" text markers (no arrow lines by design).
  const texts = out.elements.filter((e: { type: string }) => e.type === "text") as Array<{ text?: string }>;
  assert.ok(texts.some((t) => /→\(\d+\)/.test(t.text ?? "")), "flow marker missing");
});

test("tryDslToExcalidraw reports a parse error instead of throwing", () => {
  const res = tryDslToExcalidraw("wireframes", "screen\n  bogus !!!\n");
  assert.equal(res.ok, false);
});
