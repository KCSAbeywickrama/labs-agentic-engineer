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

// Review actions over agentInsertion marks (#86 phase 6): accept = remove
// the mark (text stays), reject = delete the marked range. Pure ProseMirror
// document walks; the editor commands live in SpecMdEditor.

import type { Node as PMNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import { AGENT_INSERTION } from "@aep/collab-doc";

export interface AgentRange {
  from: number;
  to: number;
  agent: string;
}

/** Contiguous agent-marked ranges in document order. */
export function agentRanges(doc: PMNode): AgentRange[] {
  const ranges: AgentRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const mark = node.marks.find((m) => m.type.name === AGENT_INSERTION);
    if (!mark) return true;
    const from = pos;
    const to = pos + node.nodeSize;
    const last = ranges[ranges.length - 1];
    if (last && last.to === from && last.agent === mark.attrs.agent) {
      last.to = to; // merge adjacent text nodes of one insertion
    } else {
      ranges.push({ from, to, agent: String(mark.attrs.agent ?? "") });
    }
    return true;
  });
  return ranges;
}

/** The contiguous marked range containing pos (a caret inside a highlight). */
export function rangeAt(doc: PMNode, pos: number): AgentRange | null {
  return (
    agentRanges(doc).find((r) => pos >= r.from && pos <= r.to) ?? null
  );
}

export function acceptRange(editor: Editor, range: AgentRange): void {
  const markType = editor.state.schema.marks[AGENT_INSERTION];
  if (!markType) return;
  const tr = editor.state.tr.removeMark(range.from, range.to, markType);
  editor.view.dispatch(tr);
}

export function rejectRange(editor: Editor, range: AgentRange): void {
  editor.view.dispatch(editor.state.tr.delete(range.from, range.to));
}

export function acceptAll(editor: Editor): void {
  const markType = editor.state.schema.marks[AGENT_INSERTION];
  if (!markType) return;
  const tr = editor.state.tr.removeMark(0, editor.state.doc.content.size, markType);
  editor.view.dispatch(tr);
}

export function rejectAll(editor: Editor): void {
  const ranges = agentRanges(editor.state.doc);
  const tr = editor.state.tr;
  for (const r of [...ranges].reverse()) tr.delete(r.from, r.to);
  editor.view.dispatch(tr);
}
