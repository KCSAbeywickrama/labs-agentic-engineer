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

import { describe, expect, it } from "vitest";
import { deriveWireframeScene } from "./deriveWireframe";

const dsl = `screen Home
  heading "Welcome"
  button "Go" primary`;

describe("deriveWireframeScene", () => {
  it("compiles a wireframes .dsl into an excalidraw scene with elements", () => {
    const json = deriveWireframeScene("design/components/web/wireframes.dsl", dsl);
    expect(json).not.toBeNull();
    const scene = JSON.parse(json!);
    expect(Array.isArray(scene.elements)).toBe(true);
    expect(scene.elements.length).toBeGreaterThan(0);
  });

  it("returns null (not throw) on DSL that does not compile", () => {
    expect(deriveWireframeScene("design/components/web/wireframes.dsl", "garbage {{{")).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(deriveWireframeScene("x/wireframes.dsl", "")).toBeNull();
  });

  // Streaming: the collab writer flushes whole lines, so a mid-turn source is
  // a PREFIX of the final file. Every line-boundary prefix must compile to the
  // screens written so far — that is what draws the wireframe live.
  it("compiles every line-boundary prefix of a streaming source", () => {
    const full = `screen Catalog "Shoppers browse products"
  navbar "Shop"
  row
    heading "Browse products"
    right
    button "View cart" primary -> Cart
  table "Product | Price"
    row "Mug | $18"

screen Cart "Review and check out"
  navbar "Shop"
  heading "Your cart"
`;
    const lines = full.split("\n");
    for (let i = 1; i <= lines.length; i++) {
      const prefix = lines.slice(0, i).join("\n");
      if (prefix.trim().length === 0) continue;
      const json = deriveWireframeScene("x/wireframes.dsl", prefix);
      expect(json, `prefix of ${i} lines should compile`).not.toBeNull();
    }
    // The full source renders both screens.
    const scene = JSON.parse(deriveWireframeScene("x/wireframes.dsl", full)!);
    const texts = scene.elements.filter((e: { type: string }) => e.type === "text");
    expect(texts.some((t: { text?: string }) => t.text === "Catalog")).toBe(true);
    expect(texts.some((t: { text?: string }) => t.text === "Cart")).toBe(true);
  });
});
