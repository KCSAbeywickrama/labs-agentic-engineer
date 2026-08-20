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

// Links between spec documents open IN the spec view.
//
// The PRD names its feature docs, and the shared schema's Link mark parses a
// markdown link as an EXTERNAL one — `target="_blank"`, `rel="noopener…"` —
// which is wrong twice over: inside a contenteditable a plain click places a
// caret rather than following anything, and the href names a repo path the
// console does not serve, so a click that did follow it would leave the app
// for a 404. Meanwhile the file itself is two rows away in the same rail.
//
// Which links are ours is `lib/specLinks.ts`; this file is the click and the
// styling that tells the two kinds of link apart before it.

import { Extension } from "@tiptap/core";
import type { Mark, Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { resolveSpecHref } from "../lib/specLinks";

/** What the console hands the editor so a reference can be followed. */
export interface SpecLinkBinding {
  /** The document being edited — a relative href resolves against it. */
  path: string;
  /** Every spec file the project has; a link outside this set is left alone. */
  knownPaths: readonly string[];
  /** Select the referenced file in the spec view. */
  open: (path: string) => void;
}

export const specLinkKey = new PluginKey<DecorationSet>("specLinks");

const hrefOf = (mark: Mark): string =>
  typeof mark.attrs.href === "string" ? mark.attrs.href : "";

const linkMark = (marks: readonly Mark[]): Mark | undefined =>
  marks.find((m) => m.type.name === "link");

/** Mark every link that resolves to a sibling document, so it reads as one. */
function build(doc: PmNode, binding: SpecLinkBinding): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const mark = linkMark(node.marks);
    if (!mark) return true;
    if (resolveSpecHref(hrefOf(mark), binding.path, binding.knownPaths)) {
      decorations.push(
        Decoration.inline(pos, pos + node.nodeSize, { class: "spec-link" }),
      );
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * Rebuild after the project's file list changes — a link to a feature doc the
 * agent has just written becomes followable the moment the file exists.
 */
export function refreshSpecLinks(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(specLinkKey, true));
}

/**
 * Spec-to-spec references, as a Tiptap extension. Carried by every markdown
 * spec editor rather than the PRD's alone — a feature doc pointing back at the
 * PRD is the same journey in reverse.
 */
export const SpecLinks = Extension.create<{ binding: () => SpecLinkBinding | undefined }>({
  name: "specLinks",

  addOptions() {
    return { binding: () => undefined };
  },

  addProseMirrorPlugins() {
    const read = () => this.options.binding();
    return [
      new Plugin<DecorationSet>({
        key: specLinkKey,
        state: {
          init: (_config, state) => {
            const binding = read();
            return binding ? build(state.doc, binding) : DecorationSet.empty;
          },
          apply: (tr, current, _old, next) => {
            if (!tr.docChanged && !tr.getMeta(specLinkKey)) return current;
            const binding = read();
            return binding ? build(next.doc, binding) : DecorationSet.empty;
          },
        },
        props: {
          decorations(state) {
            return specLinkKey.getState(state);
          },

          // A link inside a contenteditable is not followed by the browser on
          // a plain click anyway — ProseMirror places a caret instead — so the
          // handler is what makes a reference followable at all, and returning
          // true keeps the caret out of the way when it fires.
          handleClick(view, pos, event) {
            const binding = read();
            if (!binding) return false;
            const mark = linkMark(view.state.doc.resolve(pos).marks());
            if (!mark) return false;
            const target = resolveSpecHref(hrefOf(mark), binding.path, binding.knownPaths);
            if (!target) return false;
            event.preventDefault();
            binding.open(target);
            return true;
          },
        },
      }),
    ];
  },
});
