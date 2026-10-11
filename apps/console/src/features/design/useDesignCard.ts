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
import type { ReviewComment } from "@aep/agent-stream";
import { useProjectChat } from "../agent-chat/useProjectChat";
import { appPrototypes, revisingIn, type AppPrototype } from "../prototype/model/prototypes";
import { usePrototypeReviews, type PrototypeReviews } from "../prototype/usePrototypeReviews";
import { useSpecDoc } from "../spec/collab/specDoc";
import { useRoomFiles } from "../spec/collab/useRoomFiles";
import type { DesignDependency } from "./api/designModel";
import { blockingDependencies } from "./model/artifacts";
import { artifactHashes, designItems, DESIGN_FILE_PREFIXES, reviewLists, type DesignItem, type ReviewList } from "./model/designFiles";
import { changedSinceChecked, commentsOn, isChecked, isWaiting, primaryAction, waitingComments, type Primary } from "./model/review";
import { useDesignModel } from "./useDesignModel";
import { useDesignReview, type DesignReviewActions } from "./useDesignReview";

// Everything the Design card shows, worked out once for the header and the
// body: the rail's items from the room's files (model/designFiles.ts), each
// one's hash, the review (review.json), the web applications' prototypes, the
// dependencies that block a build, and the one primary action.

/** One row of an Overview review list. */
export interface ReviewRow {
  item: DesignItem;
  checked: boolean;
  changed: boolean;
  /** Comments on it waiting to be sent. */
  waiting: number;
}

export interface DesignCard {
  items: DesignItem[];
  hashes: Readonly<Record<string, string>>;
  review: DesignReviewActions;
  lists: Record<ReviewList, ReviewRow[]>;
  waiting: ReviewComment[];
  primary: Primary;
  /** Each web application's prototype, by component. */
  prototypes: ReadonlyMap<string, AppPrototype>;
  reviews: PrototypeReviews;
  /** The dependencies that wait on a person before their feature builds. */
  blocking: DesignDependency[];
}

const NO_PROTOTYPES: AppPrototype[] = [];

export function useDesignCard(projectName: string): DesignCard {
  const files = useRoomFiles(useSpecDoc(projectName), DESIGN_FILE_PREFIXES);
  const review = useDesignReview(projectName);
  const model = useDesignModel(projectName).data;
  const chat = useProjectChat(projectName);
  const items = useMemo(() => designItems(files), [files]);
  const hashes = useMemo(() => artifactHashes(items), [items]);

  // A design run (Design, or Address comments) may rewrite a prototype: it is revising until the run ends.
  const instruction = chat.turn.phase === "idle" ? undefined : chat.turn.instruction;
  const designRunning = model?.running != null;
  const webApps = useMemo(() => items.flatMap((i) => (i.body.kind === "prototype" ? [i.body.component] : [])), [items]);
  const list = useMemo(
    () => (webApps.length > 0 ? appPrototypes(webApps, files, designRunning ? { component: null } : revisingIn(instruction)) : NO_PROTOTYPES),
    [webApps, files, designRunning, instruction],
  );
  const reviews = usePrototypeReviews(projectName, list);

  const card = useMemo(() => {
    const row = (item: DesignItem): ReviewRow => ({
      item,
      checked: isChecked(review.review, item.path, hashes[item.path]),
      changed: changedSinceChecked(review.review, item.path, hashes[item.path]),
      waiting: commentsOn(review.review, item.path).filter(isWaiting).length,
    });
    const byList = reviewLists(items);
    const lists = { business: byList.business.map(row), technical: byList.technical.map(row) };
    const waiting = waitingComments(review.review);
    const rows = [...lists.business, ...lists.technical].map((r) => ({ key: r.item.key, checked: r.checked }));
    return {
      items,
      hashes,
      review,
      lists,
      waiting,
      primary: primaryAction({ waiting: waiting.length, rows }),
      prototypes: new Map(list.map((p) => [p.component, p])),
      blocking: blockingDependencies(model?.dependencies ?? []),
    };
  }, [items, hashes, review, list, model?.dependencies]);
  return { ...card, reviews };
}
