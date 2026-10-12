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

import { useMemo } from "react";
import { prototypeHash } from "@wso2/prototype-kit/feedback";
import type { QueueUpdate } from "@wso2/prototype-kit/host";
import type { DesignReviewActions } from "../../design/useDesignReview";
import { manifestPath, type AppPrototype } from "../model/prototypes";
import { queueOf, withQueue, type Placed } from "../model/reviewDrafts";
import type { PrototypeReviews } from "../usePrototypeReviews";
import { PrototypeReview } from "./PrototypeReview";

/**
 * The full-screen review of one prototype (#891), opened from its rail item
 * on the Design card, with its comment queue kept in review.json: each
 * queued comment is the reviewer's Pending draft on the prototype, with the
 * screen and elements it was made on (model/reviewDrafts.ts).
 */
export function PrototypeReviewHost({
  prototype,
  review,
  reviews,
  onWhatChanged,
  onClose,
}: {
  prototype: AppPrototype;
  review: DesignReviewActions;
  reviews: PrototypeReviews;
  /** Read what the agent did: the chat, with the review closed. */
  onWhatChanged: () => void;
  onClose: () => void;
}) {
  const { component } = prototype;
  const session = reviews.session(component);
  const path = manifestPath(component);
  const shown = session.shown;
  const hash = useMemo(() => (shown ? prototypeHash(shown.manifestText, shown.source) : ""), [shown]);
  const queue = useMemo(
    () => queueOf(review.review, path, review.me.id, hash, session.placed, session.drafts),
    [review.review, path, review.me.id, hash, session.placed, session.drafts],
  );
  const onQueue = (update: QueueUpdate) => {
    const next = update(queue);
    // The kit hands back a new list of drafts even when none changed; only a change is kept.
    const draftsChanged = next.drafts.length !== queue.drafts.length || next.drafts.some((d, i) => d !== queue.drafts[i]);
    if (draftsChanged) reviews.change(component, (s) => ({ ...s, drafts: next.drafts }));
    if (next.requests === queue.requests) return;
    let made: Placed = {};
    review.change((current, draft) => {
      const out = withQueue(current, path, queue.requests, next.requests, draft);
      made = out.made;
      return out.review;
    });
    if (Object.keys(made).length > 0) reviews.change(component, (s) => ({ ...s, placed: { ...s.placed, ...made } }));
  };
  return (
    <PrototypeReview
      prototype={prototype}
      session={session}
      queue={queue}
      onQueue={onQueue}
      onNoticeSeen={() => reviews.onNoticeSeen(component)}
      onWhatChanged={() => {
        reviews.onNoticeSeen(component);
        onWhatChanged();
      }}
      onClose={onClose}
    />
  );
}
