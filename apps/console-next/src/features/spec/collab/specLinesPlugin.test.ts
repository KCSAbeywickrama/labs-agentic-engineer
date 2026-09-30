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
import * as Y from "yjs";
import { yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import { markdownToNode, setDocFile, setDocFileAsAgent } from "@aep/collab-doc";
import { parseLine } from "../model/ids";
import { blockingEntries } from "../model/questions";
import { docLines } from "./docLines";
import { specSchema } from "./specSchema";
import { lineMarks, type LineMark } from "./specLinesPlugin";

// Decoration ranges, on a document parsed by the same pipeline the room uses:
// what each range covers is checked by the text it spans.

function marksOf(markdown: string) {
  const doc = markdownToNode(markdown);
  const spanned = (m: LineMark) => ("at" in m ? "" : doc.textBetween(m.from, m.to, "\n"));
  const lines = docLines(doc);
  const blocking = new Set(blockingEntries(lines).map((e) => e.line));
  return lines.flatMap((line) =>
    lineMarks(line, parseLine(line.text, line.emphasis), blocking.has(line)).map((m) => ({ ...m, text: spanned(m) })),
  );
}

describe("lineMarks", () => {
  it("draws a story's ID, its sources, and its references over exactly their text", () => {
    const marks = marksOf("- F2.5 As finance, I approve after F2.1. [T&E policy p.7]\n");
    expect(marks.map((m) => [m.kind, m.text])).toEqual([
      ["line", "F2.5 As finance, I approve after F2.1. [T&E policy p.7]"],
      ["sid", "F2.5"],
      ["source", "[T&E policy p.7]"],
      ["ref", "F2.1"],
    ]);
    expect(marks[0]).toMatchObject({ kind: "line", lineId: "F2.5", assumed: false });
  });

  it("highlights an assumed line, marks the tag itself, and offers its actions after it", () => {
    const marks = marksOf("- A rejected claim goes back to the employee. *assumed*\n");
    expect(marks.map((m) => [m.kind, m.text])).toEqual([
      ["line", "A rejected claim goes back to the employee. assumed"],
      ["assumed", "assumed"],
      ["actions", ""],
    ]);
    expect(marks[0]).toMatchObject({ lineId: null, assumed: true, proposed: false });
    expect(marks[2]).toMatchObject({ body: "A rejected claim goes back to the employee." });
  });

  it("highlights a blocking question with its options, and marks the tag itself", () => {
    const marks = marksOf("## Open Questions\n\n1. One Xero organisation? *blocking*\n   - One for every claim.\n   - One per country.\n");
    expect(marks.map((m) => [m.kind, m.text])).toEqual([
      ["line", "One Xero organisation? blocking\nOne for every claim.\nOne per country."],
      ["blocking", "blocking"],
    ]);
    expect(marks[0]).toMatchObject({ blocking: true, assumed: false, proposed: false });
  });

  it("draws a blocking tag outside Open Questions as nothing but emphasis", () => {
    expect(marksOf("## Decisions\n\n- Claims go to Xero. *blocking*\n")).toEqual([]);
  });

  it("draws a line of the agent's pending proposal as proposed, with no actions of its own", () => {
    const doc = new Y.Doc();
    setDocFile(doc, "f.md", "- F2.5 As finance, I approve.\n");
    setDocFileAsAgent(doc, "f.md", "- F2.5 As finance, I approve.\n- F2.6 As an auditor, I read it. *assumed*\n", "test", {
      agent: "spec-agent",
      at: "t1",
    });
    const pm = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment("f.md"), specSchema);
    const [settled, proposed] = docLines(pm);
    expect(settled!.proposed).toBe(false);
    const marks = lineMarks(proposed!, parseLine(proposed!.text, proposed!.emphasis));
    expect(marks.map((m) => m.kind)).toEqual(["line", "sid", "assumed", "proposed"]);
    expect(marks[0]).toMatchObject({ lineId: "F2.6", proposed: true });
    // The tag sits at the end of the line's words.
    expect(marks.at(-1)).toMatchObject({ kind: "proposed", at: proposed!.to - 1 });
  });

  it("covers the whole list item for the line, and marks a moved line's old ID", () => {
    const doc = markdownToNode("- F5.1 (was F2.3) As a manager, I see the route.\n");
    const [line] = docLines(doc);
    const item = doc.firstChild!.firstChild!;
    expect(item.type.name).toBe("listItem");
    const marks = lineMarks(line!, parseLine(line!.text, line!.emphasis));
    expect(marks[0]).toMatchObject({ kind: "line", from: line!.lineFrom, to: line!.lineFrom + item.nodeSize });
    const was = marks.find((m) => m.kind === "was");
    expect(was && "from" in was && doc.textBetween(was.from, was.to, "\n")).toBe("(was F2.3)");
  });

  it("maps offsets past bold and links to the right positions", () => {
    const marks = marksOf("Rules such as **the audit log** ([P1](product-wide.md)) and P4 apply.\n");
    expect(marks.filter((m) => m.kind === "ref").map((m) => m.text)).toEqual(["P1", "P4"]);
  });
});
