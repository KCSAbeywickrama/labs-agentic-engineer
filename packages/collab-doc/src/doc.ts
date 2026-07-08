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

// The spec-room document model (#86 decision 2 + phase 6) and safe edit
// application for programmatic peers (#86 phase 4).
//
// Model: one Y.Doc per project. Markdown files are top-level Y.XmlFragments
// keyed by path (Tiptap needs rich structure); everything else is a Y.Text
// in Y.Map('files'). Paths are the repo path with the `specs/` prefix
// stripped (requirements/prd.md) — #113 decision 2; every peer (console,
// seeder, agents) uses the same scheme.
//
// Edit application (#86 phase-4 design note): whole-file replacement of a
// Y.Text is forbidden — it destroys concurrent keystrokes and cursors.
// Y.Text edits are DIFF-AND-PATCH against the text at APPLY time, in one
// transaction tagged with the caller's origin. Markdown fragments get a
// whole-fragment reparse in one transaction (v1 — step-level diffing is the
// noted follow-up), which converges every peer to the new content.

import diff from "fast-diff";
import * as Y from "yjs";
import { updateYFragment } from "y-prosemirror";
import { AGENT_INSERTION } from "./agent-mark.js";
import {
  fragmentToMarkdown,
  isMarkdownPath,
  markdownToFragment,
  markdownToNode,
} from "./markdown.js";

/** The Y.Map holding non-markdown files (path → Y.Text). */
export const FILES_MAP = "files";

export function filesMap(doc: Y.Doc): Y.Map<Y.Text> {
  return doc.getMap<Y.Text>(FILES_MAP);
}

/**
 * Every file path present in the doc: the files-map keys plus every
 * top-level markdown fragment. (In this model the only top-level shares are
 * FILES_MAP and md fragments, so key shape decides the type.)
 */
export function listDocPaths(doc: Y.Doc): string[] {
  const paths = new Set<string>();
  for (const key of doc.share.keys()) {
    if (key !== FILES_MAP && isMarkdownPath(key)) paths.add(key);
  }
  for (const key of filesMap(doc).keys()) paths.add(key);
  return [...paths].sort();
}

/** One file's current content, or undefined when absent. */
export function readDocFile(doc: Y.Doc, path: string): string | undefined {
  if (isMarkdownPath(path)) {
    if (!doc.share.has(path)) return undefined;
    return fragmentToMarkdown(doc.getXmlFragment(path));
  }
  return filesMap(doc).get(path)?.toString();
}

/** The whole doc as path → content (a programmatic peer's read surface). */
export function snapshotDoc(doc: Y.Doc): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of listDocPaths(doc)) {
    const content = readDocFile(doc, path);
    if (content !== undefined) out[path] = content;
  }
  return out;
}

/**
 * Diff-and-patch a Y.Text to `next` in ONE transaction: diffed against the
 * text at apply time (indices are valid now, not at generation time), so
 * concurrent edits merge at the CRDT level instead of being overwritten.
 */
export function applyTextEdit(
  ytext: Y.Text,
  next: string,
  origin?: unknown,
): void {
  const doc = ytext.doc;
  if (!doc) throw new Error("collab-doc: Y.Text is not attached to a doc");
  doc.transact(() => {
    let pos = 0;
    for (const [op, chunk] of diff(ytext.toString(), next)) {
      if (op === diff.EQUAL) pos += chunk.length;
      else if (op === diff.DELETE) ytext.delete(pos, chunk.length);
      else {
        ytext.insert(pos, chunk);
        pos += chunk.length;
      }
    }
  }, origin);
}

/**
 * Write one file into the doc: markdown → whole-fragment reparse (v1),
 * everything else → Y.Text diff-and-patch (created on first write). One
 * transaction either way, tagged with `origin`.
 */
export function setDocFile(
  doc: Y.Doc,
  path: string,
  content: string,
  origin?: unknown,
): void {
  if (isMarkdownPath(path)) {
    // getXmlFragment INSIDE the transaction: creating a top-level share
    // integrates a new type, which is itself a transaction — outside it
    // would carry no origin.
    doc.transact(() => {
      const fragment = doc.getXmlFragment(path);
      fragment.delete(0, fragment.length);
      markdownToFragment(content, fragment);
    }, origin);
    return;
  }
  const existing = doc.share.has(FILES_MAP)
    ? filesMap(doc).get(path)
    : undefined;
  if (existing) {
    applyTextEdit(existing, content, origin);
    return;
  }
  doc.transact(() => {
    const text = new Y.Text();
    text.insert(0, content);
    filesMap(doc).set(path, text);
  }, origin);
}

/** Attribution metadata for reviewable agent edits (#86 phase 6). */
export interface AgentEditMeta {
  agent: string;
  at: string;
}

/** JSON-encoded Y.RelativePosition (awareness `cursor` payload). */
export type CaretJSON = ReturnType<typeof Y.relativePositionToJSON>;

interface InsertedRun {
  text: Y.XmlText;
  index: number;
  length: number;
}

/**
 * Character-exact agent write (#86 phase 6): apply the new markdown as a
 * MINIMAL diff onto the fragment (updateYFragment — concurrent user edits in
 * untouched content survive, history is preserved), mark exactly the
 * inserted ranges with `agentInsertion`, and return a caret at the end of
 * the last insertion for the agent's awareness cursor. Non-md files get the
 * plain diff-and-patch (no marks — textarea surfaces render none) with the
 * caret at the last insert.
 */
export function setDocFileAsAgent(
  doc: Y.Doc,
  path: string,
  content: string,
  origin: unknown,
  meta: AgentEditMeta,
): { caret: CaretJSON | null } {
  if (!isMarkdownPath(path)) {
    let caret: CaretJSON | null = null;
    const existing = doc.share.has(FILES_MAP)
      ? filesMap(doc).get(path)
      : undefined;
    if (existing) {
      doc.transact(() => {
        let pos = 0;
        let lastEnd: number | null = null;
        for (const [op, chunk] of diff(existing.toString(), content)) {
          if (op === diff.EQUAL) pos += chunk.length;
          else if (op === diff.DELETE) existing.delete(pos, chunk.length);
          else {
            existing.insert(pos, chunk);
            pos += chunk.length;
            lastEnd = pos;
          }
        }
        if (lastEnd !== null) {
          caret = Y.relativePositionToJSON(
            Y.createRelativePositionFromTypeIndex(existing, lastEnd),
          );
        }
      }, origin);
      return { caret };
    }
    setDocFile(doc, path, content, origin);
    return { caret: null };
  }

  const node = markdownToNode(content);
  const inserted: InsertedRun[] = [];

  const collect = (events: Y.YEvent<Y.AbstractType<Y.YEvent<never>>>[]) => {
    for (const event of events) {
      const target = event.target;
      if (target instanceof Y.XmlText) {
        let pos = 0;
        for (const d of event.delta) {
          if (d.retain !== undefined) pos += d.retain as number;
          else if (typeof d.insert === "string") {
            inserted.push({ text: target, index: pos, length: d.insert.length });
            pos += d.insert.length;
          }
        }
      } else if (target instanceof Y.XmlFragment || target instanceof Y.XmlElement) {
        // Newly inserted elements (whole blocks): mark all their text.
        for (const d of event.delta) {
          const items = d.insert;
          if (!Array.isArray(items)) continue;
          for (const item of items) {
            if (item instanceof Y.XmlElement || item instanceof Y.XmlText) {
              collectAllText(item, inserted);
            }
          }
        }
      }
    }
  };

  const fragment = doc.getXmlFragment(path);
  fragment.observeDeep(collect);
  try {
    doc.transact(() => {
      updateYFragment(doc, fragment, node, {
        mapping: new Map(),
        isOMark: new Map(),
      });
    }, origin);
  } finally {
    fragment.unobserveDeep(collect);
  }

  let caret: CaretJSON | null = null;
  if (inserted.length > 0) {
    doc.transact(() => {
      for (const run of inserted) {
        if (run.length === 0) continue;
        run.text.format(run.index, run.length, {
          [AGENT_INSERTION]: { agent: meta.agent, at: meta.at },
        });
      }
    }, origin);
    const last = inserted[inserted.length - 1]!;
    caret = Y.relativePositionToJSON(
      Y.createRelativePositionFromTypeIndex(last.text, last.index + last.length),
    );
  }
  return { caret };
}

function collectAllText(
  node: Y.XmlElement | Y.XmlText,
  out: InsertedRun[],
): void {
  if (node instanceof Y.XmlText) {
    if (node.length > 0) out.push({ text: node, index: 0, length: node.length });
    return;
  }
  for (let i = 0; i < node.length; i++) {
    const child = node.get(i);
    if (child instanceof Y.XmlElement || child instanceof Y.XmlText) {
      collectAllText(child, out);
    }
  }
}

/** True when any md fragment in the doc still carries agentInsertion marks. */
export function hasPendingAgentMarks(doc: Y.Doc, path: string): boolean {
  if (!isMarkdownPath(path) || !doc.share.has(path)) return false;
  return fragmentHasMark(doc.getXmlFragment(path));
}

function fragmentHasMark(node: Y.XmlFragment | Y.XmlElement | Y.XmlText): boolean {
  if (node instanceof Y.XmlText) {
    return node
      .toDelta()
      .some(
        (d: { attributes?: Record<string, unknown> }) =>
          d.attributes && d.attributes[AGENT_INSERTION] !== undefined,
      );
  }
  for (let i = 0; i < node.length; i++) {
    const child = node.get(i);
    if (
      (child instanceof Y.XmlElement || child instanceof Y.XmlText) &&
      fragmentHasMark(child)
    ) {
      return true;
    }
  }
  return false;
}

/** Remove a file from the doc (fragment emptied — top-level shares cannot be deleted — or map entry removed). */
export function deleteDocFile(doc: Y.Doc, path: string, origin?: unknown): void {
  if (isMarkdownPath(path)) {
    if (!doc.share.has(path)) return;
    const fragment = doc.getXmlFragment(path);
    doc.transact(() => fragment.delete(0, fragment.length), origin);
    return;
  }
  doc.transact(() => filesMap(doc).delete(path), origin);
}
