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

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeTurnEnd } from "../../agent-chat/chatStore.js";
import {
  invalidateDependencyFreshness,
  scheduleFreshnessPoll,
} from "../api/dependencyFreshness.js";
import type { CollabSpec } from "./useCollabSpec";

/**
 * Chat-path turn-end flush (#252 Task 5 — closes the 60s room→git race, see
 * the feature's "Freshness" design note). SpecView is the only place with a
 * live collab connection, so it's the only place that can force the SAME
 * room flush Build already uses (`useCollabSpec.flush()` — SpecView's
 * `onBuild` awaits it before checking preflight). The chat panel is a
 * SIBLING under AppLayout, not an ancestor/descendant, so "a turn just
 * ended" crosses subtrees via chatStore's turn-end bus rather than a shared
 * prop/context.
 *
 * On a terminal frame: if the room is connected, force-commit it then
 * invalidate the dependencies + preflight reads immediately (deterministic —
 * no waiting on the debounced committer). On a flush error, or when the room
 * isn't connected at all (offline/solo — nothing to force-commit), fall back
 * to the same refetch-on-turn-done + short poll used by
 * `useTurnEndDependencyRefresh` (the accepted residual: the debounced
 * committer recovers within its own quiet period regardless).
 */
export function useTurnEndFlush(
  chatKey: string,
  projectName: string,
  collab: Pick<CollabSpec, "status" | "flush">,
): void {
  const queryClient = useQueryClient();
  // Read at fire-time, not effect-setup time: `collab` is a fresh object each
  // SpecView render (status/flush can change — e.g. connecting → connected —
  // without the chatKey/projectName identity changing), so a plain closure
  // captured at subscribe-time would go stale.
  const collabRef = useRef(collab);
  collabRef.current = collab;
  const cancelPollRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeTurnEnd(chatKey, () => {
      cancelPollRef.current?.();
      cancelPollRef.current = null;
      const current = collabRef.current;
      if (current.status !== "connected") {
        cancelPollRef.current = scheduleFreshnessPoll(queryClient, projectName);
        return;
      }
      current
        .flush()
        .then(() => invalidateDependencyFreshness(queryClient, projectName))
        .catch(() => {
          cancelPollRef.current = scheduleFreshnessPoll(queryClient, projectName);
        });
    });
    return () => {
      unsubscribe();
      cancelPollRef.current?.();
      cancelPollRef.current = null;
    };
  }, [chatKey, projectName, queryClient]);
}
