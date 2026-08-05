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

import { tryDslToExcalidraw, type DslKind } from "@aep/excalidraw-dsl";

/** `erd`/`domain` filenames are domain-model DSL; everything else is wireframes. */
export function kindFor(path: string): DslKind {
  const base = (path.split("/").at(-1) ?? "").toLowerCase();
  return base.startsWith("erd") || base.startsWith("domain") ? "domain-model" : "wireframes";
}

/**
 * Compile a `.dsl` source into an Excalidraw scene JSON string. Returns null
 * when the DSL does not compile (empty / no screens) — a bad source never
 * throws into the render tree.
 */
export function deriveWireframeScene(path: string, dsl: string): string | null {
  const res = tryDslToExcalidraw(kindFor(path), dsl);
  return res.ok ? res.json : null;
}
