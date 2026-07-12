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
 * design.json → cell DSL (design.cell) direct converter.
 *
 * The lossy `buildProjectDesign` → `toCellDiagramProject` → `wso2ToDsl` path
 * flattens away dependency `kind`/`resourceType`, so it cannot place nodes on
 * the right cell boundary. This converter reads the raw design.json files and
 * emits the SAME cell DSL the agent streams into `design.cell`, applying the
 * AEP boundary rules (the `cell-architecture-dsl` skill's placement table):
 *
 *   - own components (a `components/<name>/` folder) → inside the cell
 *   - platform-resource, non-thunder (postgres/cache/…)  → inside as a `database`
 *   - platform-resource `thunder-app`                    → east `identity-server`
 *   - org-service                                        → east `service`
 *   - external                                           → south `service`
 *   - component (sibling) dependency                     → internal edge only
 *   - exposure "internet" → `north -> comp`; "intranet" → `west -> comp`
 *
 * Pure and tolerant: malformed design.json files are skipped; returns `null`
 * when no valid component remains.
 */

const COMPONENT_RE = /^specs\/design\/components\/([^/]+)\/design\.json$/;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** kebab/snake id → Title Case label ("ceramics-webapp" → "Ceramics Webapp"). */
function titleCase(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Quote a label for the DSL (labels can contain spaces). */
function quote(label: string): string {
  return `"${label.replace(/"/g, "")}"`;
}

interface ParsedComponent {
  id: string;
  type: string;
  exposure: string;
  dependencies: { kind: string; name: string; resourceType?: string }[];
}

function parseComponent(id: string, raw: string | undefined): ParsedComponent | null {
  let dj: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw ?? "");
    if (!parsed || typeof parsed !== "object") return null;
    dj = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const deps: ParsedComponent["dependencies"] = [];
  if (Array.isArray(dj.dependencies)) {
    for (const d of dj.dependencies) {
      if (!d || typeof d !== "object") continue;
      const rec = d as Record<string, unknown>;
      const kind = str(rec.kind);
      const name = str(rec.name);
      if (!kind || !name) continue;
      const resourceType = str(rec.resourceType);
      deps.push(resourceType ? { kind, name, resourceType } : { kind, name });
    }
  }
  return {
    id,
    type: str(dj.type) ?? "service",
    exposure: str(dj.exposure) ?? "intranet",
    dependencies: deps,
  };
}

type Boundary = "east" | "south";

interface ExternalDecl {
  boundary: Boundary;
  type: string;
}

/**
 * Convert a design.json bundle to the cell DSL. `files` maps repo-relative
 * paths (`specs/design/components/<id>/design.json`, …) to their content.
 */
export function toCellDsl(projectName: string, files: Record<string, string>): string | null {
  const ids = Object.keys(files)
    .map((p) => COMPONENT_RE.exec(p)?.[1])
    .filter((id): id is string => id !== undefined)
    .sort();

  const components = ids
    .map((id) => parseComponent(id, files[`specs/design/components/${id}/design.json`]))
    .filter((c): c is ParsedComponent => c !== null);

  if (components.length === 0) return null;

  const componentIds = new Set(components.map((c) => c.id));

  // Nodes that live INSIDE the cell but are not their own component folder
  // (e.g. a postgres platform-resource) — declared as components, deduped.
  const innerResources = new Map<string, string>(); // name -> type
  // External nodes on a boundary, deduped by name (first declaration wins).
  const externals = new Map<string, ExternalDecl>();
  const exposureEdges: string[] = []; // `north -> comp` / `west -> comp`
  const depEdges: string[] = []; // `comp -> target`

  for (const c of components) {
    if (c.exposure === "internet") exposureEdges.push(`north -> ${c.id}`);
    else if (c.exposure === "intranet") exposureEdges.push(`west -> ${c.id}`);

    for (const dep of c.dependencies) {
      if (dep.kind === "component") {
        // Sibling hop — internal edge only (target already declared).
        depEdges.push(`${c.id} -> ${dep.name}`);
        continue;
      }
      if (dep.kind === "platform-resource") {
        if (dep.resourceType === "thunder-app") {
          if (!externals.has(dep.name)) externals.set(dep.name, { boundary: "east", type: "identity-server" });
        } else if (!componentIds.has(dep.name)) {
          // A backing datastore/cache lives inside the project's cell.
          if (!innerResources.has(dep.name)) innerResources.set(dep.name, "database");
        }
        depEdges.push(`${c.id} -> ${dep.name}`);
        continue;
      }
      if (dep.kind === "org-service") {
        if (!externals.has(dep.name)) externals.set(dep.name, { boundary: "east", type: "service" });
        depEdges.push(`${c.id} -> ${dep.name}`);
        continue;
      }
      if (dep.kind === "external") {
        if (!externals.has(dep.name)) externals.set(dep.name, { boundary: "south", type: "service" });
        depEdges.push(`${c.id} -> ${dep.name}`);
        continue;
      }
      // Unknown kind: skip (validated elsewhere; not a diagram node).
    }
  }

  const lines: string[] = [`title ${projectName}`, ""];

  for (const c of components) {
    lines.push(`component ${c.id} as ${quote(titleCase(c.id))} ${c.type}`);
  }
  for (const [name, type] of innerResources) {
    lines.push(`component ${name} as ${quote(titleCase(name))} ${type}`);
  }

  if (externals.size > 0) {
    lines.push("");
    for (const [name, decl] of externals) {
      lines.push(`${decl.boundary} ${name} as ${quote(titleCase(name))} ${decl.type}`);
    }
  }

  if (exposureEdges.length > 0) {
    lines.push("");
    lines.push(...exposureEdges);
  }
  if (depEdges.length > 0) {
    lines.push("");
    lines.push(...depEdges);
  }

  return lines.join("\n") + "\n";
}
