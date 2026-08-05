// @vitest-environment jsdom
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { MermaidCodeBlock, setMermaidRenderer } from "./MermaidCodeBlock";

// jsdom cannot run real mermaid (it measures rendered SVG text), so the test
// seam injects a fake renderer; the assertions cover the VIEW contract — when
// the diagram shows, when the source shows, and what an error leaves visible.

function makeEditor(content: string, language = "mermaid") {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    extensions: [StarterKit.configure({ codeBlock: false, undoRedo: false }), MermaidCodeBlock],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        {
          type: "codeBlock",
          attrs: { language },
          content: content ? [{ type: "text", text: content }] : [],
        },
      ],
    },
  });
  return { editor, el };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("MermaidCodeBlock", () => {
  beforeEach(() => {
    setMermaidRenderer(vi.fn(async (_id: string, src: string) => {
      if (src.includes("broken")) throw new Error("Parse error on line 1");
      return { svg: `<svg data-src="ok"></svg>` };
    }));
  });
  afterEach(() => {
    setMermaidRenderer(null);
    document.body.innerHTML = "";
  });

  it("renders the diagram while unfocused and flips to source on focus inside", async () => {
    const { editor, el } = makeEditor("graph TD; A-->B");
    await flush();

    const preview = el.querySelector<HTMLElement>('[data-testid="mermaid-preview"]')!;
    const pre = el.querySelector<HTMLElement>('[data-testid="mermaid-block"] pre')!;
    expect(preview.style.display).not.toBe("none");
    expect(preview.innerHTML).toContain("svg");
    expect(pre.style.display).toBe("none");

    // Cursor into the block → source is editable, diagram hidden.
    editor.commands.focus(editor.state.doc.content.size - 2);
    await flush();
    expect(pre.style.display).not.toBe("none");
    expect(preview.style.display).toBe("none");
  });

  it("keeps the source visible with an error note on a parse failure", async () => {
    const { el } = makeEditor("broken graph");
    await flush();

    const pre = el.querySelector<HTMLElement>('[data-testid="mermaid-block"] pre')!;
    const error = el.querySelector<HTMLElement>('[data-testid="mermaid-error"]')!;
    expect(pre.style.display).not.toBe("none");
    expect(error.style.display).not.toBe("none");
    expect(error.textContent).toContain("Parse error");
  });

  it("leaves non-mermaid code blocks as plain source", async () => {
    const { el } = makeEditor("console.log(1)", "ts");
    await flush();
    const preview = el.querySelector<HTMLElement>('[data-testid="mermaid-preview"]')!;
    expect(preview.style.display).toBe("none");
  });
});
