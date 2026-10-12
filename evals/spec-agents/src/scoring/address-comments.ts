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
 * The deterministic checks of an Address comments run (`skills/design`,
 * "Addressing comments"), over the spec tree before and after the turn: what
 * became of each comment against the scenario's expectation, which artifacts
 * changed, and the review file's own rules (the platform's validator, and the
 * fields only the user writes).
 */

import { checkDesignReview, DESIGN_REVIEW_PATH, type DesignReview, type ReviewComment } from "@aep/agent-stream";
import type { SectionRunResult } from "../drivers/conversational.js";
import type { CommentExpect } from "../scenario.js";
import { closingProblem, writeLog } from "./design-lineup.js";
import { prototypeProblems, webApplications } from "./prototype-check.js";
import { check, report, type CheckResult, type StructuralReport } from "./structural.js";

/** Every comment in a review, by id, with the artifact path it is on. */
function commentsById(review: DesignReview): Map<string, { path: string; comment: ReviewComment }> {
  return new Map(review.artifacts.flatMap((a) => (a.comments ?? []).map((c) => [c.id, { path: a.path, comment: c }] as const)));
}

/** The revision an Address comments run writes: the highest in the file plus one, or 2 (the first design run is 1). */
export function nextRevision(review: DesignReview): number {
  const revisions = review.artifacts.flatMap((a) => (a.comments ?? []).flatMap((c) => (c.revision ? [c.revision] : [])));
  return revisions.length ? Math.max(...revisions) + 1 : 2;
}

/** The fields only the user (or the console) writes: the agent changes none of them. */
const USER_FIELDS = ["author", "text", "createdAt", "sentAt", "anchor", "answer"] as const;

/** What became of one comment, against what the scenario expects of it; empty when it matches. */
export function commentProblems(
  id: string,
  expect: CommentExpect,
  before: ReviewComment,
  after: ReviewComment | undefined,
  revision: number,
): string[] {
  if (!after) return [`${id}: removed from review.json`];
  const problems: string[] = [];
  const changed = (f: keyof ReviewComment) => JSON.stringify(before[f]) !== JSON.stringify(after[f]);
  // An `ask` may drop a stale answer when it asks again; nothing else of the user's moves.
  const userFields = expect.outcome === "ask" ? USER_FIELDS.filter((f) => f !== "answer") : USER_FIELDS;
  for (const f of userFields) if (changed(f)) problems.push(`${id}: changed ${f}`);
  switch (expect.outcome) {
    case "act":
      if (after.status !== "addressed") problems.push(`${id}: status ${after.status}, expected addressed`);
      if (!after.reply?.trim()) problems.push(`${id}: no reply`);
      if (after.revision !== revision) problems.push(`${id}: revision ${String(after.revision)}, expected ${revision}`);
      if (!after.addressedAt) problems.push(`${id}: no addressedAt`);
      break;
    case "ask":
      if (after.status !== "sent") problems.push(`${id}: status ${after.status}, expected sent (waiting on the question)`);
      if (!after.question?.trim()) problems.push(`${id}: no question`);
      if (after.reply !== before.reply || after.revision !== before.revision) problems.push(`${id}: replied to instead of asked`);
      break;
    case "wait":
      if (JSON.stringify(before) !== JSON.stringify(after)) problems.push(`${id}: changed, but it was not the agent's to act on`);
      break;
  }
  return problems;
}

/** The paths whose text differs between the two trees (added and removed included). */
export function changedPaths(before: Record<string, string>, after: Record<string, string>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((p) => before[p] !== after[p]).sort();
}

/**
 * `before`/`after` are the spec trees around the turn (`readSpecTree`);
 * `expect` is the scenario's outcome per comment id.
 */
export async function addressCommentsChecks(
  projectDir: string,
  run: SectionRunResult,
  before: Record<string, string>,
  after: Record<string, string>,
  expect: Record<string, CommentExpect>,
): Promise<StructuralReport> {
  const reviewText = after[DESIGN_REVIEW_PATH] ?? "";
  const reviewProblem = reviewText ? checkDesignReview(DESIGN_REVIEW_PATH, reviewText) : { message: "review.json missing" };
  const reviewBefore = JSON.parse(before[DESIGN_REVIEW_PATH] ?? '{"version":1,"artifacts":[]}') as DesignReview;
  const reviewAfter = reviewProblem === null ? (JSON.parse(reviewText) as DesignReview) : null;
  const revision = nextRevision(reviewBefore);

  const beforeComments = commentsById(reviewBefore);
  const afterComments = reviewAfter ? commentsById(reviewAfter) : new Map<string, { path: string; comment: ReviewComment }>();
  const outcomes: CheckResult[] = [];
  for (const [id, exp] of Object.entries(expect)) {
    const was = beforeComments.get(id);
    if (!was) continue;
    const problems = commentProblems(id, exp, was.comment, afterComments.get(id)?.comment, revision);
    outcomes.push(check(`comment ${id} ${exp.outcome === "act" ? "addressed" : exp.outcome === "ask" ? "asked about" : "left as it was"}`, problems.length === 0, problems.join("; ")));
  }
  const added = [...afterComments.keys()].filter((id) => !beforeComments.has(id));

  const changed = new Set(changedPaths(before, after));
  const startProblems: string[] = [];
  const reachProblems: string[] = [];
  for (const [id, exp] of Object.entries(expect)) {
    if (exp.outcome !== "act") continue;
    if (!exp.earliest.some((p) => changed.has(p))) startProblems.push(`${id}: none of ${exp.earliest.join(", ")} changed`);
    const missed = exp.changes.filter((p) => !changed.has(p));
    if (missed.length > 0) reachProblems.push(`${id}: ${missed.join(", ")} unchanged`);
  }

  const components = [...new Set(Object.keys(after).flatMap((p) => /^specs\/design\/components\/([^/]+)\//.exec(p)?.[1] ?? []))];
  const prototypes = await prototypeProblems(projectDir, webApplications(projectDir, components));

  // review.json is the turn's last write: each reply tells what the artifacts now say.
  const writes = writeLog(run.records);
  const lastWrite = writes.at(-1);
  const closing = closingProblem(run.records);

  return report([
    check("review.json passes the platform's validator", reviewProblem === null, reviewProblem?.message),
    ...outcomes,
    check("no comment added or removed", added.length === 0, `added: ${added.join(", ")}`),
    check("each acted-on comment's change starts at its earliest artifact", startProblems.length === 0, startProblems.join("; ")),
    check("each acted-on comment's change reaches every artifact it needs", reachProblems.length === 0, reachProblems.join("; ")),
    check("every web application's prototype still passes the kit check", prototypes.length === 0, prototypes.join("; ")),
    check(
      "review.json is the last file written",
      lastWrite === DESIGN_REVIEW_PATH,
      writes.includes(DESIGN_REVIEW_PATH) ? `last write: ${String(lastWrite)}` : "review.json never written",
    ),
    check(
      "no form question asked",
      run.questionsAsked === 0,
      `${run.questionsAsked} question(s) asked: ${run.records.flatMap((r) => r.questions).slice(0, 3).join(" | ")}`,
    ),
    check("the closing names the next step on the Design card", closing === null, closing ?? undefined),
    check("turn completed", run.finishedInterview, run.error ?? "hit the turn cap"),
  ]);
}
