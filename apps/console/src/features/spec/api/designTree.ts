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

import type { RailPlanEntry } from "../lib/railSections";
import { isAcceptanceFeaturePath, type SpecFileEntry } from "./mapping";

/** What the content pane should render for the current sidebar selection. */
export type SpecSelection =
  | { kind: "file"; path: string }
  | { kind: "cell-diagram" }
  | { kind: "security" }
  // Every specs/acceptance/*.feature at once, not one of them: the pane reads
  // them as one document set, which is what lets a reader search across
  // capabilities instead of guessing which one holds the scenario.
  | { kind: "acceptance" }
  | { kind: "wireframe"; component: string; dslPath: string };

/**
 * One external dependency's directory, `specs/design/dependencies/<name>/`,
 * shaped like a component's: the definition (dependency.json), the interface
 * it exposes (openapi.yaml / schema.graphql) and an sdk.json when the style
 * is SDK — every one a browsable file. One dependency, one definition;
 * components only reference it by name.
 */
export interface DesignDependencyNode {
  name: string;
  /** The directory's files, definition first, then path order. */
  files: SpecFileEntry[];
}

export interface DesignComponentNode {
  name: string;
  /** Browsable files (design.json, openapi.yaml, …) — excludes the raw .dsl. */
  files: SpecFileEntry[];
  /** The component's wireframes .dsl path, or null if it has none. */
  wireframeDslPath: string | null;
}

export interface DesignSection {
  /** Design files directly under design/ (e.g. domain-model.md) — the flat rows. */
  overview: SpecFileEntry[];
  /** Key flows under design/flows/ — one file per flow, the rail's first group. */
  flows: SpecFileEntry[];
  hasComponents: boolean;
  /** Whether a project-level design.cell exists (drives the Architecture tab). */
  hasCellDsl: boolean;
  /** Whether specs/design/security.json exists (drives the Security rail entry). */
  hasSecurity: boolean;
  components: DesignComponentNode[];
  /** The external dependencies with a directory, sorted by name. */
  dependencies: DesignDependencyNode[];
}

/** The project-level cell-diagram DSL path (rendered via the Architecture tab, never as a file). */
export const DESIGN_CELL_PATH = "specs/design/design.cell";

/** The security design document — one file, one rail entry. */
export const SECURITY_JSON_PATH = "specs/design/security.json";

/** The domain model — one ER diagram, one rail entry. */
export const DOMAIN_MODEL_PATH = "specs/design/domain-model.md";

const FLOW_RE = /^specs\/design\/flows\/[^/]+\.md$/;

/** Is this a key-flow document (`specs/design/flows/<slug>.md`)? */
export function isFlow(path: string): boolean {
  return FLOW_RE.test(path);
}

function hideFromOverview(path: string): boolean {
  return path === DESIGN_CELL_PATH || path === SECURITY_JSON_PATH;
}

// SpecFileEntry.path is the full repo-relative path (mapping.ts's current
// scheme — the unprefixed room-key scheme it retired), so this must match
// the `specs/` prefix too.
const COMPONENT_RE = /^specs\/design\/components\/([^/]+)\//;

/** Component name for a `specs/design/components/<name>/…` path, else null. */
export function componentOf(path: string): string | null {
  return COMPONENT_RE.exec(path)?.[1] ?? null;
}

const DEPENDENCY_RE = /^specs\/design\/dependencies\/([^/]+)\//;

/** The dependency a path belongs to (`specs/design/dependencies/<name>/…`), or null. */
export function dependencyOf(path: string): string | null {
  return DEPENDENCY_RE.exec(path)?.[1] ?? null;
}

export function dependencyDefinitionPath(name: string): string {
  return dependencyFilePath(name, "dependency.json");
}

const DEPENDENCY_DEFINITION_RE = /^specs\/design\/dependencies\/[^/]+\/dependency\.json$/;

/** Is this a dependency's definition (`specs/design/dependencies/<name>/dependency.json`)? */
export function isDependencyDefinition(path: string): boolean {
  return DEPENDENCY_DEFINITION_RE.test(path);
}

/** A file in a dependency's directory, by its bare name (`openapi.yaml`, `sdk.json`). */
export function dependencyFilePath(name: string, file: string): string {
  return `specs/design/dependencies/${name}/${file}`;
}

function isDsl(path: string): boolean {
  return path.endsWith(".dsl");
}

/**
 * Group the Designs files into an overview list + per-component nodes. The raw
 * `.dsl` sources are not listed as files; each becomes its component's wireframe
 * entry (rendered as a diagram, not shown as text). Components and their files
 * are sorted by path for a stable tree.
 */
/**
 * What the Validation rail section is made of.
 *
 * It exists for the same reason `DesignSection` does: the section's shape is
 * derived from the file list and the plan, and deriving it inline in the
 * component put that reasoning in the middle of the rendering.
 *
 * The acceptance criteria are the whole reason it is not just a file list. One
 * rail entry stands for EVERY `specs/acceptance/*.feature` (ADR-0031), so the
 * section has to say both which files get an ordinary row AND whether that one
 * standing-in entry belongs there. Deriving the two separately is how they come
 * to disagree — a predicate changed on one side and not the other drops files
 * out of the rail with nothing to catch it — so they are computed together,
 * from one pass, here.
 */
export interface ValidationSection {
  /** The rows that are one file each. The acceptance features are NOT among them. */
  files: SpecFileEntry[];
  /** Whether the single "Acceptance criteria" entry belongs in the rail. */
  hasAcceptance: boolean;
  /**
   * The path the acceptance entry takes its plan status from, if any.
   *
   * `row` reads status from ONE path and this entry stands for many, so the two
   * things it needs are folded into a single answer: it pulses while the agent
   * is writing ANY capability, and it is a ghost only when NOT ONE is committed
   * yet — with two written and a third planned the entry is real and has to
   * stay clickable.
   */
  acceptanceStatusPath: string | undefined;
}

export function buildValidationSection(
  /** Committed files UNION the plan's ghosts — everything that gets a row. */
  allFiles: SpecFileEntry[],
  /**
   * Which of those paths actually exist yet.
   *
   * Both are needed and neither substitutes for the other: `allFiles` decides
   * what is SHOWN, including a planned path holding its place, while this
   * decides what has been WRITTEN. Deriving the second from the first counts a
   * ghost as committed, and the entry stops being a ghost while nothing has
   * been written at all.
   */
  committed: ReadonlySet<string>,
  plan: readonly RailPlanEntry[],
): ValidationSection {
  const validation = allFiles.filter((f) => f.group === "validation");
  const acceptanceFiles = validation.filter((f) => isAcceptanceFeaturePath(f.path));
  const plannedPaths = plan
    .filter((e) => isAcceptanceFeaturePath(e.path))
    .map((e) => e.path);

  const writing = plan.find(
    (e) => e.status === "writing" && isAcceptanceFeaturePath(e.path),
  )?.path;
  const anyCommitted = acceptanceFiles.some((f) => committed.has(f.path));

  return {
    // The one filter, so nothing can hide a file the entry does not cover.
    files: validation.filter((f) => !isAcceptanceFeaturePath(f.path)),
    hasAcceptance: acceptanceFiles.length > 0 || plannedPaths.length > 0,
    acceptanceStatusPath: writing ?? (anyCommitted ? undefined : plannedPaths[0]),
  };
}

export function buildDesignSection(files: SpecFileEntry[]): DesignSection {
  const design = files.filter((f) => f.group === "designs");
  const hasCellDsl = design.some((f) => f.path === DESIGN_CELL_PATH);
  const hasSecurity = design.some((f) => f.path === SECURITY_JSON_PATH);
  // design.cell is surfaced through the Architecture tab (streaming cell
  // diagram), never as a raw text file. security.json is the Security rail
  // entry, not an overview row.
  const overview = design
    .filter(
      (f) =>
        componentOf(f.path) === null &&
        dependencyOf(f.path) === null &&
        !isFlow(f.path) &&
        !hideFromOverview(f.path),
    )
    .sort((a, b) => a.path.localeCompare(b.path));
  const flows = design
    .filter((f) => isFlow(f.path))
    .sort((a, b) => a.path.localeCompare(b.path));

  const byComponent = new Map<string, DesignComponentNode>();
  for (const f of design) {
    const name = componentOf(f.path);
    if (name === null) continue;
    let node = byComponent.get(name);
    if (!node) {
      node = { name, files: [], wireframeDslPath: null };
      byComponent.set(name, node);
    }
    if (isDsl(f.path)) node.wireframeDslPath = f.path;
    else node.files.push(f);
  }

  const components = [...byComponent.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const c of components) c.files.sort((a, b) => a.path.localeCompare(b.path));

  const byDependency = new Map<string, DesignDependencyNode>();
  for (const f of design) {
    const name = dependencyOf(f.path);
    if (name === null) continue;
    let node = byDependency.get(name);
    if (!node) {
      node = { name, files: [] };
      byDependency.set(name, node);
    }
    node.files.push(f);
  }
  const dependencies = [...byDependency.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  // The definition leads its directory the way the PRD leads Requirements:
  // it is what the dependency IS, and on path alone `dependency.json` sorts
  // below `openapi.yaml` only by accident of the alphabet.
  for (const d of dependencies) {
    d.files.sort(
      (a, b) =>
        Number(isDependencyDefinition(b.path)) - Number(isDependencyDefinition(a.path)) ||
        a.path.localeCompare(b.path),
    );
  }

  return {
    overview,
    flows,
    hasComponents: components.length > 0,
    hasCellDsl,
    hasSecurity,
    components,
    dependencies,
  };
}

/**
 * The selection that WATCHES a path being written (#576, ADR-0026) — the same
 * routing the rail's own rows use: the cell opens as the Architecture diagram,
 * security.json opens the Security entry, a wireframe `.dsl` opens as its
 * component's diagram, and everything else is the file itself (a structured
 * file — a component's design.json, a dependency's dependency.json — is a
 * file selection too; the pane picks its renderer by path). An acceptance
 * `.feature` opens the Acceptance criteria entry, which is the whole set, since
 * the rail no longer has a row for one of them. One definition,
 * so follow-the-write can never land somewhere a click on the rail would not
 * have gone.
 */
export function followSelection(path: string): SpecSelection {
  if (path === DESIGN_CELL_PATH) return { kind: "cell-diagram" };
  if (path === SECURITY_JSON_PATH) return { kind: "security" };
  if (isAcceptanceFeaturePath(path)) return { kind: "acceptance" };
  const component = componentOf(path);
  if (component && isDsl(path)) {
    return { kind: "wireframe", component, dslPath: path };
  }
  return { kind: "file", path };
}

/** Stable string identity for a selection (React keys + selected-state compare). */
export function selectionKey(sel: SpecSelection): string {
  switch (sel.kind) {
    case "file":
      return `file:${sel.path}`;
    case "cell-diagram":
      return "cell-diagram";
    case "security":
      return "security";
    case "acceptance":
      return "acceptance";
    case "wireframe":
      return `wireframe:${sel.component}`;
  }
}
