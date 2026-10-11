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

import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { Editor } from "@tiptap/core";
import { setDocFile } from "@aep/collab-doc";
import { SpecEditor } from "./SpecEditor";

// The editor lives as long as its file is open: what changes how the file is
// drawn reaches the open editor, so the user's undo history and cursor survive
// it. A new editor per change was why Ctrl+Z did nothing on the platform.

const PATH = "specs/requirements/prd.md";
const props = {
  path: PATH,
  files: [],
  index: { entries: new Map(), retired: new Map() },
  onOpen: () => {},
};

function productFragment(): Y.XmlFragment {
  const doc = new Y.Doc();
  setDocFile(doc, PATH, "# Onboarding\n\n## Fog\n\n- Whether contractors count as new hires.\n");
  return doc.getXmlFragment(PATH);
}

async function openEditor(container: HTMLElement): Promise<{ dom: Element; editor: Editor }> {
  const dom = await waitFor(() => {
    const el = container.querySelector(".ProseMirror");
    if (!el) throw new Error("no editor yet");
    return el;
  });
  return { dom, editor: (dom as Element & { editor: Editor }).editor };
}

describe("SpecEditor", () => {
  it("draws new options in the open editor, and Ctrl+Z still undoes what was typed", async () => {
    const fragment = productFragment();
    const { container, rerender } = render(<SpecEditor fragment={fragment} {...props} />);
    const { dom, editor } = await openEditor(container);

    act(() => void editor.chain().focus("end").insertContent(" typed").run());
    rerender(<SpecEditor fragment={fragment} {...props} hideFog />);

    expect(container.querySelector(".ProseMirror")).toBe(dom);
    expect(container.querySelector(".aep-hidden")).not.toBeNull();
    act(() => void editor.commands.undo());
    expect(dom.textContent).not.toContain("typed");
  });
});
