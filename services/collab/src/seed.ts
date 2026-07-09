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

import * as Y from "yjs";
import { filesMap, isMarkdownPath, markdownToFragment } from "@aep/collab-doc";
import type { SpecFile } from "./bff.js";

// Doc model (#86 decision 2 + phase 6): one Y.Doc per project — the model
// itself (Y.Map('files') + md fragments) lives in @aep/collab-doc, shared
// with the agents service's live-peer path (#86 phase 4).
//
// KEY SCHEME INVARIANT: doc keys are the FULL repo-relative path, verbatim
// (specs/requirements/prd.md). The console's spec feature, the committer, and
// agent peers (#86 phase 4) all use this one scheme — no strip/re-add. (Retires
// #113 decision 2's stripped keys, which double-prefixed agent-created files.)
export { FILES_MAP, filesMap } from "@aep/collab-doc";

/**
 * Populate an (empty or partial) doc from a spec bundle. Existing entries are
 * never overwritten — a rejoin after eviction reseeds only what's missing, and
 * live peer content always wins over a late seed.
 */
export function seedDocument(doc: Y.Doc, files: SpecFile[]): void {
  const map = filesMap(doc);
  doc.transact(() => {
    for (const file of files) {
      if (isMarkdownPath(file.path)) {
        const fragment = doc.getXmlFragment(file.path);
        if (fragment.length === 0) {
          markdownToFragment(file.content, fragment);
        }
      } else if (!map.has(file.path)) {
        const text = new Y.Text();
        text.insert(0, file.content);
        map.set(file.path, text);
      }
    }
  });
}
