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
 * The Issues chats' know-how lives in the platform skills `issue-triage` and
 * `issue-work` (repo `skills/`), inlined into each scope's prompt. These
 * check the procedure the prompt carries once assembled with the repo's own
 * skills: what the hand-written prompts used to say.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildSubAgentInstructions } from "../src/areas/prompt.js";
import { scopeFor } from "../src/areas/profiles.js";
import { loadSkillsFromSnapshot } from "../src/conversation/load-workspace.js";
import { TOOLS } from "../src/tools/registry.js";

const skills = loadSkillsFromSnapshot(fileURLToPath(new URL("../../../../../../", import.meta.url)));
const flat = (s: string): string => s.replace(/\s+/g, " ");
const ISSUES = flat(buildSubAgentInstructions(scopeFor("issues"), { skills }));
const ISSUE = flat(buildSubAgentInstructions(scopeFor("issues", { kind: "issue", id: 42 }), { skills }));

test("Issues: classify, then a question is answered, an unclear kind is asked, and unknown means ask", () => {
  for (const needle of ["classify_report", "search_issues", "create_issue", "recentMessages"]) {
    assert.ok(ISSUES.includes(needle), `mentions ${needle}`);
  }
  const question = ISSUES.indexOf('the kind is "question"');
  const clarify = ISSUES.indexOf("`needsClarification` is true");
  assert.ok(question > 0 && clarify > question, "a question is handled before the clarification rule");
  assert.match(ISSUES, /"unknown"/);
  assert.match(ISSUES, /could not tell/);
  assert.match(ISSUES, /never mention the classifier/i);
});

test("Issues: search for a duplicate, draft, ask the filing confirmation, then file exactly what it showed", () => {
  const search = ISSUES.indexOf("Call `search_issues`");
  const draft = ISSUES.indexOf("Draft the issue");
  const confirm = ISSUES.indexOf("Ask the filing confirmation");
  assert.ok(search > 0 && draft > search && confirm > draft);
  assert.match(ISSUES, /exactly the title, kind and body that the confirmation showed/);
  assert.match(ISSUES, /#N and its link/);
  assert.match(ISSUES, /cannot be reached right now/);
});

test("Issues: /issue is a decision to file — classify without the prefix, ask what is missing in one batch", () => {
  assert.ok(ISSUES.includes("The /issue command"));
  assert.ok(ISSUES.includes('"What should the issue be about?"'));
  assert.match(ISSUES, /at most 4/);
  assert.match(ISSUES, /without the `\/issue` prefix/);
  assert.match(ISSUES, /never take the question branch/i);
  assert.match(ISSUES, /Never put the filing confirmation in the batch/);
  assert.match(ISSUES, /do this section from the classify step \(including the batch\)/);
  assert.match(ISSUES, /each question except the kind question/i);
  assert.match(ISSUES, /then the questions common to all kinds \(the need and the outcome\)/);
  // Filing is still the single ask_question, generated once from the registry.
  assert.equal(ISSUES.split(`ask "${TOOLS.create_issue!.confirm!.question}"`).length, 2);
});

test("Issues › #42: read the issue first, pick the component before the hand-off, relay deploy-first", () => {
  assert.match(ISSUE, /issue #42/);
  assert.match(ISSUE, /call `get_issue`/);
  const list = ISSUE.indexOf("Call `list_components`");
  const confirm = ISSUE.indexOf("Then ask the hand-off confirmation");
  assert.ok(list > 0 && confirm > list, "the component question comes before the hand-off confirmation");
  assert.ok(ISSUE.includes('"Which component should the coding agent work in?"'));
  assert.match(ISSUE, /deploy a version first/i);
  for (const absent of ["create_issue", "search_issues", "classify_report", "addFile"]) {
    assert.equal(ISSUE.includes(absent), false, absent);
  }
});
