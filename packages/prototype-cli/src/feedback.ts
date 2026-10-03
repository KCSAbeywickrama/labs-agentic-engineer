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
 * The feedback a reviewer saves for the agent: `.prototype/feedback.json`,
 * overwritten on each save. Its requests match AEP's prototype feedback
 * annotations (screen, flow, role, state, element ids, text), so a host can
 * reuse them. `prototypeHash` names the revision the feedback was given
 * against. Shared by the preview server and the host app; dependency-free.
 */

export const FEEDBACK_SCHEMA_VERSION = 1;

/** Where the preview writes feedback, relative to the prototype folder. */
export const FEEDBACK_PATH = ".prototype/feedback.json";

/** The most requests one save takes. */
export const MAX_FEEDBACK_REQUESTS = 50;

/** The longest request text. */
export const MAX_FEEDBACK_TEXT = 4000;

/** The longest screen, flow, role, state, element or component id. */
export const MAX_FEEDBACK_ID = 200;

export interface FeedbackRequest {
  screenId: string;
  flowId?: string | undefined;
  roleId: string;
  stateId: string;
  /** The selected elements' ids, in selection order; empty for the whole screen. */
  elementIds: string[];
  text: string;
}

/** What the host posts to `POST /feedback`. */
export interface FeedbackSubmission {
  prototypeHash: string;
  requests: FeedbackRequest[];
}

/** What `.prototype/feedback.json` holds. */
export interface FeedbackFile extends FeedbackSubmission {
  schemaVersion: typeof FEEDBACK_SCHEMA_VERSION;
  /** ISO-8601 time of the save. */
  savedAt: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && v.length <= MAX_FEEDBACK_ID;

/** A request of the documented shape, or the rule it breaks. */
function parseRequest(v: unknown): { request: FeedbackRequest } | { reason: string } {
  if (!isObject(v)) return { reason: "is not an object" };
  const { screenId, flowId, roleId, stateId, elementIds, text } = v;
  for (const [name, id] of [["screenId", screenId], ["roleId", roleId], ["stateId", stateId]] as const) {
    if (!isId(id)) return { reason: `${name} must be a non-empty string of at most ${MAX_FEEDBACK_ID} characters` };
  }
  if (flowId !== undefined && !isId(flowId)) return { reason: `flowId must be a non-empty string of at most ${MAX_FEEDBACK_ID} characters` };
  if (!Array.isArray(elementIds) || !elementIds.every(isId)) return { reason: `elementIds must be a list of non-empty strings of at most ${MAX_FEEDBACK_ID} characters` };
  if (typeof text !== "string" || text.trim() === "") return { reason: "text is empty" };
  if (text.length > MAX_FEEDBACK_TEXT) return { reason: `text exceeds ${MAX_FEEDBACK_TEXT} characters` };
  return { request: { screenId: screenId as string, ...(flowId !== undefined ? { flowId } : {}), roleId: roleId as string, stateId: stateId as string, elementIds: [...elementIds], text } };
}

/** A submission of the documented shape, or the first rule it breaks. */
export function parseFeedbackSubmission(value: unknown): { submission: FeedbackSubmission } | { reason: string } {
  if (!isObject(value) || typeof value["prototypeHash"] !== "string" || !/^[0-9a-f]{64}$/.test(value["prototypeHash"])) return { reason: "prototypeHash must be the 64-character revision hash" };
  const requests = value["requests"];
  if (!Array.isArray(requests) || requests.length === 0) return { reason: "requests must be a non-empty list" };
  if (requests.length > MAX_FEEDBACK_REQUESTS) return { reason: `too many requests (max ${MAX_FEEDBACK_REQUESTS})` };
  const parsed: FeedbackRequest[] = [];
  for (const [i, r] of requests.entries()) {
    const result = parseRequest(r);
    if ("reason" in result) return { reason: `request ${i + 1} ${result.reason}` };
    parsed.push(result.request);
  }
  return { submission: { prototypeHash: value["prototypeHash"], requests: parsed } };
}
