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
 * `@aep/agent-stream` — the single client-side consumption surface for the spec
 * agent's turn stream. Zero server-side dependencies (no Express, no AI SDK), so
 * the console, the evals, the playground, and the agents service all fold the
 * wire through ONE definition. Moving `FileBundle` here brings the component
 * `design.json` write-gate with it, so any fold enforces the same schema for
 * free (§3/§12.4 of the migration decision record).
 */

// --- Wire contracts (the turn request + the SSE payload shapes) --------------
export type {
  Op,
  ErrCode,
  MatchCandidate,
  OpOk,
  OpErr,
  OpResult,
  AddFileInput,
  EditFileInput,
  RemoveFileInput,
  SetFrontmatterFieldInput,
  Skill,
  LoadSkillInput,
  LoadSkillResult,
  LoadSkillReferenceInput,
  LoadSkillReferenceResult,
  Change,
  TurnRequest,
  AgentSseEventType,
} from "./contracts/sse-events.js";
export { AGENT_SSE_EVENT_TYPES, SSE_DONE } from "./contracts/sse-events.js";
export type { ComponentDesign, ComponentConnection } from "./contracts/component-design.js";

// --- The stream-part seam ----------------------------------------------------
export type { StreamPart } from "./stream-types.js";

// --- The fold surface --------------------------------------------------------
export { FileBundle, lf, FRONTMATTER_RE } from "./bundle.js";
export { toChange, applyToolCall, isFileMutationTool } from "./change.js";

// --- The component design.json write-gate (travels with FileBundle) ----------
export {
  checkComponentDesign,
  componentDesignSchema,
  COMPONENT_DESIGN_JSON_RE,
} from "./component-design-schema.js";
export type { ComponentDesignProblem } from "./component-design-schema.js";

// --- JSON Schema publication (BFF save-gate validates the same definition) ----
export { componentDesignJsonSchema } from "./json-schema.js";

// --- The reference SSE reader ------------------------------------------------
// `streamTurn` = fetch + parse (server-side callers: evals, playground).
// `parseSseStream` = parse only, for a caller that owns its own fetch (the
// console adds auth + a `{useCase,...}` body + pre-stream status mapping).
export { streamTurn, parseSseStream } from "./sse-client.js";
export type { StreamTurnOptions } from "./sse-client.js";
