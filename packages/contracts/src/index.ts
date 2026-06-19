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

import type { components } from "./generated/example";
import type { components as aepApi } from "./generated/aep-api";

/**
 * Widget is sourced from the generated OpenAPI types — never hand-defined.
 * The OpenAPI spec (`openapi/example.yaml`) is the single source of truth.
 */
export type Widget = components["schemas"]["Widget"];

/**
 * A trivial consumer of the generated type. Renaming or removing the `name`
 * field in the OpenAPI spec breaks this line at typecheck time — guard #2,
 * the self-correction signal at a contract consumer.
 */
export function widgetLabel(w: Widget): string {
  return w.name;
}

/* aep-api orchestration boundary — types sourced from openapi/aep-api.yaml. */

export type CycleState = aepApi["schemas"]["CycleState"];
export type GatePolicy = aepApi["schemas"]["GatePolicy"];
export type Phase = aepApi["schemas"]["Phase"];
export type TaskState = aepApi["schemas"]["TaskState"];
export type CreateCycleRequest = aepApi["schemas"]["CreateCycleRequest"];

/**
 * Consumer of the generated CycleState — proves the aep-api contract rail.
 * Renaming `phase`/`gatesPassed` in openapi/aep-api.yaml breaks this at
 * typecheck time (drift guard #2).
 */
export function isCycleComplete(s: CycleState): boolean {
  return s.phase === "complete" && s.gatesPassed.tasks;
}
