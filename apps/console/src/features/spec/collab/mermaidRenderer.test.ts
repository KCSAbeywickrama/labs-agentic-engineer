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

// Engine-level contract: renders are serialized. Concurrent mermaid.render()
// calls deadlock — a design document mounts every diagram at once, so this is
// what keeps them all resolving.
//
// The VIEW contract (when the diagram shows, when the source shows, and that a
// render never duplicates the document) needs real mermaid and real layout, so
// it lives in the browser lane rather than here — jsdom cannot measure SVG text.

import { afterEach, describe, expect, it } from "vitest";
import { renderMermaid, setMermaidRenderer } from "./mermaidRenderer";

afterEach(() => setMermaidRenderer(null));

describe("renderMermaid", () => {
  it("runs renders one at a time", async () => {
    let active = 0;
    let maxActive = 0;
    setMermaidRenderer(async (_id, source) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return { svg: `<svg>${source}</svg>` };
    });

    const svgs = await Promise.all(["a", "b", "c", "d"].map((s) => renderMermaid(s)));

    expect(maxActive).toBe(1);
    expect(svgs).toEqual(["<svg>a</svg>", "<svg>b</svg>", "<svg>c</svg>", "<svg>d</svg>"]);
  });

  it("keeps the queue alive after a failed render", async () => {
    setMermaidRenderer(async (_id, source) => {
      if (source === "bad") throw new Error("parse error\nline 2");
      return { svg: `<svg>${source}</svg>` };
    });

    await expect(renderMermaid("bad")).rejects.toThrow("parse error");
    await expect(renderMermaid("good")).resolves.toBe("<svg>good</svg>");
  });

  it("gives each render a distinct element id", async () => {
    const ids: string[] = [];
    setMermaidRenderer(async (id) => {
      ids.push(id);
      return { svg: "<svg/>" };
    });

    await renderMermaid("one");
    await renderMermaid("two");

    expect(ids[0]).not.toBe(ids[1]);
  });
});
