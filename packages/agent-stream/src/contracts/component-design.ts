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
 * ComponentDesign — the AUTHORED per-component design file at
 * `specs/design/components/<name>/design.json`. This replaces the
 * component-level design.md: the spec agent writes it (whole-file rewrites,
 * schema-validated by the FileBundle on every write), downstream consumers
 * (design projection, coding-agent dispatch, task generation) read it
 * directly. The TOP-LEVEL design.md (prose + skillsApplied frontmatter) is
 * unchanged. The Zod validator (`componentDesignSchema` in
 * `../component-design-schema.ts`) is drift-guarded against this type.
 */

export interface ComponentDesign {
  /** Must equal the component's directory name (kebab-case). */
  name: string;
  /**
   * Component kind. "service" and "webapp" carry full platform conventions
   * (openapi.yaml / wireframes.dsl and deployment support); any other kind
   * the requirements imply (e.g. "scheduled-task", "worker") is CAPTURED at
   * design time — support-gating happens in later phases, not here.
   */
  type: string;
  /** Semantic version; "0.1.0" for a new component. */
  version: string;
  /** Implementation language, e.g. "Go", "TypeScript". */
  language: string;
  /** Always "docker" today. */
  buildpack: string;
  /** Repo-relative source dir — the component name. */
  appPath: string;
  /** Deploy entry, e.g. "deployment/service". */
  entrypoint: string;
  /** Gateway exposure of the component's endpoint. */
  exposure: "internet" | "intranet";
  /** Typed dependency edges — mirrors the design.md Interactions section. */
  connections: ComponentConnection[];
  /** The single-responsibility paragraph (what it does / does NOT do). */
  description: string;
}

export interface ComponentConnection {
  /** Target: a sibling component name, or an external system id. */
  to: string;
  type: "http" | "datastore" | "connector";
  /** False for systems outside the platform. Default: true. */
  onPlatform?: boolean;
}
