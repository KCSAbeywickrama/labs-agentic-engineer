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
 * FE-side derived-artifact pipeline. The migration moved the `.dsl → .excalidraw`
 * and `design.json → cell-diagram.gen.json` transforms out of the agents service
 * and onto the client (§6/§9): the agent authors only the sources, the FE derives
 * the views post-fold. This mirrors the playground's `derived.ts` — the exact role
 * the BFF plays in production — but as a pure, browser-safe transform over a
 * snapshot (no filesystem).
 *
 *   specs/**\/*.dsl                        → sibling .excalidraw     (compile)
 *   specs/design/components/**\/design.json → specs/design/cell-diagram.gen.json
 *
 * Everything produced here ends in `.excalidraw` / `.gen.json` — the extensions
 * the turn snapshot filter excludes — so derived output can never re-enter a turn.
 * Derived files DO go into the `files/apply` writes so they commit alongside their
 * sources.
 */

import { tryDslToExcalidraw, type DslKind } from '@aep/excalidraw-dsl';
import { buildProjectDesign, toCellDiagramProject } from '@aep/design-projection';
import { COMPONENT_DESIGN_JSON_RE } from '@aep/agent-stream';

export const CELL_DIAGRAM_GEN_PATH = 'specs/design/cell-diagram.gen.json';

export interface DerivedNote {
  path: string;
  ok: boolean;
  message?: string;
}

export interface DerivedArtifacts {
  /** Derived path → content, ready to merge into the draft and the apply writes. */
  files: Record<string, string>;
  notes: DerivedNote[];
}

/** Infer the DSL dialect from the filename (`erd`/`domain` → domain-model). */
function kindFor(path: string): DslKind {
  const base = (path.split('/').pop() ?? '').toLowerCase();
  return base.startsWith('erd') || base.startsWith('domain') ? 'domain-model' : 'wireframes';
}

/**
 * Compute every derived artifact for a folded snapshot. Pure: `snapshot` is the
 * agent-authored files (full `specs/…` keys); the returned `files` are the
 * derived views to overlay. A DSL that fails to parse and a malformed design.json
 * are reported in `notes` and simply omitted — a bad source never wedges a save.
 */
export function computeDerivedArtifacts(
  projectName: string,
  snapshot: Record<string, string>,
): DerivedArtifacts {
  const files: Record<string, string> = {};
  const notes: DerivedNote[] = [];

  // 1. Compile each *.dsl into its sibling *.excalidraw.
  for (const [path, content] of Object.entries(snapshot)) {
    if (!path.endsWith('.dsl')) continue;
    const outPath = path.replace(/\.dsl$/, '.excalidraw');
    const res = tryDslToExcalidraw(kindFor(path), content);
    if (res.ok) {
      files[outPath] = res.json;
      notes.push({ path: outPath, ok: true });
    } else {
      notes.push({ path, ok: false, message: `DSL did not compile: ${path}` });
    }
  }

  // 2. Project component design.json files into the cell-diagram view.
  const hasComponents = Object.keys(snapshot).some((p) => COMPONENT_DESIGN_JSON_RE.test(p));
  if (hasComponents) {
    try {
      const project = toCellDiagramProject(buildProjectDesign(projectName, snapshot));
      files[CELL_DIAGRAM_GEN_PATH] = JSON.stringify(project, null, 2) + '\n';
      notes.push({ path: CELL_DIAGRAM_GEN_PATH, ok: true });
    } catch (e) {
      notes.push({
        path: CELL_DIAGRAM_GEN_PATH,
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { files, notes };
}

/** The set of derived paths a snapshot WOULD produce — used to prune stale ones. */
export function derivedPathsFor(snapshot: Record<string, string>): Set<string> {
  const out = new Set<string>();
  for (const path of Object.keys(snapshot)) {
    if (path.endsWith('.dsl')) out.add(path.replace(/\.dsl$/, '.excalidraw'));
  }
  if (Object.keys(snapshot).some((p) => COMPONENT_DESIGN_JSON_RE.test(p))) {
    out.add(CELL_DIAGRAM_GEN_PATH);
  }
  return out;
}
