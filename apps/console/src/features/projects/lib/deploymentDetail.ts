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

// The environment page's "Try it out" and Connections surfaces (ADR-0032,
// the Deployment Detail design): pure derivations over the component's
// OpenAPI contract, the design's dependency graph and the readiness read.
// Nothing here invents a fact the platform does not hold — the endpoints come
// from the contract the platform serves, the curl carries a placeholder where
// a token would go (the platform mints none), and a connection's VALUE is
// never shown because nothing reads it back.

import type { Operation, ParsedOpenApi } from "@aep/ui-openapi-view";
import type { StatusTone } from "../../../components/StatusChip";
import type { components } from "../../../generated/aep-api";
import { developmentConnections, type ConnectionLine } from "./deploymentFlow";
import type { EnvironmentInfo } from "./environments";
import type { ConnectionRow } from "./promotion";

type ComponentDependencies = components["schemas"]["ComponentDependencies"];
type ProjectDependencyReadiness =
  components["schemas"]["ProjectDependencyReadiness"];

// ── The component graph ─────────────────────────────────────────────────────

/** The components this one calls, in the design's own words (component edges). */
export function talksTo(
  design: ComponentDependencies[] | null | undefined,
  componentName: string,
): string[] {
  const comp = (design ?? []).find((c) => c.componentName === componentName);
  return (comp?.dependencies ?? [])
    .filter((d) => d.kind === "component")
    .map((d) => d.name)
    .sort();
}

/** Dependency name (lower-cased) → the components that declare it. */
export function usedBy(
  design: ComponentDependencies[] | null | undefined,
): Map<string, string[]> {
  const by = new Map<string, string[]>();
  for (const comp of design ?? []) {
    for (const dep of comp.dependencies ?? []) {
      if (dep.kind === "component") continue;
      const key = dep.name.toLowerCase();
      const list = by.get(key) ?? [];
      if (!list.includes(comp.componentName)) list.push(comp.componentName);
      by.set(key, list);
    }
  }
  for (const list of by.values()) list.sort();
  return by;
}

// ── Endpoints ───────────────────────────────────────────────────────────────

/** Every operation in the contract, in document order, deduped by id. */
export function flattenEndpoints(parsed: ParsedOpenApi): Operation[] {
  const seen = new Set<string>();
  const out: Operation[] = [];
  for (const section of parsed.sections) {
    for (const op of section.endpoints) {
      if (seen.has(op.id)) continue;
      seen.add(op.id);
      out.push(op);
    }
  }
  return out;
}

/** The methods the contract uses, in the order a reader expects them. */
const METHOD_ORDER: Operation["method"][] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export function methodsIn(ops: Operation[]): Operation["method"][] {
  const present = new Set(ops.map((o) => o.method));
  return METHOD_ORDER.filter((m) => present.has(m));
}

export function filterEndpoints(
  ops: Operation[],
  query: string,
  method: Operation["method"] | "ALL",
): Operation[] {
  const q = query.trim().toLowerCase();
  return ops.filter(
    (op) =>
      (method === "ALL" || op.method === method) &&
      (q === "" ||
        op.path.toLowerCase().includes(q) ||
        op.summary.toLowerCase().includes(q) ||
        op.name.toLowerCase().includes(q)),
  );
}

/** A method's colour: the console's status tones, read as HTTP verbs. */
export function methodTone(method: Operation["method"]): StatusTone {
  switch (method) {
    case "GET":
      return "success";
    case "POST":
      return "warning";
    case "PUT":
    case "PATCH":
      return "info";
    case "DELETE":
      return "error";
    default:
      return "neutral";
  }
}

const BODY_METHODS = new Set<Operation["method"]>(["POST", "PUT", "PATCH"]);

/**
 * A curl for the operation against the deployed URL. The Authorization line
 * carries a placeholder: the platform mints no token for a test user, so the
 * command says where one goes rather than pretending to have one.
 */
export function curlFor(baseUrl: string, op: Operation): string {
  const url = `${baseUrl.replace(/\/+$/, "")}${op.path}`;
  const lines = [`curl -X ${op.method} '${url}'`, `-H 'Accept: application/json'`];
  if (BODY_METHODS.has(op.method)) {
    lines.push(`-H 'Content-Type: application/json'`, `-d '{}'`);
  }
  lines.push(`-H 'Authorization: Bearer <token>'`);
  return lines.join(" \\\n  ");
}

// ── Connections ─────────────────────────────────────────────────────────────

export interface ConnectionTableRow {
  line: ConnectionLine;
  /** "External" · "postgres-cnpg" · "thunder-app". */
  type: string;
  /** The components that declare it, from the design. */
  usedBy: string[];
  /** The config keys it carries — shown masked; nothing reads a value back. */
  keys: string[];
}

/**
 * The Connections table for one environment. Values are collected where they
 * are FIRST needed — the pipeline's first environment, the one a build lands
 * in: there the state comes from the readiness read and Edit re-collects them
 * (the board's own surface). Downstream of it nothing reads values and nothing
 * collects them here, so every external reads as unknown with no Edit — the
 * promote dialog on the board is where a promoted environment's values go.
 */
export function connectionTable(
  rows: ConnectionRow[],
  design: ComponentDependencies[] | null | undefined,
  readiness: ProjectDependencyReadiness | undefined,
  env: EnvironmentInfo | undefined,
  registeredNames: Set<string>,
  catalogUnknown: boolean,
): ConnectionTableRow[] {
  const collectsValues = env?.position === 0;
  const lines = developmentConnections(
    rows,
    collectsValues ? readiness : undefined,
    null,
    registeredNames,
    // A later environment offers no Edit at all — treating the catalog as
    // unknown is the one switch that turns Configure off for every external.
    collectsValues ? catalogUnknown : true,
  );
  const by = usedBy(design);
  return lines.map((line) => ({
    line,
    type: line.row.detail ?? (line.row.kind === "external" ? "External" : line.row.kind),
    usedBy: by.get(line.row.name.toLowerCase()) ?? [],
    keys: line.row.config.map((k) => k.key),
  }));
}
