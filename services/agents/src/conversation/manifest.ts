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

/**
 * The terminal manifest part (shared-volume-clone-architecture D14): the
 * producer half of the fold-parity gate. Emitted ONCE per successful turn (any
 * request shape), before `[DONE]`; a turn that throws emits none, so a severed
 * stream is unambiguously "do not commit" to the aep-api fold.
 */

import type { FileBundle, ManifestPart } from "@aep/agent-stream";
import { sha256Hex } from "../shared/hash.js";

/**
 * Build the manifest from the turn's bundle. Covers ONLY paths mutated THIS
 * turn (`bundle.touched()` — set on APPLIED ops only, so noop/already-applied/
 * rejected ops never appear): still-present paths map to the sha256 of their
 * final (LF-canonical) content, vanished paths land in `deleted`. Paths are
 * sorted for a deterministic wire encoding (cassette/golden friendly). No
 * bundle (chat-only or task-plan turn) → the empty manifest.
 */
export function buildManifestPart(bundle?: FileBundle): ManifestPart {
  const files: Record<string, string> = {};
  const deleted: string[] = [];
  if (bundle) {
    for (const path of [...bundle.touched()].sort()) {
      const content = bundle.read(path);
      if (content === undefined) deleted.push(path);
      else files[path] = sha256Hex(content);
    }
  }
  return { type: "manifest", files, deleted };
}
