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
 * Tolerant, identity-stable cell-diagram projection for a STREAMING design
 * draft. The committed-draft path keeps using the strict projection
 * (`derivedArtifacts.ts`); this module exists because live snapshots contain
 * one design.json that is mid-write and therefore not valid JSON yet, and
 * because the diagram renderer re-runs its whole layout whenever the project
 * object identity changes.
 *
 * The diagram is a pure function of the component design.json files — nothing
 * else in the snapshot can affect it — so non-design.json deltas are gated out
 * before any parsing happens. Per snapshot, each component design.json is
 * resolved to the best available content: strict parse → repaired partial
 * parse (early paint while the file streams) → the last content that parsed
 * (never regress a component to a default box) → omitted (never show a
 * typeless placeholder). The projected model is then deep-compared against
 * the previous one and the SAME object is returned unless something material
 * changed — the renderer only re-lays-out when the diagram itself changed,
 * and once a diagram exists it is never replaced by null mid-stream.
 */

import { COMPONENT_DESIGN_JSON_RE } from '@aep/agent-stream';
import {
  buildProjectDesign,
  toCellDiagramProject,
  type CellDiagramProject,
} from '@aep/design-projection';

// Boot marker: proves the instrumented bundle is the one the tab is running —
// if this line is absent from the browser console, the tab needs a hard refresh.
if (typeof window !== 'undefined') {
  // eslint-disable-next-line no-console
  console.log('[live-design] instrumentation loaded');
}

/** Mutable per-generation memory. Create fresh when a design turn starts. */
export interface LiveDesignState {
  /** design.json path → last content that strict-parsed. */
  lastGood: Map<string, string>;
  /** Sorted [path, content] design.json pairs of the previous snapshot — the "did anything the diagram can see change?" gate. */
  lastInputs: [string, string][] | null;
  lastProject: CellDiagramProject | null;
  lastProjectKey: string | null;
  /** Material reloads so far (diagram re-layouts) — drives the debug print. */
  reloads: number;
  /** Epoch ms when this generation's state was created (debug-print timing). */
  startedAt: number;
}

export function createLiveDesignState(): LiveDesignState {
  return {
    lastGood: new Map(),
    lastInputs: null,
    lastProject: null,
    lastProjectKey: null,
    reloads: 0,
    startedAt: Date.now(),
  };
}

/** How one design.json was resolved for a snapshot (debug print vocabulary). */
type Resolution = 'strict' | 'repaired' | 'last-good' | 'omitted';

/**
 * Per-component debug summary of a projected diagram. The connection split is
 * the load-bearing part: `external` targets render OUTSIDE the cell — a
 * sibling component listed there means its design.json was missing/unparsed
 * in the files that produced this projection.
 */
export function describeCellDiagram(project: CellDiagramProject): Record<string, unknown>[] {
  return project.components.map((c) => ({
    id: c.id,
    type: c.type,
    exposure: c.services[Object.keys(c.services)[0] ?? '']?.deploymentMetadata.gateways,
    internal: c.connections.filter((k) => k.id.startsWith('default:project:')).map((k) => k.label),
    external: c.connections.filter((k) => !k.id.startsWith('default:project:')).map((k) => k.label),
  }));
}

/**
 * One line per MATERIAL diagram reload (a new project object → a re-layout).
 * Deliberately unconditional in the browser (works in the prod bundle too, so a
 * deployed console is debuggable) and silent under node (tests).
 */
function logReload(
  state: LiveDesignState,
  resolution: Record<string, Resolution>,
  project: CellDiagramProject,
): void {
  if (typeof window === 'undefined') return;
  // eslint-disable-next-line no-console
  console.log(`[live-design] reload #${state.reloads} +${Date.now() - state.startedAt}ms`, {
    resolution,
    components: describeCellDiagram(project),
    project,
  });
}

interface ScanState {
  inString: boolean;
  escape: boolean;
  stack: string[];
  lastComma: number;
  lastColon: number;
  lastOpen: number;
}

/** One pass of JSON structure outside/inside strings — no validation. */
function scan(s: string): ScanState {
  const st: ScanState = {
    inString: false,
    escape: false,
    stack: [],
    lastComma: -1,
    lastColon: -1,
    lastOpen: -1,
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (st.inString) {
      if (st.escape) st.escape = false;
      else if (c === '\\') st.escape = true;
      else if (c === '"') st.inString = false;
      continue;
    }
    if (c === '"') st.inString = true;
    else if (c === '{' || c === '[') {
      st.stack.push(c);
      st.lastOpen = i;
    } else if (c === '}' || c === ']') st.stack.pop();
    else if (c === ',') st.lastComma = i;
    else if (c === ':') st.lastColon = i;
  }
  return st;
}

/**
 * Complete a streaming JSON-document prefix into parseable JSON, or null when
 * nothing recoverable remains. Drops a string token the cut landed inside
 * (closing it would fabricate a truncated VALUE — e.g. `"exposure": "inter`
 * repaired to `"inter"` matches neither gateway, so the component rendered
 * OUTSIDE the cell until the full value streamed), closes the open brackets,
 * and when that doesn't parse (dangling key, mid-token cut) backtracks to the
 * previous comma/colon/opening-bracket boundary and tries again.
 */
export function repairPartialJson(input: string): string | null {
  let s = input;
  for (let attempt = 0; attempt < 100 && s.length > 0; attempt++) {
    const st = scan(s);
    if (st.escape) {
      s = s.slice(0, -1); // cut landed mid-escape — shave and rescan
      continue;
    }
    if (st.inString) {
      // Mid-string cut: back off to the last structural boundary so the
      // half-streamed key/value is omitted; it reappears once complete.
      const cut = Math.max(st.lastComma, st.lastColon, st.lastOpen + 1);
      s = cut > 0 && cut < s.length ? s.slice(0, cut) : s.slice(0, -1);
      continue;
    }
    let candidate = s;
    for (let i = st.stack.length - 1; i >= 0; i--) {
      candidate += st.stack[i] === '{' ? '}' : ']';
    }
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      /* backtrack below */
    }
    const next = Math.max(st.lastComma, st.lastColon, st.lastOpen + 1);
    if (next <= 0 || next >= s.length) s = s.slice(0, -1);
    else s = s.slice(0, next);
  }
  return null;
}

function strictParses(content: string): boolean {
  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
}

/** A repaired doc that parses to a non-empty object carries real design info. */
function hasDesignSubstance(repaired: string): boolean {
  try {
    const parsed: unknown = JSON.parse(repaired);
    return parsed !== null && typeof parsed === 'object' && Object.keys(parsed).length > 0;
  } catch {
    return false;
  }
}

/**
 * Project one live snapshot into the diagram model. The diagram reacts ONLY to
 * component design.json content: everything else in the snapshot (design.md,
 * openapi.yaml, wireframes.dsl, ...) is excluded before any work happens, so
 * deltas streaming into those files skip parsing and projection entirely. Of
 * the design.json fields, only the ones `toCellDiagramProject` consumes (type,
 * version, language, exposure, connections) can change the projected model —
 * the identity check below therefore ignores e.g. `description`-only growth.
 * Returns the previous project (same identity) when nothing material changed,
 * and never regresses from "a diagram" to null within one generation.
 */
export function projectLiveDesign(
  projectName: string,
  files: Record<string, string>,
  state: LiveDesignState,
): CellDiagramProject | null {
  try {
    const designFiles: [string, string][] = Object.entries(files)
      .filter(([path]) => COMPONENT_DESIGN_JSON_RE.test(path))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    // Fast path: no design.json changed since the last snapshot → the diagram
    // cannot have changed; skip repair/parse/projection outright. Contents are
    // compared by reference first (`===` on strings): FileBundle.snapshot()
    // preserves string identity for unchanged files, so this avoids
    // re-serializing every design.json on every preview frame.
    const prev = state.lastInputs;
    if (
      prev &&
      prev.length === designFiles.length &&
      prev.every(([path, content], i) => path === designFiles[i][0] && content === designFiles[i][1])
    ) {
      return state.lastProject;
    }
    state.lastInputs = designFiles;

    const sanitized: Record<string, string> = {};
    const resolution: Record<string, Resolution> = {};
    for (const [path, content] of designFiles) {
      if (strictParses(content)) {
        state.lastGood.set(path, content);
        sanitized[path] = content;
        resolution[path] = 'strict';
        continue;
      }
      const repaired = repairPartialJson(content);
      if (repaired !== null && hasDesignSubstance(repaired)) {
        sanitized[path] = repaired;
        resolution[path] = 'repaired';
        continue;
      }
      const good = state.lastGood.get(path);
      if (good !== undefined) {
        sanitized[path] = good;
        resolution[path] = 'last-good';
        continue;
      }
      resolution[path] = 'omitted'; // the component appears once something parseable streamed
    }

    const project = toCellDiagramProject(buildProjectDesign(projectName, sanitized));
    if (project.components.length === 0) return state.lastProject;

    const key = JSON.stringify(project);
    if (state.lastProjectKey === key && state.lastProject) return state.lastProject;
    state.lastProject = project;
    state.lastProjectKey = key;
    state.reloads += 1;
    logReload(state, resolution, project);
    return project;
  } catch {
    // A projection fault mid-stream keeps the last diagram, never blanks it.
    return state.lastProject;
  }
}
