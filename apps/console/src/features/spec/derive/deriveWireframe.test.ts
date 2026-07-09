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
  heading "Welcome" 40,40
  button "Go" 40,100 120x40`;

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
});
