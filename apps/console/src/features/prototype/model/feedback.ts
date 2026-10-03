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

import { PROTOTYPE_FEEDBACK_LIMITS } from "@aep/agent-stream";
import type { PrototypeViewState } from "@wso2/prototype-kit/host";
import type { components } from "../../../generated/aep-api";
import type { PrototypeFeedback } from "../../agent-chat/turnScope";

// A review's Annotate queue, and the batch Send all makes of it. Mirrors the
// kit CLI's host (packages/prototype-cli/src/host/annotations.ts): a request
// is made on what the reviewer is looking at (screen, flow, role, display
// state) for the elements selected, in selection order; none selected means
// the whole screen. The limits are the contract's (PROTOTYPE_FEEDBACK_LIMITS).

export type FeedbackRequest = components["schemas"]["PrototypeFeedbackRequest"];

/** The most requests one Send all takes. */
export const MAX_REQUESTS = PROTOTYPE_FEEDBACK_LIMITS.requests;

/** The longest request text. */
export const MAX_REQUEST_TEXT = PROTOTYPE_FEEDBACK_LIMITS.text;

/** The queued requests, and the revision the first one was made on. */
export interface ReviewQueue {
  /** The hash of the prototype showing when the first request was queued. */
  hash: string;
  requests: FeedbackRequest[];
  /** What each request's elements were called on screen, aligned with `requests`: the chat's summary names them. */
  labels: string[][];
}

/** A request on the current screen, flow, role and state, for the selection in the order it was made. */
export function requestFor(view: PrototypeViewState, text: string): FeedbackRequest {
  return {
    screenId: view.screenId,
    ...(view.flowId !== null ? { flowId: view.flowId } : {}),
    roleId: view.roleId,
    stateId: view.stateId,
    elementIds: [...view.selectedKeys],
    text,
  };
}

/** For each element a queued request on this screen names, the requests' 1-based queue numbers. */
export function pinsOnScreen(requests: readonly FeedbackRequest[], screenId: string): Record<string, number[]> {
  const pins: Record<string, number[]> = {};
  requests.forEach((request, i) => {
    if (request.screenId !== screenId) return;
    for (const id of request.elementIds) pins[id] = [...(pins[id] ?? []), i + 1];
  });
  return pins;
}

/** Queue a request: the queue's revision is the one showing when its first request is made. */
export function enqueue(
  queue: ReviewQueue | null,
  hash: string,
  request: FeedbackRequest,
  labels: readonly string[] = request.elementIds,
): ReviewQueue {
  if (!queue || queue.requests.length === 0) return { hash, requests: [request], labels: [[...labels]] };
  if (queue.requests.length >= MAX_REQUESTS) return queue;
  return { hash: queue.hash, requests: [...queue.requests, request], labels: [...queue.labels, [...labels]] };
}

/** The queue without its `index`th request; null once it is empty. */
export function dequeue(queue: ReviewQueue, index: number): ReviewQueue | null {
  const requests = queue.requests.filter((_, i) => i !== index);
  if (requests.length === 0) return null;
  return { ...queue, requests, labels: queue.labels.filter((_, i) => i !== index) };
}

/** What Send all sends: every queued request, on the revision they were made on. */
export function feedbackBatch(component: string, queue: ReviewQueue): PrototypeFeedback {
  return { prototypeHash: queue.hash, component, requests: queue.requests };
}

/**
 * A revision's identity, as the kit computes it (prototype-cli `hash.ts`):
 * the SHA-256 of the manifest's text, a NUL, and the source's, in lowercase hex.
 */
export async function prototypeHash(manifestText: string, source: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${manifestText}\u0000${source}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
