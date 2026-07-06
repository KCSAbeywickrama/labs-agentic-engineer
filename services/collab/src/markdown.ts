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

// Headless markdown ↔ ProseMirror plumbing (#86 phase 6). Markdown files are
// shared as Y.XmlFragments (Tiptap's collaboration binding needs rich
// structure, not Y.Text); this module owns the conversion at the seams:
// parse on seed here, serialize on flush when the committer lands (phase 3).
// The extension set MUST match the console editor's, or content drifts.

import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { MarkdownManager } from "@tiptap/markdown";
import {
  prosemirrorJSONToYXmlFragment,
  yXmlFragmentToProsemirrorJSON,
} from "y-prosemirror";
import type * as Y from "yjs";

const extensions = [StarterKit];

const manager = new MarkdownManager({ extensions });
const schema = getSchema(extensions);

export function isMarkdownPath(path: string): boolean {
  return path.endsWith(".md");
}

/** Parse markdown into an (empty) Y.XmlFragment. */
export function markdownToFragment(
  markdown: string,
  fragment: Y.XmlFragment,
): void {
  prosemirrorJSONToYXmlFragment(schema, manager.parse(markdown), fragment);
}

/** Serialize a fragment back to markdown (committer seam, phase 3). */
export function fragmentToMarkdown(fragment: Y.XmlFragment): string {
  return manager.serialize(yXmlFragmentToProsemirrorJSON(fragment));
}
