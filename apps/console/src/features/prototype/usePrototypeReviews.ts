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

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { AppPrototype } from "./model/prototypes";
import { createReviewStore, followAll } from "./model/reviewStore";
import { NEW_SESSION, type ReviewSession } from "./model/revision";

/** The app's one review store: each project's prototype reviews, outliving the Design card. */
const reviewStore = createReviewStore();

export interface PrototypeReviews {
  /** The review of `component`: the revision to show, what to say of the last one, and what this browser keeps of its comments. */
  session: (component: string) => ReviewSession;
  change: (component: string, fn: (s: ReviewSession) => ReviewSession) => void;
  /** The notice was seen (the toast closed). */
  onNoticeSeen: (component: string) => void;
}

/**
 * The project's prototype reviews (the review store), following the
 * prototypes as the caller has them: in the render that sees them, so a
 * revision that lands is never drawn half-followed, and into the store once
 * drawn.
 */
export function usePrototypeReviews(projectName: string, prototypes: readonly AppPrototype[]): PrototypeReviews {
  const subscribe = useCallback((fn: () => void) => reviewStore.subscribe(projectName, fn), [projectName]);
  const sessions = useSyncExternalStore(subscribe, () => reviewStore.get(projectName));
  const followed = followAll(sessions, prototypes);
  useEffect(() => {
    reviewStore.follow(projectName, prototypes);
  }, [projectName, prototypes]);

  const change = (component: string, fn: (s: ReviewSession) => ReviewSession) => reviewStore.change(projectName, component, fn);
  return {
    session: (component) => followed[component] ?? NEW_SESSION,
    change,
    onNoticeSeen: (component) => change(component, (s) => ({ ...s, notice: null })),
  };
}
