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

// @vitest-environment jsdom

// A PRD's references to its feature docs, end to end: markdown parsed by the
// same converter that seeds the collaborative document, then clicked.

import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { markdownToNode } from "@aep/collab-doc";
import { SpecLinks, refreshSpecLinks, type SpecLinkBinding } from "./specLinkPlugin";

const PRD = "specs/requirements/prd.md";
const RECEIPTS = "specs/requirements/features/receipts.md";

const MARKDOWN = `# Expenses — PRD

## User Stories

1. As an Employee, I want to submit an expense — depth in [Receipt capture](features/receipts.md).
2. As a Manager, I want to approve one — depth in [Approvals](features/approvals.md).

## Further Notes

The rules live at [wso2.com](https://wso2.com/policy.md).
`;

let editor: Editor | null = null;
let binding: SpecLinkBinding;

function mount(knownPaths: string[], open = vi.fn()): HTMLElement {
  binding = { path: PRD, knownPaths, open };
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Markdown,
      SpecLinks.configure({ binding: () => binding }),
    ],
    content: markdownToNode(MARKDOWN).toJSON(),
  });
  return element;
}

/** Click the editor where the given text sits, the way ProseMirror sees it. */
function clickOn(text: string): boolean {
  const doc = editor!.state.doc;
  let at = -1;
  doc.descendants((node, pos) => {
    if (node.isText && node.text === text) at = pos + 1;
    return at === -1;
  });
  if (at === -1) throw new Error(`no text node "${text}"`);
  return Boolean(
    editor!.view.someProp("handleClick", (f) =>
      f(editor!.view, at, new MouseEvent("click", { bubbles: true })),
    ),
  );
}

const linked = (el: HTMLElement) =>
  Array.from(el.querySelectorAll(".spec-link")).map((n) => n.textContent);

afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
});

describe("references between spec documents", () => {
  it("marks only the references the project can actually open", () => {
    // `approvals.md` is named but not written yet, so it stays plain text.
    const el = mount([PRD, RECEIPTS]);
    expect(linked(el)).toEqual(["Receipt capture"]);
  });

  it("selects the referenced document instead of leaving the app", () => {
    const open = vi.fn();
    mount([PRD, RECEIPTS], open);
    expect(clickOn("Receipt capture")).toBe(true);
    expect(open).toHaveBeenCalledWith(RECEIPTS);
  });

  it("leaves an external link to the editor's own default", () => {
    const open = vi.fn();
    mount([PRD, RECEIPTS], open);
    expect(clickOn("wso2.com")).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("does not follow a reference to a document nobody has written", () => {
    const open = vi.fn();
    mount([PRD, RECEIPTS], open);
    expect(clickOn("Approvals")).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("comes alive when the agent writes the file it names", () => {
    const el = mount([PRD, RECEIPTS]);
    expect(linked(el)).toEqual(["Receipt capture"]);

    binding = { ...binding, knownPaths: [PRD, RECEIPTS, "specs/requirements/features/approvals.md"] };
    refreshSpecLinks(editor!.view);

    expect(linked(el)).toEqual(["Receipt capture", "Approvals"]);
    expect(clickOn("Approvals")).toBe(true);
  });
});
