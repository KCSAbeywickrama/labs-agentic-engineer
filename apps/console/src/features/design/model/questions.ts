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

import type { DesignReview } from "@aep/agent-stream";
import type { SpecFeature } from "../../spec/api/specModel";
import type { LineBlock } from "../../spec/model/ids";
import { openQuestions } from "../../spec/model/questions";
import { commentQuestions } from "./review";

// The questions the design waits on the user for (D01: ready means nothing
// waits on the user), stored where their answers go rather than said once in
// the chat:
//
//  - a designed feature's open questions, in its file's Open Questions (the
//    gap check writes one for a call only the user can make). The answer is
//    an edit of the file: the entry leaves, the answer lands in Decisions
//    (spec/collab/specEdits.ts `answerOpenQuestion`), so the feature's design
//    is out of date and the next Design takes the answer;
//  - the agent's question on an ambiguous review comment, which it left sent
//    (`question` in review.json). The answer reopens the comment, so the next
//    Address comments sends it.
//
// The Design card asks them all in one place ("Answer 2 questions").

/** A question on a review comment. */
export interface CommentAsk {
  kind: "comment";
  /** The comment's id. */
  key: string;
  question: string;
  /** The artifact the comment is on, by its review path. */
  path: string;
  /** Who wrote the comment, and what it said. */
  author: string;
  text: string;
}

/** An open question in a designed feature's file. */
export interface FeatureAsk {
  kind: "feature";
  /** The feature and the question's words. */
  key: string;
  question: string;
  /** The answers the agent offers, each worded as the decision it becomes. */
  options: string[];
  featureId: string;
  featureName: string;
  /** The feature's file, which the answer edits. */
  path: string;
}

export type DesignQuestion = CommentAsk | FeatureAsk;

/** Every open question in the files of the features a design run has designed, feature by feature. */
export function featureAsks(
  features: readonly Pick<SpecFeature, "id" | "name" | "path">[],
  designedFrom: Readonly<Record<string, string>>,
  lines: ReadonlyMap<string, LineBlock[]>,
): FeatureAsk[] {
  return features.flatMap((f) =>
    designedFrom[f.id] === undefined
      ? []
      : openQuestions(lines.get(f.path) ?? []).map(({ question, options }) => ({
          kind: "feature" as const,
          key: `${f.id}:${question}`,
          question,
          options,
          featureId: f.id,
          featureName: f.name,
          path: f.path,
        })),
  );
}

/** Every question waiting on the user: the review comments' first (they hold up Address comments), then the features'. */
export function designQuestions(review: DesignReview, features: readonly FeatureAsk[]): DesignQuestion[] {
  const comments = commentQuestions(review).map(
    ({ path, comment }): CommentAsk => ({ kind: "comment", key: comment.id, question: comment.question, path, author: comment.author.name, text: comment.text }),
  );
  return [...comments, ...features];
}
