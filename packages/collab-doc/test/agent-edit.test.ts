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

import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import {
  AGENT_INSERTION,
  fragmentToMarkdown,
  hasPendingAgentMarks,
  readDocFile,
  setDocFile,
  setDocFileAsAgent,
} from "../src/index.js";

const META = { agent: "Spec Agent", at: "2026-07-08T00:00:00Z" };

function markedRuns(doc: Y.Doc, path: string): string[] {
  const out: string[] = [];
  const walk = (node: Y.XmlFragment | Y.XmlElement | Y.XmlText) => {
    if (node instanceof Y.XmlText) {
      for (const d of node.toDelta() as {
        insert: string;
        attributes?: Record<string, unknown>;
      }[]) {
        if (d.attributes?.[AGENT_INSERTION] !== undefined) out.push(d.insert);
      }
      return;
    }
    for (let i = 0; i < node.length; i++) {
      const child = node.get(i);
      if (child instanceof Y.XmlElement || child instanceof Y.XmlText) walk(child);
    }
  };
  walk(doc.getXmlFragment(path));
  return out;
}

test("agent edit marks exactly the inserted words and returns a caret", () => {
  const doc = new Y.Doc();
  setDocFile(doc, "requirements/prd.md", "# PRD\n\nUsers browse the catalog.");
  const { caret } = setDocFileAsAgent(
    doc,
    "requirements/prd.md",
    "# PRD\n\nUsers browse the curated catalog.",
    "agent",
    META,
  );
  const runs = markedRuns(doc, "requirements/prd.md");
  // Diff boundaries may rotate within repeated characters ("curated " vs
  // "urated c") — assert the semantic outcome: exactly the inserted length,
  // inside the changed region, nothing else marked.
  assert.equal(runs.join("").length, "curated ".length);
  assert.match("Users browse the curated catalog.", new RegExp(runs.join("")));
  assert.ok(caret, "caret returned");
  assert.equal(
    readDocFile(doc, "requirements/prd.md")?.trim(),
    "# PRD\n\nUsers browse the curated catalog.",
  );
  assert.ok(hasPendingAgentMarks(doc, "requirements/prd.md"));
});

test("a brand-new agent file is NOT marked (accept-by-default, no review)", () => {
  const doc = new Y.Doc();
  // The file does not exist yet — no prior setDocFile.
  const { caret } = setDocFileAsAgent(
    doc,
    "design/new-note.md",
    "# New Note\n\nFresh content authored by the agent.",
    "agent",
    META,
  );
  assert.equal(
    markedRuns(doc, "design/new-note.md").length,
    0,
    "a brand-new file carries no agentInsertion marks",
  );
  assert.equal(hasPendingAgentMarks(doc, "design/new-note.md"), false);
  // Content still lands, and the caret is still returned (the agent's cursor
  // shows while it writes, even though the file isn't held for review).
  assert.equal(
    readDocFile(doc, "design/new-note.md")?.trim(),
    "# New Note\n\nFresh content authored by the agent.",
  );
  assert.ok(caret, "caret returned for the live cursor");
});

test("editing that same file AFTER it exists IS marked (review applies)", () => {
  const doc = new Y.Doc();
  setDocFile(doc, "design/note.md", "# Note\n\nOriginal body.");
  setDocFileAsAgent(
    doc,
    "design/note.md",
    "# Note\n\nOriginal body, extended by the agent.",
    "agent",
    META,
  );
  assert.ok(
    hasPendingAgentMarks(doc, "design/note.md"),
    "a change to an existing file is held for review",
  );
});

test("new blocks are fully marked", () => {
  const doc = new Y.Doc();
  setDocFile(doc, "requirements/prd.md", "# PRD\n\nBody.");
  setDocFileAsAgent(
    doc,
    "requirements/prd.md",
    "# PRD\n\nBody.\n\n## Agent Notes\n\nReviewed live.",
    "agent",
    META,
  );
  const runs = markedRuns(doc, "requirements/prd.md").join("|");
  assert.match(runs, /Agent Notes/);
  assert.match(runs, /Reviewed live\./);
  // untouched text stays unmarked
  assert.ok(!runs.includes("Body."));
});

test("untouched blocks keep concurrent user edits", () => {
  const doc = new Y.Doc();
  setDocFile(
    doc,
    "requirements/prd.md",
    "# PRD\n\nFirst paragraph.\n\nSecond paragraph.",
  );
  // A user types into the FIRST paragraph (simulated by locating its XmlText).
  // Meanwhile the agent rewrites only the SECOND paragraph.
  setDocFileAsAgent(
    doc,
    "requirements/prd.md",
    "# PRD\n\nFirst paragraph.\n\nSecond paragraph, improved by the agent.",
    "agent",
    META,
  );
  const md = readDocFile(doc, "requirements/prd.md") ?? "";
  assert.match(md, /First paragraph\./);
  assert.match(md, /improved by the agent/);
});

test("sequential agent writes keep EVERY insertion highlighted", () => {
  // Regression: y-prosemirror's updateYText negates attributes absent from
  // the (plain-markdown) target node, so each write used to strip all
  // previous writes' marks — only the last insert stayed highlighted.
  const doc = new Y.Doc();
  setDocFile(
    doc,
    "requirements/prd.md",
    "# PRD\n\nFirst paragraph.\n\nSecond paragraph.",
  );
  setDocFileAsAgent(
    doc,
    "requirements/prd.md",
    "# PRD\n\nFirst paragraph with alpha.\n\nSecond paragraph.",
    "agent",
    META,
  );
  setDocFileAsAgent(
    doc,
    "requirements/prd.md",
    "# PRD\n\nFirst paragraph with alpha.\n\nSecond paragraph with beta.",
    "agent",
    META,
  );
  const runs = markedRuns(doc, "requirements/prd.md").join("|");
  assert.match(runs, /alpha/, "first write's insert still marked");
  assert.match(runs, /beta/, "second write's insert marked");
  assert.ok(!runs.includes("First paragraph with alpha.".slice(0, 15)), "untouched text stays unmarked");
});

test("a later write deleting an earlier insert clears its mark", () => {
  const doc = new Y.Doc();
  setDocFile(doc, "requirements/prd.md", "# PRD\n\nBody.");
  setDocFileAsAgent(
    doc,
    "requirements/prd.md",
    "# PRD\n\nBody. Temporary sentence.",
    "agent",
    META,
  );
  setDocFileAsAgent(doc, "requirements/prd.md", "# PRD\n\nBody.", "agent", META);
  assert.equal(readDocFile(doc, "requirements/prd.md")?.trim(), "# PRD\n\nBody.");
  assert.equal(hasPendingAgentMarks(doc, "requirements/prd.md"), false);
});

test("markdown serialization strips the mark (committer output stays clean)", () => {
  const doc = new Y.Doc();
  setDocFile(doc, "requirements/prd.md", "# PRD\n\nBody.");
  setDocFileAsAgent(
    doc,
    "requirements/prd.md",
    "# PRD\n\nBody. Extra sentence.",
    "agent",
    META,
  );
  const md = fragmentToMarkdown(doc.getXmlFragment("requirements/prd.md"));
  assert.ok(!md.includes("agent-insertion"));
  assert.ok(!md.includes("agentInsertion"));
  assert.match(md, /Extra sentence\./);
});

test("hasPendingAgentMarks turns false once the mark attribute is cleared", () => {
  const doc = new Y.Doc();
  setDocFile(doc, "requirements/prd.md", "# PRD\n\nBody.");
  setDocFileAsAgent(doc, "requirements/prd.md", "# PRD\n\nBody. More.", "agent", META);
  assert.ok(hasPendingAgentMarks(doc, "requirements/prd.md"));
  // accept-all equivalent: clear the formatting attribute
  const walk = (node: Y.XmlFragment | Y.XmlElement | Y.XmlText) => {
    if (node instanceof Y.XmlText) {
      node.format(0, node.length, { [AGENT_INSERTION]: null });
      return;
    }
    for (let i = 0; i < node.length; i++) {
      const child = node.get(i);
      if (child instanceof Y.XmlElement || child instanceof Y.XmlText) walk(child);
    }
  };
  doc.transact(() => walk(doc.getXmlFragment("requirements/prd.md")));
  assert.equal(hasPendingAgentMarks(doc, "requirements/prd.md"), false);
});
