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

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { AGENT_INSERTION, readDocFile, setDocFile } from "@aep/collab-doc";
import { readFragment } from "./readFragment";
import { editFile } from "./specEdits";
import { readSpecLines } from "./useSpecLines";

const PATH = "design/domain-model.md";
const MARKDOWN = "# Domain model\n\n```mermaid\nerDiagram\n    ORDER {\n        string staffName\n    }\n```\n\nAn order holds one item.";

/**
 * The file as the room held it on lunch-order-l29: an agent mark inside a
 * code block, which allows none. Built by hand, as the agent's writer no
 * longer produces it.
 */
function docWithMarkedCodeBlock(): Y.Doc {
  const doc = new Y.Doc();
  setDocFile(doc, PATH, MARKDOWN);
  const code = doc.getXmlFragment(PATH).get(1) as Y.XmlElement;
  expect(code.nodeName).toBe("codeBlock");
  (code.get(0) as Y.XmlText).format(0, 10, { [AGENT_INSERTION]: { agent: "Spec Agent", at: "2026-10-11T08:00:40Z" } });
  return doc;
}

describe("readFragment", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads a file the schema accepts whole", () => {
    const doc = new Y.Doc();
    setDocFile(doc, PATH, MARKDOWN);
    const read = readFragment(doc.getXmlFragment(PATH));
    expect(read.lossless).toBe(true);
    expect(read.doc.childCount).toBe(3);
  });

  it("reads a block the schema rejects without its marks, and leaves the doc untouched", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = docWithMarkedCodeBlock();
    const before = Y.encodeStateAsUpdate(doc);
    const updates = vi.fn();
    doc.on("update", updates);

    const read = readFragment(doc.getXmlFragment(PATH));

    expect(read.lossless).toBe(false);
    expect(read.doc.child(1).type.name).toBe("codeBlock");
    expect(read.doc.child(1).textContent).toContain("staffName");
    expect(updates).not.toHaveBeenCalled();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(readDocFile(doc, PATH)).toBe(MARKDOWN);
    expect(warn).toHaveBeenCalled();
  });

  it("leaves out a node the schema does not know, and leaves the doc untouched", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = new Y.Doc();
    setDocFile(doc, PATH, MARKDOWN);
    doc.getXmlFragment(PATH).insert(1, [new Y.XmlElement("mermaidDiagram")]);
    const before = Y.encodeStateAsUpdate(doc);

    const read = readFragment(doc.getXmlFragment(PATH));

    expect(read.lossless).toBe(false);
    expect(read.doc.childCount).toBe(3);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it("is what the spec's line index reads with: indexing never deletes a block", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = docWithMarkedCodeBlock();
    readSpecLines(doc);
    expect(readDocFile(doc, PATH)).toBe(MARKDOWN);
  });

  it("refuses an edit to a file it could not read whole, so the write cannot drop what the read did", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = docWithMarkedCodeBlock();
    const before = Y.encodeStateAsUpdate(doc);
    const edited = editFile(doc, PATH, (tr) => tr.delete(1, 3));
    expect(edited).toBe(false);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });
});
