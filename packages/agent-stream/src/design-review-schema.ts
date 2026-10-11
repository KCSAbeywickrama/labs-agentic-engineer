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
 * Runtime validation for `specs/design/review.json` (`DesignReview` in
 * `./contracts/design-review.ts`, which documents the file and its hash rule;
 * the Zod schema below is drift-guarded against it). The FileBundle calls
 * `checkDesignReview` on every write to the path, so a malformed write by the
 * agent is refused with a self-correctable error. `designReviewSchema` is also
 * the definition the Go gates validate against, published as JSON Schema via
 * `./json-schema.ts`, and what the console validates its own writes with.
 *
 * The schema uses only the keywords the Go interpreter implements. The rules
 * it cannot say are in `checkDesignReview`, and the Go gates apply the same
 * list: artifact paths and comment ids are unique, an addressed comment has a
 * reply, only a prototype's comments carry an anchor, a draft has no question,
 * and an answer answers a question.
 */

import { z } from "zod";
import { MAX_FEEDBACK_ID, MAX_FEEDBACK_TEXT } from "@wso2/prototype-kit/feedback";
import type { DesignReview } from "./contracts/design-review.js";
import type { Equal } from "./type-equal.js";

/** Where the review file lives, repo-relative. */
export const DESIGN_REVIEW_PATH = "specs/design/review.json";

/** An artifact the Design step generates: a file under `specs/design/` or `specs/validation/acceptance/`. */
export const REVIEW_ARTIFACT_PATH_RE = /^specs\/(design|validation\/acceptance)\/[^/].*$/;

/** A prototype artifact, keyed by its manifest: the only artifact whose comments carry an anchor. */
export const PROTOTYPE_ARTIFACT_RE = /^specs\/design\/components\/[^/]+\/prototype\.json$/;

export const reviewCommentStatusSchema = z.enum(["draft", "sent", "addressed", "reopened"]);

const feedbackIdSchema = z.string().min(1).max(MAX_FEEDBACK_ID);

export const reviewAuthorSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
});

export const reviewAnchorSchema = z.strictObject({
  screenId: feedbackIdSchema,
  flowId: feedbackIdSchema.optional(),
  roleId: feedbackIdSchema,
  stateId: feedbackIdSchema,
  elementIds: z.array(feedbackIdSchema),
});

export const reviewCommentSchema = z.strictObject({
  id: z.string().min(1).max(MAX_FEEDBACK_ID),
  author: reviewAuthorSchema,
  text: z.string().max(MAX_FEEDBACK_TEXT).regex(/\S/, "must not be blank"),
  createdAt: z.string().min(1),
  status: reviewCommentStatusSchema,
  sentAt: z.string().min(1).optional(),
  reply: z.string().regex(/\S/, "must not be blank").optional(),
  revision: z.number().int().positive().optional(),
  addressedAt: z.string().min(1).optional(),
  anchor: reviewAnchorSchema.optional(),
  question: z.string().max(MAX_FEEDBACK_TEXT).regex(/\S/, "must not be blank").optional(),
  answer: z.string().max(MAX_FEEDBACK_TEXT).regex(/\S/, "must not be blank").optional(),
});

export const reviewedArtifactSchema = z.strictObject({
  path: z.string().regex(REVIEW_ARTIFACT_PATH_RE, "must be a file under specs/design/ or specs/validation/acceptance/"),
  checkedHash: z.string().regex(/^[0-9a-f]{64}$/, "must be a lowercase hex SHA-256").optional(),
  comments: z.array(reviewCommentSchema).optional(),
});

export const designReviewSchema = z.strictObject({
  version: z.literal(1),
  artifacts: z.array(reviewedArtifactSchema),
});

const _drift: Equal<z.infer<typeof designReviewSchema>, DesignReview> = true;
void _drift;

export interface DesignReviewProblem {
  code: "INVALID_JSON" | "SCHEMA_VIOLATION";
  message: string;
}

/**
 * Validate a candidate review.json body for `path`. Returns null when `path`
 * is not the review file, or the content is valid; otherwise the problem,
 * phrased for the writer's self-correction.
 */
export function checkDesignReview(path: string, content: string): DesignReviewProblem | null {
  if (path !== DESIGN_REVIEW_PATH) return null;
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { code: "INVALID_JSON", message: `${path} is not valid JSON (${msg}). Re-emit the file with the FULL corrected content.` };
  }
  const res = designReviewSchema.safeParse(value);
  if (!res.success) {
    const issues = res.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return { code: "SCHEMA_VIOLATION", message: `${path} violates the DesignReview schema — ${issues}.` };
  }
  const rule = designReviewRuleBroken(res.data);
  return rule === null ? null : { code: "SCHEMA_VIOLATION", message: `${path}: ${rule}` };
}

/** The first rule the schema cannot say that `review` breaks, or null. The Go gates keep the same list. */
function designReviewRuleBroken(review: z.infer<typeof designReviewSchema>): string | null {
  const paths = new Set<string>();
  const ids = new Set<string>();
  for (const [i, artifact] of review.artifacts.entries()) {
    if (paths.has(artifact.path)) {
      return `artifacts[${i}].path: "${artifact.path}" appears more than once — keep one entry per artifact.`;
    }
    paths.add(artifact.path);
    for (const [j, comment] of (artifact.comments ?? []).entries()) {
      const at = `artifacts[${i}].comments[${j}]`;
      if (ids.has(comment.id)) return `${at}.id: "${comment.id}" is already used — comment ids are unique in the file.`;
      ids.add(comment.id);
      if (comment.status === "addressed" && comment.reply === undefined) {
        return `${at}: an addressed comment carries its one-line "reply".`;
      }
      if (comment.anchor !== undefined && !PROTOTYPE_ARTIFACT_RE.test(artifact.path)) {
        return `${at}.anchor: only a prototype's comments (specs/design/components/<component>/prototype.json) carry an anchor.`;
      }
      if (comment.question !== undefined && comment.status === "draft") {
        return `${at}.question: a draft has no question — ask only about a comment that was sent, and leave it "sent".`;
      }
      if (comment.answer !== undefined && comment.question === undefined) {
        return `${at}.answer: an answer goes with the agent's "question" on the same comment.`;
      }
    }
  }
  return null;
}
