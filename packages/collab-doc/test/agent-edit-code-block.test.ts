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

// An agent edit inside a fenced block (lunch-order-l29, 2026-10-11): the
// design agent renamed one field inside domain-model.md's ```mermaid block,
// and the room committed the file with the whole block gone. A code block
// allows no marks in the shared schema, so marking the edit inside it built
// a Y structure the schema rejects; y-prosemirror, on reading it with that
// schema (the console's editor and its line index both do), deletes the
// rejected block from the shared doc as a "concurrent action" recovery.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import { AgentInsertion, readDocFile, setDocFile, setDocFileAsAgent } from "../src/index.js";

const PATH = "design/domain-model.md";
const META = { agent: "Spec Agent", at: "2026-10-11T08:00:40Z" };
// The console's schema (apps/console/src/features/spec/collab/specSchema.ts).
const schema = getSchema([StarterKit, AgentInsertion]);

const BEFORE = [
  "# Domain model",
  "",
  "Each day has one menu of typed-in items.",
  "",
  "```mermaid",
  "erDiagram",
  "    ORDER {",
  "        uuid id PK",
  "        string userName",
  "    }",
  "```",
  "",
  "An order always holds at least one item.",
].join("\n");

const AFTER = BEFORE.replace("        string userName", '        string staffName "display name shown on the order list"');

test("an agent edit inside a fenced block survives a schema-checked read of the file", () => {
  const doc = new Y.Doc();
  setDocFile(doc, PATH, BEFORE);
  setDocFileAsAgent(doc, PATH, AFTER, "agent", META);

  // What every console peer does on each doc update (useSpecLines) and on
  // opening the file (the editor's sync plugin).
  yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(PATH), schema);

  assert.equal(readDocFile(doc, PATH), AFTER);
});

test("an agent edit inside a fenced block reaches a second peer intact", () => {
  const room = new Y.Doc();
  const browser = new Y.Doc();
  room.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "sync") Y.applyUpdate(browser, u, "sync");
  });
  browser.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "sync") Y.applyUpdate(room, u, "sync");
  });
  setDocFile(room, PATH, BEFORE);
  setDocFileAsAgent(room, PATH, AFTER, "agent", META);

  yXmlFragmentToProseMirrorRootNode(browser.getXmlFragment(PATH), schema);

  assert.equal(readDocFile(room, PATH), AFTER);
});
