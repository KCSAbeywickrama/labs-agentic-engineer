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
 * Parser for a component's `design.json`. Turns the raw file text into a
 * tolerant, UI-friendly model the React view can render without knowing the
 * schema. Intentionally permissive — generated designs may be partial drafts;
 * missing fields are omitted, unknown/platform-owned fields (exposesAPI,
 * componentAgentInstructions) are ignored, and a malformed file degrades to a
 * ParseError the view shows as an alert instead of throwing.
 *
 * Dependency resolution `status`/`reason` are deliberately NOT modelled — they
 * are computed server-side and never present in the raw file.
 */

export type DependencyKind =
  | "component"
  | "org-service"
  | "external"
  | "platform-resource";

export interface DesignConfigEntry {
  key: string;
  secret?: boolean;
  credentialClass?: string;
}

export interface DesignCandidate {
  label: string;
  description?: string;
  url?: string;
}

export interface Dependency {
  /** The declared kind; kept as a raw string so an unknown kind still renders. */
  kind: DependencyKind | string;
  name: string;
  description?: string;
  needsSpec?: boolean;
  specPath?: string;
  specUrl?: string;
  config?: DesignConfigEntry[];
  resourceType?: string;
  parameters?: Record<string, unknown>;
  candidates?: DesignCandidate[];
}

export interface DesignEndpoint {
  name: string;
}

export interface ComponentDesign {
  name: string;
  type: string;
  version: string;
  language: string;
  buildpack: string;
  appPath: string;
  entrypoint: string;
  exposure: string;
  description?: string;
  skillsApplied?: string[];
  endpoint?: DesignEndpoint;
  dependencies: Dependency[];
}

export interface ParseError {
  kind: "parse-error";
  message: string;
}

export type ParseResult = ComponentDesign | ParseError;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function optBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseConfig(v: unknown): DesignConfigEntry[] {
  if (!Array.isArray(v)) return [];
  const out: DesignConfigEntry[] = [];
  for (const item of v) {
    if (!isObject(item)) continue;
    const key = str(item.key);
    if (!key) continue;
    const entry: DesignConfigEntry = { key };
    const secret = optBool(item.secret);
    if (secret !== undefined) entry.secret = secret;
    const credentialClass = optStr(item.credentialClass);
    if (credentialClass) entry.credentialClass = credentialClass;
    out.push(entry);
  }
  return out;
}

function parseCandidates(v: unknown): DesignCandidate[] {
  if (!Array.isArray(v)) return [];
  const out: DesignCandidate[] = [];
  for (const item of v) {
    if (!isObject(item)) continue;
    const label = str(item.label);
    if (!label) continue;
    const candidate: DesignCandidate = { label };
    const description = optStr(item.description);
    if (description) candidate.description = description;
    const url = optStr(item.url);
    if (url) candidate.url = url;
    out.push(candidate);
  }
  return out;
}

function parseDependencies(v: unknown): Dependency[] {
  if (!Array.isArray(v)) return [];
  const out: Dependency[] = [];
  for (const item of v) {
    if (!isObject(item)) continue;
    const name = str(item.name);
    if (!name) continue;
    const dep: Dependency = { kind: str(item.kind) || "unknown", name };
    const description = optStr(item.description);
    if (description) dep.description = description;
    const needsSpec = optBool(item.needsSpec);
    if (needsSpec !== undefined) dep.needsSpec = needsSpec;
    const specPath = optStr(item.specPath);
    if (specPath) dep.specPath = specPath;
    const specUrl = optStr(item.specUrl);
    if (specUrl) dep.specUrl = specUrl;
    const resourceType = optStr(item.resourceType);
    if (resourceType) dep.resourceType = resourceType;
    const config = parseConfig(item.config);
    if (config.length) dep.config = config;
    const candidates = parseCandidates(item.candidates);
    if (candidates.length) dep.candidates = candidates;
    if (isObject(item.parameters)) dep.parameters = item.parameters;
    out.push(dep);
  }
  return out;
}

export function parseComponentDesign(raw: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { kind: "parse-error", message: (e as Error).message };
  }
  if (!isObject(data)) {
    return { kind: "parse-error", message: "design.json is not a JSON object" };
  }

  const design: ComponentDesign = {
    name: str(data.name),
    type: str(data.type),
    version: str(data.version),
    language: str(data.language),
    buildpack: str(data.buildpack),
    appPath: str(data.appPath),
    entrypoint: str(data.entrypoint),
    exposure: str(data.exposure),
    dependencies: parseDependencies(data.dependencies),
  };

  const description = optStr(data.description);
  if (description) design.description = description;

  if (Array.isArray(data.skillsApplied)) {
    const skills = data.skillsApplied.filter(
      (s): s is string => typeof s === "string",
    );
    if (skills.length) design.skillsApplied = skills;
  }

  if (isObject(data.endpoint)) {
    const epName = optStr(data.endpoint.name);
    if (epName) design.endpoint = { name: epName };
  }

  return design;
}
