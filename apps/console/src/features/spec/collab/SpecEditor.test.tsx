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
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { Editor } from "@tiptap/core";
import { AGENT_INSERTION, readDocFile, setDocFile } from "@aep/collab-doc";
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

const NOTICE = "can't be edited here safely";
const DIAGRAM = "# Domain model\n\n```mermaid\nerDiagram\n    ORDER {\n        string staffName\n    }\n```\n\nAn order holds one item.";

/** A code block carrying an agent mark: the schema allows none there (lunch-order-l29). */
function markCodeBlock(fragment: Y.XmlFragment): void {
  ((fragment.get(1) as Y.XmlElement).get(0) as Y.XmlText).format(0, 10, {
    [AGENT_INSERTION]: { agent: "Spec Agent", at: "2026-10-11T08:00:40Z" },
  });
}

function diagramFragment(): Y.XmlFragment {
  const doc = new Y.Doc();
  setDocFile(doc, PATH, DIAGRAM);
  return doc.getXmlFragment(PATH);
}

describe("SpecEditor", () => {
  afterEach(() => vi.restoreAllMocks());

  it("binds a file the schema reads whole, editable and with no notice", async () => {
    const fragment = diagramFragment();
    const { container } = render(<SpecEditor fragment={fragment} {...props} />);
    const { dom, editor } = await openEditor(container);

    expect(editor.isEditable).toBe(true);
    expect(container.textContent).not.toContain(NOTICE);
    act(() => void editor.chain().focus("end").insertContent(" Typed.").run());
    expect(readDocFile(fragment.doc!, PATH)).toContain("Typed.");
    expect(dom.textContent).toContain("erDiagram");
  });

  it("opens a file holding content the schema rejects read-only, and the doc is byte-identical after mount", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fragment = diagramFragment();
    markCodeBlock(fragment);
    const doc = fragment.doc!;
    const before = Y.encodeStateAsUpdate(doc);

    const { container } = render(<SpecEditor fragment={fragment} {...props} />);
    const { dom, editor } = await openEditor(container);

    expect(editor.isEditable).toBe(false);
    expect(container.textContent).toContain(NOTICE);
    expect(dom.textContent).toContain("staffName");
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(readDocFile(doc, PATH)).toBe(DIAGRAM);
  });

  it("follows the fragment while read-only, and binds once the content is whole again", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fragment = diagramFragment();
    markCodeBlock(fragment);
    const { container } = render(<SpecEditor fragment={fragment} {...props} />);
    await openEditor(container);

    // The agent rewrites the file: the marked block goes, a whole one comes.
    act(() => setDocFile(fragment.doc!, PATH, DIAGRAM.replace("staffName", "displayName")));

    await waitFor(() => expect(container.textContent).not.toContain(NOTICE));
    const { dom, editor } = await openEditor(container);
    expect(editor.isEditable).toBe(true);
    expect(dom.textContent).toContain("displayName");
  });

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
