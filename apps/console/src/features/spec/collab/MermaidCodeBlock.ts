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

// Mermaid rendering inside the spec markdown editor: a ```mermaid code block
// renders as its live diagram while unfocused, and flips to the ordinary
// editable source when the selection enters it (click or cursor). The
// Yjs-backed source text stays the single truth — the diagram is a pure view,
// so collaboration is untouched. A parse error keeps the source visible with
// the error note instead of a broken diagram.
//
// The design skill emits design.md as a mermaid diagram document (C1 / ER /
// sequence flows), so this is what makes the design read as diagrams in the
// spec view; the extension applies to every markdown file the editor opens.

import CodeBlock from "@tiptap/extension-code-block";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** Lazily-initialized mermaid module — loaded on the first mermaid block, so
 *  documents without diagrams pay nothing. Injectable for tests. */
type RenderFn = (id: string, source: string) => Promise<{ svg: string }>;
let renderImpl: RenderFn | null = null;

/** @knipkeep test seam — unit tests inject a fake renderer (jsdom cannot run
 *  real mermaid, which measures SVG text). */
export function setMermaidRenderer(fn: RenderFn | null): void {
  renderImpl = fn;
}

async function renderMermaid(id: string, source: string): Promise<{ svg: string }> {
  if (!renderImpl) {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
    renderImpl = (renderID, src) => mermaid.render(renderID, src);
  }
  return renderImpl(id, source);
}

let renderSeq = 0;

/** True when the editor's selection touches the given node's range. */
function selectionInside(editor: Editor, getPos: () => number | undefined, node: ProseMirrorNode): boolean {
  const pos = getPos();
  if (pos === undefined) return false;
  const { from, to } = editor.state.selection;
  return from >= pos && to <= pos + node.nodeSize;
}

/**
 * The CodeBlock extension with a mermaid-aware node view. Non-mermaid
 * languages keep the stock code-block rendering (contentDOM only).
 */
export const MermaidCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ({ editor, node, getPos }) => {
      const dom = document.createElement("div");
      dom.dataset.testid = "mermaid-block";

      const pre = document.createElement("pre");
      const code = document.createElement("code");
      pre.appendChild(code);
      dom.appendChild(pre);

      const preview = document.createElement("div");
      preview.dataset.testid = "mermaid-preview";
      preview.style.cursor = "pointer";
      preview.style.overflowX = "auto";
      dom.appendChild(preview);

      const errorNote = document.createElement("div");
      errorNote.dataset.testid = "mermaid-error";
      errorNote.style.cssText = "font-size:12px;color:#b7791f;padding:2px 0;display:none";
      dom.appendChild(errorNote);

      // Clicking the diagram flips to source: put the cursor inside the block.
      preview.addEventListener("click", () => {
        const pos = getPos();
        if (pos !== undefined) {
          editor.commands.focus(pos + 1);
        }
      });

      let currentNode = node;
      let lastRendered = "";

      const isMermaid = () => (currentNode.attrs.language ?? "") === "mermaid";

      const showSource = (withError: string | null) => {
        pre.style.display = "";
        preview.style.display = "none";
        errorNote.style.display = withError ? "" : "none";
        errorNote.textContent = withError ? `mermaid: ${withError}` : "";
      };

      const showPreview = () => {
        pre.style.display = "none";
        preview.style.display = "";
        errorNote.style.display = "none";
      };

      const update = () => {
        if (!isMermaid()) {
          showSource(null);
          return;
        }
        if (selectionInside(editor, getPos, currentNode) && editor.isFocused) {
          showSource(null);
          return;
        }
        const source = currentNode.textContent.trim();
        if (source === "") {
          showSource(null);
          return;
        }
        if (source === lastRendered && preview.childElementCount > 0) {
          showPreview();
          return;
        }
        renderSeq += 1;
        void renderMermaid(`spec-mermaid-${renderSeq}`, source)
          .then(({ svg }) => {
            lastRendered = source;
            preview.innerHTML = svg;
            showPreview();
          })
          .catch((err: unknown) => {
            lastRendered = "";
            showSource(err instanceof Error ? err.message.split("\n")[0] ?? "parse error" : "parse error");
          });
      };

      editor.on("selectionUpdate", update);
      editor.on("focus", update);
      editor.on("blur", update);
      update();

      return {
        dom,
        contentDOM: code,
        update(updated) {
          if (updated.type !== currentNode.type) return false;
          currentNode = updated;
          update();
          return true;
        },
        destroy() {
          editor.off("selectionUpdate", update);
          editor.off("focus", update);
          editor.off("blur", update);
        },
      };
    };
  },
});
