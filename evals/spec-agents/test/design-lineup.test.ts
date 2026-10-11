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

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { closingProblem, decisionsProblems, gapCheckProblems, lineupOrderProblem } from "../src/scoring/design-lineup.js";
import { newTurnRecord, type TurnRecord } from "../src/tracing.js";

/** One turn that wrote `paths` in order and closed with `text`. */
function turn(paths: string[], text = ""): TurnRecord {
  const rec = newTurnRecord("design", 1, "/design");
  rec.toolCalls = paths.map((path) => ({ toolName: "addFile", input: { path, content: "x" } }));
  rec.agentText = text;
  return rec;
}

const LINEUP = [
  "specs/design/design.cell",
  "specs/design/domain-model.md",
  "specs/design/security.json",
  "specs/design/components/web/prototype.json",
  "specs/design/components/web/prototype.tsx",
  "specs/design/components/api/openapi.yaml",
  "specs/validation/acceptance/F1-claims.feature",
];

test("lineupOrderProblem: the skill's order passes, and a later fix of an earlier artifact is no fault", () => {
  assert.equal(lineupOrderProblem([turn([...LINEUP, "specs/design/security.json"])]), null);
});

test("lineupOrderProblem: a contract before the prototype is named", () => {
  const order = [...LINEUP];
  order.splice(3, 0, order.splice(5, 1)[0]!);
  assert.match(lineupOrderProblem([turn(order)]) ?? "", /openapi\.yaml \(openapi\.yaml\) was first written before .*prototype/);
});

test("lineupOrderProblem: an acceptance test before a component artifact is named", () => {
  const order = [LINEUP[6]!, ...LINEUP.slice(0, 6)];
  assert.match(lineupOrderProblem([turn(order)]) ?? "", /F1-claims\.feature \(acceptance tests\)/);
});

test("lineupOrderProblem: a dependency's contract written with the architecture is named; its definition is not", () => {
  const order = [
    "specs/design/design.cell",
    "specs/design/dependencies/slack/dependency.json",
    "specs/design/dependencies/slack/openapi.yaml",
    ...LINEUP.slice(1),
  ];
  assert.match(lineupOrderProblem([turn(order)]) ?? "", /^specs\/design\/dependencies\/slack\/openapi\.yaml .* before specs\/design\/domain-model\.md/);
  const inOrder = [...LINEUP.slice(0, 6), "specs/design/dependencies/slack/openapi.yaml", "specs/design/flows/claim.md", LINEUP[6]!];
  assert.equal(lineupOrderProblem([turn(["specs/design/dependencies/slack/dependency.json", ...inOrder])]), null);
});

test("decisionsProblems: tagged lines naming their features pass", () => {
  const md = [
    "# Technical decisions",
    "",
    "- [architecture] Receipts are kept in object storage. *assumed* (F1)",
    "- [expense-api] A list returns 50 claims per page. *assumed* (F1, F2)",
    "- [data-model] Amounts are stored in cents. (all)",
  ].join("\n");
  assert.deepEqual(decisionsProblems(md, ["expense-api", "expense-web"]), []);
});

test("decisionsProblems: an untagged line, an unknown tag and a line with no features are named", () => {
  const md = [
    "- Amounts are stored in cents. *assumed* (F1)",
    "- [database] Postgres. *assumed* (F1)",
    "- [security] Managers read the team's claims. *assumed*",
  ].join("\n");
  const problems = decisionsProblems(md, ["expense-api"]);
  assert.equal(problems.length, 3);
  assert.match(problems[1]!, /\[database\] is neither/);
});

test("decisionsProblems: a missing file is one problem", () => {
  assert.deepEqual(decisionsProblems("", []), ["specs/design/decisions.md missing or empty"]);
});

const FEATURE = ["# F1 Claims", "", "## Decisions", "- A claim has one currency.", "", "## Open Questions", "1. Which currency?", ""].join("\n");

test("gapCheckProblems: an *assumed* decision and an open question may be added; an answered question may go", () => {
  const after = FEATURE.replace("- A claim has one currency.", "- A claim has one currency.\n- Finance sets each manager. *assumed*")
    .replace("1. Which currency?", "1. Who approves a manager's own claim?");
  assert.deepEqual(gapCheckProblems({ "f.md": FEATURE }, { "f.md": after }), []);
});

test("gapCheckProblems: an untagged decision and a reworded requirement are named", () => {
  const after = FEATURE.replace("- A claim has one currency.", "- A claim has one currency, the company's.\n- Finance sets each manager.");
  const problems = gapCheckProblems({ "f.md": FEATURE }, { "f.md": after });
  assert.equal(problems.length, 3);
  assert.ok(problems.some((p) => /removed or reworded: - A claim has one currency\.$/.test(p)));
});

test("closingProblem: a closing that names the next step on the Design card passes", () => {
  const text = "expense-web — web app\n\n2 questions for you on the Design card.\n\nNext on the Design card: answer 2 questions, then check the 9 files.";
  assert.equal(closingProblem([turn([], text)]), null);
});

test("closingProblem: a Questions for you block in the chat is named", () => {
  const text = "**Questions for you**\n1. Which currency?\n\nNext on the Design card: answer 1 question.";
  assert.match(closingProblem([turn([], text)]) ?? "", /Questions for you/);
});

test("closingProblem: a closing that never points at the card is named", () => {
  assert.match(closingProblem([turn([], "Design complete. Run /build next.")]) ?? "", /Design card/);
});
