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

import { describe, expect, it } from "vitest";
import { markdownToNode } from "@aep/collab-doc";
import type { DesignReview } from "@aep/agent-stream";
import { docLines } from "../../spec/collab/docLines";
import { designQuestions, featureAsks } from "./questions";

const F2 = { id: "F2", name: "Approvals", path: "specs/requirements/features/F2-approvals.md" };
const F3 = { id: "F3", name: "Payroll export", path: "specs/requirements/features/F3-payroll-export.md" };
const lines = new Map([
  [F2.path, docLines(markdownToNode("# Approvals\n\n## Open Questions\n\n1. Can a manager approve their own claim?\n   - No, Finance approves it.\n2. Refund currency? deferred — the user will decide later\n"))],
  [F3.path, docLines(markdownToNode("# Payroll export\n\n## Open Questions\n\n1. One Xero organisation, or one per country?\n"))],
]);

describe("the questions the design waits on", () => {
  it("asks the open questions of designed features only, leaving out a deferred one", () => {
    expect(featureAsks([F2, F3], { F2: "basis" }, lines)).toEqual([
      {
        kind: "feature",
        key: "F2:Can a manager approve their own claim?",
        question: "Can a manager approve their own claim?",
        options: ["No, Finance approves it."],
        featureId: "F2",
        featureName: "Approvals",
        path: F2.path,
      },
    ]);
  });

  it("puts a comment's question first, with what the comment said", () => {
    const review: DesignReview = {
      version: 1,
      artifacts: [
        {
          path: "specs/design/domain-model.md",
          comments: [
            { id: "c1", author: { id: "u", name: "Sam" }, text: "Show the total.", createdAt: "x", status: "sent", question: "Before or after tax?" },
            { id: "c2", author: { id: "u", name: "Sam" }, text: "Show the date.", createdAt: "x", status: "reopened", question: "Which date?", answer: "Submitted." },
          ],
        },
      ],
    };
    const asks = featureAsks([F2], { F2: "basis" }, lines);
    expect(designQuestions(review, asks).map((q) => q.key)).toEqual(["c1", "F2:Can a manager approve their own claim?"]);
    expect(designQuestions(review, [])[0]).toEqual({
      kind: "comment",
      key: "c1",
      question: "Before or after tax?",
      path: "specs/design/domain-model.md",
      author: "Sam",
      text: "Show the total.",
    });
  });
});
