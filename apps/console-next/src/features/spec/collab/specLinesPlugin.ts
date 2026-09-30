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

// How a spec document reads, as ProseMirror decorations over the markdown it
// is: the markdown itself is never rewritten. A story's ID is drawn as a quiet
// mono ID at the start of its line, a line tagged `*assumed*` is highlighted
// and offers Keep, Remove and I'll edit (assumedLines.ts acts on them), a line
// of the agent's pending proposal is drawn as proposed, a source is a small
// tag, and every other ID is a quiet link (the editor's hover and click read
// `data-spec-id`). On the product page the Features list gives way to the
// feature rows, and the Fog's entries are drawn as the Fog, an idea the
// proposal takes out of it struck through. A line a design comment changed
// is marked as such, with the comment's number, until the comment is resolved.
//
// Decorations are rebuilt from the document on every change rather than
// mapped forward: the user types into these lines, and a spec file is a few
// dozen blocks.

import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { parseLine, type LineParts, type Span } from "../model/ids";
import { docLines, type DocLine } from "./docLines";

/** What an assumed line's buttons do; the button carries it as `data-assumed`. */
export type AssumedAction = "keep" | "remove" | "edit";

const ASSUMED_ACTIONS: { action: AssumedAction; label: string }[] = [
  { action: "keep", label: "Keep" },
  { action: "remove", label: "Remove" },
  { action: "edit", label: "I'll edit" },
];

/** The class of the slot the feature rows draw into. */
export const ROWS_SLOT = "aep-rows";

function rowsSlot(): HTMLElement {
  const el = document.createElement("div");
  el.className = ROWS_SLOT;
  return el;
}

export interface SpecLinesOptions {
  /** Draw a slot for the feature rows in place of the Features list. Product page only. */
  featureRows: boolean;
  /** Leave the Fog out: a small product shows its feature list alone. */
  hideFog: boolean;
  /** Each product-wide item's reach, drawn after its line. Product-wide page only. */
  appliesTo: ReadonlyMap<string, string[] | "all"> | null;
  /** Fog entries the pending proposal takes out of the Fog, by their words, and what each becomes. Product page only. */
  leavingFog: ReadonlyMap<string, string> | null;
  /** Lines a design comment changed, by line ID, and what their mark says. Feature pages only. */
  designChanged: ReadonlyMap<string, string> | null;
}

/** A decoration to draw, as data: what `build` turns into ProseMirror's. */
export type LineMark =
  | { kind: "line"; from: number; to: number; lineId: string | null; assumed: boolean; proposed: boolean }
  | { kind: "actions" | "proposed"; at: number; body: string }
  | { kind: "sid" | "was" | "source" | "assumed"; from: number; to: number }
  | { kind: "ref"; from: number; to: number; id: string };

/**
 * What one line draws: its highlight, its ID, its tags and its links, and at
 * its end the actions on an assumed line or the proposed tag. A proposed line
 * is the agent's until accepted, so it offers no actions of its own.
 */
export function lineMarks(
  line: Pick<DocLine, "lineFrom" | "lineTo" | "posAt" | "text" | "proposed">,
  parts: LineParts,
): LineMark[] {
  const marks: LineMark[] = [];
  const at = (span: Span) => ({ from: line.posAt(span.start), to: line.posAt(span.end) });
  if (parts.lead || parts.assumed || line.proposed) {
    marks.push({
      kind: "line",
      from: line.lineFrom,
      to: line.lineTo,
      lineId: parts.lead?.id ?? null,
      assumed: parts.assumed !== null,
      proposed: line.proposed,
    });
  }
  if (parts.lead) marks.push({ kind: "sid", ...at(parts.lead) });
  if (parts.was) marks.push({ kind: "was", ...at(parts.was) });
  for (const source of parts.sources) marks.push({ kind: "source", ...at(source) });
  if (parts.assumed) marks.push({ kind: "assumed", ...at(parts.assumed) });
  for (const ref of parts.refs) marks.push({ kind: "ref", id: ref.id, ...at(ref) });
  const end = line.posAt(line.text.length);
  if (line.proposed) marks.push({ kind: "proposed", at: end, body: parts.body });
  else if (parts.assumed) marks.push({ kind: "actions", at: end, body: parts.body });
  return marks;
}

function actionsDom(body: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "aep-asm";
  el.contentEditable = "false";
  for (const { action, label } of ASSUMED_ACTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.assumed = action;
    button.textContent = label;
    button.setAttribute("aria-label", `${label}: ${body}`);
    el.append(button);
  }
  return el;
}

function tagDom(className: string, text: string): HTMLElement {
  const el = document.createElement("span");
  el.className = className;
  el.contentEditable = "false";
  el.textContent = text;
  return el;
}

function lineClass(mark: { assumed: boolean; proposed: boolean }): string {
  if (mark.proposed) return "aep-line aep-line--proposed";
  return mark.assumed ? "aep-line aep-line--assumed" : "aep-line";
}

function toDecoration(mark: LineMark): Decoration {
  switch (mark.kind) {
    case "line":
      return Decoration.node(mark.from, mark.to, {
        class: lineClass(mark),
        ...(mark.lineId ? { "data-line-id": mark.lineId } : {}),
      });
    // The buttons are ProseMirror's to ignore (stopEvent): the editor's click
    // handler reads `data-assumed` and acts on the line.
    case "actions":
      return Decoration.widget(mark.at, () => actionsDom(mark.body), {
        key: `asm:${mark.body}`,
        side: 1,
        ignoreSelection: true,
        stopEvent: () => true,
      });
    case "proposed":
      return Decoration.widget(mark.at, () => tagDom("aep-ptag", "proposed"), {
        key: "ptag",
        side: 1,
        ignoreSelection: true,
      });
    // IDs and sources are not words: no spelling squiggles under them.
    case "ref":
      return Decoration.inline(mark.from, mark.to, { class: "aep-ref", "data-spec-id": mark.id, spellcheck: "false" });
    default:
      return Decoration.inline(mark.from, mark.to, { class: `aep-${mark.kind}`, spellcheck: "false" });
  }
}

function appliesToDom(reach: string[] | "all"): HTMLElement {
  const el = document.createElement("span");
  el.className = "aep-aps";
  el.contentEditable = "false";
  if (reach === "all") {
    el.textContent = "applies to every feature";
    return el;
  }
  el.append("applies to ");
  reach.forEach((id, i) => {
    if (i > 0) el.append(", ");
    const ref = document.createElement("span");
    ref.className = "aep-ref";
    ref.dataset.specId = id;
    ref.textContent = id;
    el.append(ref);
  });
  return el;
}

/** The product page's sections that draw differently: Features and Fog. */
function sectionDecorations(doc: PmNode, opts: SpecLinesOptions): Decoration[] {
  const out: Decoration[] = [];
  let section: string | null = null;
  doc.forEach((node, offset) => {
    const end = offset + node.nodeSize;
    if (node.type.name === "heading" && Number(node.attrs.level) <= 2) {
      section = node.textContent.trim().toLowerCase();
      if (section === "features" && opts.featureRows) {
        // An empty slot, fresh per widget view; the editor finds the one in
        // the live DOM and renders the rows into it (SpecEditor.tsx). Handing
        // ProseMirror one shared element instead lets two widget views hold
        // the same node while it redraws, and its child sync never settles.
        out.push(
          Decoration.widget(end, () => rowsSlot(), {
            key: "feature-rows",
            side: -1,
            ignoreSelection: true,
            stopEvent: () => true,
          }),
        );
      }
      if (section === "fog") {
        out.push(Decoration.node(offset, end, opts.hideFog ? { class: "aep-hidden" } : { "data-anchor": "fog" }));
      }
      return;
    }
    if (section === "features" && opts.featureRows && node.type.name === "bulletList") {
      out.push(Decoration.node(offset, end, { class: "aep-hidden" }));
    }
    if (section === "fog") {
      out.push(Decoration.node(offset, end, { class: opts.hideFog ? "aep-hidden" : "aep-fog" }));
      if (!opts.hideFog && opts.leavingFog && node.type.name === "bulletList") {
        out.push(...leavingFogDecorations(node, offset + 1, opts.leavingFog));
      }
    }
  });
  return out;
}

/** A Fog entry the pending proposal takes out of the Fog: struck through, with what it becomes. */
function leavingFogDecorations(list: PmNode, contentStart: number, leaving: ReadonlyMap<string, string>): Decoration[] {
  const out: Decoration[] = [];
  list.forEach((item, offset) => {
    const becomes = leaving.get(item.textContent.trim());
    const paragraph = item.firstChild;
    if (becomes === undefined || !paragraph) return;
    const pos = contentStart + offset;
    out.push(Decoration.node(pos, pos + item.nodeSize, { class: "aep-fog-gone" }));
    out.push(
      Decoration.widget(pos + 1 + paragraph.nodeSize - 1, () => tagDom("aep-ptag", `becomes ${becomes}`), {
        key: `fog-gone:${becomes}`,
        side: 1,
        ignoreSelection: true,
      }),
    );
  });
  return out;
}

function build(doc: PmNode, opts: SpecLinesOptions): DecorationSet {
  const decorations = sectionDecorations(doc, opts);
  for (const line of docLines(doc)) {
    const parts = parseLine(line.text, line.emphasis);
    for (const mark of lineMarks(line, parts)) decorations.push(toDecoration(mark));
    const changed = parts.lead ? opts.designChanged?.get(parts.lead.id) : undefined;
    if (changed) {
      decorations.push(Decoration.node(line.lineFrom, line.lineTo, { class: "aep-line--design" }));
      decorations.push(
        Decoration.widget(line.to - 1, () => tagDom("aep-dtag", changed), {
          key: `design:${changed}`,
          side: 1,
          ignoreSelection: true,
        }),
      );
    }
    const reach = parts.lead ? opts.appliesTo?.get(parts.lead.id) : undefined;
    if (parts.lead && reach) {
      decorations.push(
        Decoration.widget(line.to - 1, () => appliesToDom(reach), {
          key: `aps:${parts.lead.id}:${reach === "all" ? "all" : reach.join(",")}`,
          side: 1,
          ignoreSelection: true,
        }),
      );
    }
  }
  return DecorationSet.create(doc, decorations);
}

const specLinesKey = new PluginKey<DecorationSet>("specLines");

export const SpecLines = Extension.create<SpecLinesOptions>({
  name: "specLines",
  addOptions() {
    return { featureRows: false, hideFog: false, appliesTo: null, leavingFog: null, designChanged: null };
  },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      new Plugin<DecorationSet>({
        key: specLinesKey,
        state: {
          init: (_, state) => build(state.doc, opts),
          apply: (tr, old) => (tr.docChanged ? build(tr.doc, opts) : old),
        },
        props: {
          decorations: (state) => specLinesKey.getState(state),
        },
      }),
    ];
  },
});
