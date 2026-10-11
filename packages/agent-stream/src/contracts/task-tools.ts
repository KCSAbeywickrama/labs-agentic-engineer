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
 * Build-plan tool contract — the wire source of truth for the plan turn's one
 * domain tool, `planBuild`. Peer of `sse-events.ts`: this module owns the TYPES
 * (input, result, error codes, tool name); the Zod `inputSchema` lives in
 * `../task-tools-schema.ts` (drift-guarded against these types) and the
 * known-components rule in `../task-context.ts`. The design agent, the
 * playground and the Go BFF plan tap all speak this one definition.
 *
 * A build is one GitHub issue: an ordered checklist of the version's work, one
 * item per carried feature, after an optional Foundation item. The platform
 * names what the version carries (the plan scope); the planner only orders the
 * items and says, per item, which components it touches and what to know. The
 * plan turn's `files` are read-only: the spec and design at the version's tag.
 *
 * The result is self-contained, like `OpOk`/`OpErr`: a success echoes the
 * normalized plan, enough for the tap to render the issue without re-deriving
 * from the input, and a failure carries `code` + `message` + the payload that
 * lets the model correct itself in the same turn.
 */

// --- Tool name (frame routing for the BFF plan tap + the console) -----------

/** Write the build's ordered checklist. A later ok call replaces an earlier one. */
export const PLAN_BUILD = "planBuild" as const;

// --- Shared domain values ----------------------------------------------------

/** The task-plan operation (mirrors `Op` for file tools). */
export type TaskOp = "build";

/** The item that carries a version's shared setup and product-wide requirements. */
export const FOUNDATION_ITEM = "foundation" as const;

/** The one item of a plan whose version carries no features. */
export const WHOLE_SPEC_ITEM = "spec" as const;

/** Tool-side validation failures the accumulator returns for in-turn self-correction. */
export type TaskToolErrCode = "UNKNOWN_COMPONENT" | "UNKNOWN_ITEM" | "MISSING_ITEM" | "DUPLICATE_ITEM" | "ITEM_ORDER";

// --- Input shape (the `tool-call.input` value) ------------------------------
//
// WIRE source of truth. The Zod `inputSchema` in `../task-tools-schema.ts`
// carries a compile-time assert that `z.infer<schema>` stays equal to it.

/** One checklist item of a build. */
export interface BuildPlanItem {
  /** `"foundation"`, a carried feature's ID (`"F2"`), or `"spec"` when the version carries no features. */
  item: string;
  /** The design components the item changes; each MUST be a known component. */
  components: string[];
  /** One or two sentences: what the coding agent should know before it starts the item. */
  note: string;
}

export interface BuildPlanInput {
  /** The checklist in build order. */
  items: BuildPlanItem[];
}

// --- Result payloads (the `tool-result.output` value) -----------------------

/** A successful `planBuild` — the normalized checklist the BFF writes the build issue from. */
export interface BuildPlanOk {
  ok: true;
  op: "build";
  items: BuildPlanItem[];
}

/**
 * A failed `planBuild`. Carries `code` + `message` plus the payload its code
 * implies (the others stay absent) — mirrors `OpErr`.
 */
export interface TaskToolErr {
  ok: false;
  op: TaskOp;
  code: TaskToolErrCode;
  message: string;
  /** UNKNOWN_COMPONENT: the component names an item may name. */
  knownComponents?: string[];
  /** UNKNOWN_ITEM, MISSING_ITEM, DUPLICATE_ITEM, ITEM_ORDER: the items the version carries, in an order that builds. */
  carriedItems?: string[];
}

export type BuildPlanResult = BuildPlanOk | TaskToolErr;
