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

/** The Annotate queue: requests on what the reviewer is looking at, and the numbered pins they put on a screen. */

import type { PrototypeViewState } from "@wso2/prototype-kit/host";
import type { FeedbackRequest } from "../feedback.js";

/** A request on the current screen, flow, role and state, for the selection in the order it was made (none: the whole screen). */
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
export function pinsOnScreen(queue: readonly FeedbackRequest[], screenId: string): Record<string, number[]> {
  const pins: Record<string, number[]> = {};
  queue.forEach((request, i) => {
    if (request.screenId !== screenId) return;
    for (const id of request.elementIds) pins[id] = [...(pins[id] ?? []), i + 1];
  });
  return pins;
}
