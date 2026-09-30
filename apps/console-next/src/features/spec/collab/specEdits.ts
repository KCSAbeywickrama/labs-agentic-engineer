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

import type { Node as PmNode } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import type * as Y from "yjs";
import { updateYFragment, yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import { AGENT_INSERTION, markdownToNode } from "@aep/collab-doc";
import type { AgentWriter, Proposal, ProposalVerdict } from "../api/specModel";
import { PRD_PATH } from "../model/files";
import { parseLine } from "../model/ids";
import { docLines, type DocLine } from "./docLines";
import { specSchema } from "./specSchema";

// The edits the user makes to the spec by acting on what the agent left in it
// (a line to confirm, a question answered, a proposal settled), as steps on a
// ProseMirror Transform. The editor runs them on its own transaction when the
// action is in the open file; `editFile` runs them on a file's fragment
// directly when it is not. Either way the change lands in the Y.Doc, so once
// the room is wired every peer sees it and the committer writes it.

/** Marks the user's edits made outside an editor. */
const USER_ORIGIN = "console-next:user";

/** Whitespace before the `*assumed*` tag goes with it. */
function tagRange(line: DocLine): { from: number; to: number } | null {
  const tag = parseLine(line.text, line.emphasis).assumed;
  if (!tag) return null;
  let start = tag.start;
  while (start > 0 && /\s/.test(line.text[start - 1]!)) start--;
  return { from: line.posAt(start), to: line.posAt(tag.end) };
}

/** Settle an assumed line: drop its `*assumed*` tag, keep its words. False when it has none. */
export function removeAssumedTag(tr: Transform, line: DocLine): boolean {
  const range = tagRange(line);
  if (!range) return false;
  tr.delete(range.from, range.to);
  return true;
}

/** Where the caret goes to edit an assumed line: after its words, before the tag. */
export function caretBeforeTag(line: DocLine): number {
  return tagRange(line)?.from ?? line.posAt(line.text.length);
}

/** Delete a line: its list item (the whole list, when it is the only item), or its block. */
export function deleteLine(tr: Transform, line: DocLine): void {
  const $line = tr.doc.resolve(line.lineFrom);
  const list = $line.parent;
  if (line.kind === "listItem" && list.childCount === 1 && $line.depth > 0) {
    tr.delete($line.before(), $line.after());
    return;
  }
  tr.delete(line.lineFrom, line.lineTo);
}

/** The line containing a document position. */
export function lineAt(doc: PmNode, pos: number): DocLine | null {
  return docLines(doc).find((l) => pos >= l.from && pos < l.to) ?? null;
}

/** The top-level heading `## <title>` and the block after it, by position. */
function section(doc: PmNode, title: string): { headingEnd: number; next: PmNode | null; nextPos: number } | null {
  let found: { headingEnd: number; next: PmNode | null; nextPos: number } | null = null;
  doc.forEach((node, offset, index) => {
    if (found || node.type.name !== "heading" || Number(node.attrs.level) > 2) return;
    if (node.textContent.trim().toLowerCase() !== title.toLowerCase()) return;
    const end = offset + node.nodeSize;
    found = { headingEnd: end, next: index + 1 < doc.childCount ? doc.child(index + 1) : null, nextPos: end };
  });
  return found;
}

/**
 * Add a settled line to the end of a section's list: the section is created
 * at the end of the document when missing, and its list after the heading.
 */
export function appendToSection(tr: Transform, title: string, text: string): void {
  const { nodes } = tr.doc.type.schema;
  const item = nodes.listItem!.create(null, nodes.paragraph!.create(null, tr.doc.type.schema.text(text)));
  const found = section(tr.doc, title);
  if (!found) {
    tr.insert(tr.doc.content.size, [
      nodes.heading!.create({ level: 2 }, tr.doc.type.schema.text(title)),
      nodes.bulletList!.create(null, item),
    ]);
    return;
  }
  if (found.next?.type.name === "bulletList") {
    tr.insert(found.nextPos + found.next.nodeSize - 1, item);
    return;
  }
  tr.insert(found.headingEnd, nodes.bulletList!.create(null, item));
}

/** Delete a section's list entry by its words. False when there is no such entry. */
export function deleteSectionItem(tr: Transform, title: string, text: string): boolean {
  const found = section(tr.doc, title);
  if (!found || found.next?.type.name !== "bulletList") return false;
  const listEnd = found.nextPos + found.next.nodeSize;
  const line = docLines(tr.doc).find(
    (l) => l.kind === "listItem" && l.from > found.nextPos && l.to < listEnd && l.text.trim() === text.trim(),
  );
  if (!line) return false;
  deleteLine(tr, line);
  return true;
}

function sameWriter(a: AgentWriter, b: AgentWriter): boolean {
  return a.agent === b.agent && a.at === b.at;
}

/** Accept a writer's pending lines: the marks go, the words (the user's edits to them too) stay. */
export function acceptAgentWrites(tr: Transform, by: AgentWriter): void {
  const type = tr.doc.type.schema.marks[AGENT_INSERTION];
  if (!type) return;
  tr.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.type === type);
    if (mark && sameWriter({ agent: String(mark.attrs.agent), at: String(mark.attrs.at) }, by)) {
      tr.removeMark(pos, pos + node.nodeSize, mark);
    }
  });
}

/**
 * Discard a writer's pending lines. A line the writer began is its line, and
 * goes whole, the user's edits in it with it; in a line it only added to,
 * just the added text goes.
 */
export function discardAgentWrites(tr: Transform, by: AgentWriter): void {
  const lines = docLines(tr.doc).filter((l) => l.agentRuns.some((r) => sameWriter(r.by, by)));
  // From the end, so each line's positions still hold when it is reached.
  for (const line of lines.reverse()) {
    const runs = line.agentRuns.filter((r) => sameWriter(r.by, by));
    if (runs[0]?.start === 0) {
      deleteLine(tr, line);
      continue;
    }
    for (const run of runs.reverse()) tr.delete(line.posAt(run.start), line.posAt(run.end));
  }
}

/**
 * A markdown file's fragment, or null when the doc has no such file. Never
 * creates one: opening a file is not writing it.
 */
export function fileFragment(doc: Y.Doc, path: string): Y.XmlFragment | null {
  return doc.share.has(path) ? doc.getXmlFragment(path) : null;
}

/**
 * Run an edit on one markdown file of the doc, in one Yjs transaction. The
 * fragment is read as a document, the edit runs on it, and only what changed
 * is written back (y-prosemirror's minimal update, as the agents' writes in
 * @aep/collab-doc are), so an editor bound to the file keeps its caret and a
 * collaborator's concurrent typing survives. False when the file is not in the
 * doc or the edit changed nothing. The transaction carries `origin`: the
 * user's, unless the edit is someone else's.
 */
export function editFile(
  doc: Y.Doc,
  path: string,
  edit: (tr: Transform) => void,
  origin: unknown = USER_ORIGIN,
): boolean {
  const fragment = fileFragment(doc, path);
  if (!fragment) return false;
  const tr = new Transform(yXmlFragmentToProseMirrorRootNode(fragment, specSchema));
  edit(tr);
  if (!tr.docChanged) return false;
  doc.transact(() => {
    updateYFragment(doc, fragment, tr.doc, { mapping: new Map(), isOMark: new Map() });
  }, origin);
  return true;
}

/** The document without the agent's review marks: what its markdown reads back as. */
function withoutAgentMarks(doc: PmNode): PmNode {
  const type = doc.type.schema.marks[AGENT_INSERTION];
  return type ? new Transform(doc).removeMark(0, doc.content.size, type).doc : doc;
}

/**
 * Replace only the span where the document and `next` differ. The span is
 * found with the review marks set aside (`next` comes from markdown, which
 * carries none), so a pending line the change does not reach keeps its mark.
 */
function replaceChangedSpan(tr: Transform, next: PmNode): void {
  const current = withoutAgentMarks(tr.doc);
  const start = current.content.findDiffStart(next.content);
  if (start === null) return;
  let { a: endA, b: endB } = current.content.findDiffEnd(next.content)!;
  // Repeated content can put the ends before the start; the span still has to cover the change.
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  tr.replace(start, endA, next.slice(start, endB));
}

/**
 * Bring a markdown file of the doc to new content written by someone other
 * than the user in the editor (the agent), as the smallest edit: only the span
 * that changed is replaced, so everything else in the file stays as it is,
 * the user's text and another writer's pending lines, marks and all. The new
 * words carry no review mark: this is a write, not a proposal. False when
 * the file is not in the doc or nothing changed.
 */
export function rewriteFile(doc: Y.Doc, path: string, markdown: string, origin: unknown): boolean {
  const next = specSchema.nodeFromJSON(markdownToNode(markdown).toJSON());
  return editFile(doc, path, (tr) => replaceChangedSpan(tr, next), origin);
}

/**
 * Settle an assumed line of a file from outside its editor (the chat's walk
 * of what an interview assumed): keep drops the `*assumed*` tag, remove
 * deletes the line, as the line's own buttons do in the editor. The line is
 * found by its words; false when no assumed line has them any more (it was
 * settled on the page meanwhile).
 */
export function settleAssumedLine(doc: Y.Doc, path: string, text: string, action: "keep" | "remove"): boolean {
  return editFile(doc, path, (tr) => {
    const line = docLines(tr.doc).find(
      (l) => !l.proposed && l.text === text && parseLine(l.text, l.emphasis).assumed !== null,
    );
    if (!line) return;
    if (action === "keep") removeAssumedTag(tr, line);
    else deleteLine(tr, line);
  });
}

/**
 * Settle a proposal in the doc. Accept keeps its lines, as the user left
 * them, and takes the ideas it shapes out of the Fog; discard drops its lines
 * and leaves the Fog as it was.
 */
export function settleProposalInDoc(
  doc: Y.Doc,
  proposal: Pick<Proposal, "by" | "files" | "leavesFog">,
  verdict: ProposalVerdict,
): void {
  for (const path of proposal.files) {
    editFile(doc, path, (tr) =>
      verdict === "accept" ? acceptAgentWrites(tr, proposal.by) : discardAgentWrites(tr, proposal.by),
    );
  }
  if (verdict !== "accept") return;
  editFile(doc, PRD_PATH, (tr) => {
    for (const { text } of proposal.leavesFog) deleteSectionItem(tr, "Fog", text);
  });
}
