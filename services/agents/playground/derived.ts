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
 * The post-turn derived-artifact pipeline, as ONE unit: given what a turn
 * changed and the resulting snapshot, refresh every derived view on disk.
 * This is the playground's stand-in for what the BFF owns in production —
 * a single seam, so the turn loop stays chat mechanics only.
 *
 *   *.dsl                 → sibling .excalidraw          (compile)
 *   design.md frontmatter → specs/design/design.gen.json (project view)
 *                         → specs/design/cell-diagram.gen.json
 *                         → components/<id>/design.gen.json (slices)
 *
 * Everything written here ends in .excalidraw / .gen.json — the extensions
 * readSnapshot excludes — so derived output can never leak into the agent's
 * bundle or the prompt.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FileChange } from "./threads.js";
import { compileDslArtifacts } from "./dsl.js";
import { projectDesignJson, componentSlices, toCellDiagramProject } from "@aep/design-projection";

export interface DerivedNote {
  ok: boolean;
  message: string;
}

/** Refresh all derived artifacts for one finished turn; returns display notes. */
export function materializeDerived(
  threadDir: string,
  threadName: string,
  changes: readonly FileChange[],
  snapshot: Record<string, string>,
): DerivedNote[] {
  const notes: DerivedNote[] = [];

  for (const r of compileDslArtifacts(
    threadDir,
    changes.filter((c) => c.kind !== "remove").map((c) => c.path),
  )) {
    notes.push(
      r.ok
        ? { ok: true, message: `${r.outPath} (compiled)` }
        : { ok: false, message: `${r.path}: DSL error — ${r.error}` },
    );
  }

  if (changes.some((c) => c.path.startsWith("specs/design/"))) {
    const dj = projectDesignJson(threadName, snapshot);
    const views: Record<string, unknown> = {
      "specs/design/design.gen.json": dj,
      "specs/design/cell-diagram.gen.json": toCellDiagramProject(dj),
      ...componentSlices(dj),
    };
    for (const [rel, view] of Object.entries(views)) {
      writeFileSync(join(threadDir, rel), JSON.stringify(view, null, 2) + "\n");
      notes.push({ ok: true, message: `${rel} (projected)` });
    }
  }

  return notes;
}
