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

const MAX_TEXT = 4000;
const MAX_ID = 200;

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
const isId = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && v.length <= MAX_ID;

function parseRequest(v: unknown): FeedbackRequest | null {
  if (!isObject(v)) return null;
  const { screenId, flowId, roleId, stateId, elementIds, text } = v;
  if (!isId(screenId) || !isId(roleId) || !isId(stateId)) return null;
  if (flowId !== undefined && !isId(flowId)) return null;
  if (!Array.isArray(elementIds) || !elementIds.every(isId)) return null;
  if (typeof text !== "string" || text.trim() === "" || text.length > MAX_TEXT) return null;
  return { screenId, ...(flowId !== undefined ? { flowId } : {}), roleId, stateId, elementIds: [...elementIds], text };
}

/** A submission of the documented shape, or null for anything else. */
export function parseFeedbackSubmission(value: unknown): FeedbackSubmission | null {
  if (!isObject(value) || typeof value["prototypeHash"] !== "string" || !/^[0-9a-f]{64}$/.test(value["prototypeHash"])) return null;
  const requests = value["requests"];
  if (!Array.isArray(requests) || requests.length === 0 || requests.length > MAX_FEEDBACK_REQUESTS) return null;
  const parsed = requests.map(parseRequest);
  if (parsed.some((r) => r === null)) return null;
  return { prototypeHash: value["prototypeHash"], requests: parsed as FeedbackRequest[] };
}
