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

import { Node as PmNode } from "@tiptap/pm/model";
import type * as Y from "yjs";
import { yXmlFragmentToProsemirrorJSON } from "y-prosemirror";
import { specSchema } from "./specSchema";

// Reading a markdown file of the room as a ProseMirror document, WITHOUT
// writing to the room. y-prosemirror's own conversion
// (`yXmlFragmentToProseMirrorRootNode`) is not a read: a node the schema
// rejects is taken for the casualty of a concurrent edit and DELETED from the
// shared doc. Run on every doc update, that turned one agent edit the schema
// could not hold (a mark inside a code block) into a whole mermaid diagram
// deleted from a project's repo (lunch-order-l29, 2026-10-11). Here the
// fragment is read as JSON and built block by block; a block the schema
// rejects is read without its marks, or else left out, and the doc is never
// touched.

interface BlockJSON {
  type: string;
  marks?: unknown[];
  content?: BlockJSON[];
  [key: string]: unknown;
}

/** A file as a document, and whether it says all the fragment holds. */
export interface FragmentRead {
  doc: PmNode;
  /**
   * False when a block the schema rejects was read without its marks or left
   * out: the document is then fit to read, never to write back.
   */
  lossless: boolean;
}

/** A block built and checked against the schema; throws when it does not fit. */
function checkedBlock(json: BlockJSON): PmNode {
  const node = PmNode.fromJSON(specSchema, json);
  if (!node.isBlock) throw new RangeError(`${node.type.name} is not a block`);
  node.check();
  return node;
}

function withoutMarks(json: BlockJSON): BlockJSON {
  const stripped: BlockJSON = { ...json };
  delete stripped.marks;
  if (json.content) stripped.content = json.content.map(withoutMarks);
  return stripped;
}

/**
 * Read one markdown file's fragment as a document of the spec schema. Never
 * writes to the fragment's doc, whatever the fragment holds.
 */
export function readFragment(fragment: Y.XmlFragment): FragmentRead {
  const blocks: PmNode[] = [];
  let lossless = true;
  for (const json of yXmlFragmentToProsemirrorJSON(fragment).content as BlockJSON[]) {
    try {
      blocks.push(checkedBlock(json));
      continue;
    } catch (err) {
      lossless = false;
      console.warn(`[spec] a ${json.type} block does not fit the spec schema; reading it without marks:`, err);
    }
    try {
      blocks.push(checkedBlock(withoutMarks(json)));
    } catch (err) {
      console.warn(`[spec] a ${json.type} block does not fit the spec schema; left out of the read:`, err);
    }
  }
  const doc = specSchema.topNodeType.createAndFill(null, blocks) ?? specSchema.topNodeType.createAndFill();
  if (!doc) throw new Error("spec schema: cannot build an empty document");
  return { doc, lossless };
}
