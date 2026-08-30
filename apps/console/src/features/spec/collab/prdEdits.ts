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

// The PRD's direct edits (#652): the three verdicts on an `*assumed*` run that
// change the document without an agent turn.
//
// No model is involved, and that is the point. An assumption is a decision the
// agent already made; agreeing, dropping or handing it back are the user's
// verdicts on it, and the document itself is the signal the agent reads on its
// next round. So these run instantly, and they stay live while an agent holds
// the turn — the moment a reviewer is most likely to be reading flagged lines.
//
// Every edit is one transaction, so it is one undo, and it goes through the
// collab sync like any keystroke.

import { Fragment, type Node as PmNode, type Schema } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { PrdLens } from "../lib/prdLenses";

export type PrdEditLens = Extract<PrdLens, { kind: "edit" }>;

/** Apply the lens's verdict to the view's current document. */
export function applyPrdEdit(view: EditorView, lens: PrdEditLens): void {
  const tr = view.state.tr;
  switch (lens.edit) {
    case "agree":
      stripFlag(tr, lens);
      break;
    case "remove":
      deleteBlock(tr, lens);
      break;
    case "reopen":
      reopen(tr, lens);
      break;
  }
  if (tr.docChanged) view.dispatch(tr.scrollIntoView());
}

/**
 * Agree: delete the `*assumed*` run, and the one space that went with it, so
 * "slot *assumed* — nobody" reads "slot — nobody" and a trailing flag leaves no
 * dangling space behind.
 */
function stripFlag(tr: Transaction, lens: PrdEditLens): void {
  const { from, to } = lens.run;
  const contentStart = lens.block.from + 1;
  const contentEnd = lens.block.contentEnd;
  const before = from > contentStart ? tr.doc.textBetween(from - 1, from) : "";
  const after = to < contentEnd ? tr.doc.textBetween(to, to + 1) : "";
  tr.delete(from, to);
  // After the delete, the character that followed the run now sits at `from`.
  if (before === " " && after === " ") tr.delete(from, from + 1);
  else if (before === " " && after === "") tr.delete(from - 1, from);
  else if (before === "" && after === " ") tr.delete(from, from + 1);
}

/**
 * The range that removes the block WHOLE. A list entry is the paragraph inside
 * its `listItem` (see `docBlocks`), and dropping only the paragraph would leave
 * an empty bullet — so the item goes. `deleteRange` widens to a fully-covered
 * parent, which is what removes the list itself when this was its last entry.
 */
function blockRange(doc: PmNode, lens: PrdEditLens): { from: number; to: number } {
  const $pos = doc.resolve(lens.block.from + 1);
  const depth = $pos.depth;
  if (depth > 1 && $pos.node(depth - 1).type.name === "listItem") {
    return { from: $pos.before(depth - 1), to: $pos.after(depth - 1) };
  }
  return { from: $pos.before(depth), to: $pos.after(depth) };
}

function deleteBlock(tr: Transaction, lens: PrdEditLens): void {
  const { from, to } = blockRange(tr.doc, lens);
  tr.deleteRange(from, to);
}

const OPEN_QUESTIONS = "open questions";
const FURTHER_NOTES = "further notes";
const norm = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, " ");
const isList = (node: PmNode): boolean =>
  node.type.name === "orderedList" || node.type.name === "bulletList";

/**
 * Reopen: the block leaves where it was and lands under Open Questions,
 * verbatim minus the flag, as a new entry.
 *
 * It reads as a statement rather than a question, and that matters less than
 * it sounds: Open Questions IS the agent's agenda, so on its next round it
 * takes the entry up and rephrases it. This hands the agent a fact; it does not
 * publish a document. A section that does not exist yet is created, numbered
 * as the PRD contract has it, before Further Notes if there is one.
 */
function reopen(tr: Transaction, lens: PrdEditLens): void {
  const schema = tr.doc.type.schema;
  stripFlag(tr, lens);

  // The entry's content, read AFTER the flag is gone and BEFORE the block is.
  const $block = tr.doc.resolve(lens.block.from + 1);
  const content = $block.parent.content;
  const level = sectionLevel(tr.doc, lens.block.from);

  const { from, to } = blockRange(tr.doc, lens);
  tr.deleteRange(from, to);

  const entry = listItem(schema, content);
  const target = openQuestionsTarget(tr.doc);
  if (target.kind === "list") {
    tr.insert(target.end, entry);
    return;
  }
  const list = listNode(schema, entry);
  if (target.kind === "heading") {
    tr.insert(target.after, list);
    return;
  }
  const heading = schema.nodes.heading!.create({ level }, schema.text("Open Questions"));
  tr.insert(target.at, [heading, list]);
}

function listItem(schema: Schema, content: Fragment): PmNode {
  return schema.nodes.listItem!.create(null, schema.nodes.paragraph!.create(null, content));
}

function listNode(schema: Schema, entry: PmNode): PmNode {
  const type = schema.nodes.orderedList ?? schema.nodes.bulletList!;
  return type.create(null, entry);
}

/** The heading depth the block sits under, so a created section matches its siblings. */
function sectionLevel(doc: PmNode, before: number): number {
  let level = 2;
  doc.descendants((node, pos) => {
    if (pos >= before) return false;
    if (node.type.name === "heading") level = Number(node.attrs.level) || 2;
    return !node.isTextblock;
  });
  return level;
}

type Target =
  | { kind: "list"; end: number }
  | { kind: "heading"; after: number }
  | { kind: "absent"; at: number };

/**
 * Where the reopened entry goes: the end of the list under Open Questions, or
 * just after its heading when the section is empty, or — with no section at
 * all — before Further Notes, else the end of the document.
 */
function openQuestionsTarget(doc: PmNode): Target {
  let headingAfter: number | null = null;
  let furtherNotesAt: number | null = null;
  let result: Target | null = null;
  doc.forEach((child, offset) => {
    if (result) return;
    if (child.type.name === "heading") {
      const text = norm(child.textContent);
      if (headingAfter !== null) {
        // The next heading closed an empty Open Questions section.
        result = { kind: "heading", after: headingAfter };
        return;
      }
      if (text === OPEN_QUESTIONS) headingAfter = offset + child.nodeSize;
      else if (text === FURTHER_NOTES && furtherNotesAt === null) furtherNotesAt = offset;
      return;
    }
    if (headingAfter !== null && isList(child)) {
      result = { kind: "list", end: offset + child.nodeSize - 1 };
    }
  });
  if (result) return result;
  if (headingAfter !== null) return { kind: "heading", after: headingAfter };
  return { kind: "absent", at: furtherNotesAt ?? doc.content.size };
}
