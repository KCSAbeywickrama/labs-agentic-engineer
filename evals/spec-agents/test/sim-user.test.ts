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
import type { AskQuestionInput } from "@aep/agent-stream";
import { decisionsDigest, fatigueTier, salvage, type SimAnswer } from "../src/sim-user.js";

test("fatigue tiers: engaged → terse → defers (#354)", () => {
  assert.equal(fatigueTier(0), "fresh");
  assert.equal(fatigueTier(6), "fresh");
  assert.equal(fatigueTier(7), "tiring");
  assert.equal(fatigueTier(11), "tiring");
  assert.equal(fatigueTier(12), "tired");
  assert.equal(fatigueTier(30), "tired");
});

const QUESTIONS: AskQuestionInput[] = [
  { question: "Who can open?", options: [{ label: "Anyone" }, { label: "Admins only" }] },
  { question: "Auth?", options: [{ label: "Google SSO" }, { label: "None" }] },
];

test("salvage: keeps valid labels, demotes invalid picks to freeText, defaults source", () => {
  const raw = JSON.stringify([
    { question: "Who can open?", selected: ["Anyone"], source: "fact", volunteered: [] },
    { question: "Auth?", selected: ["Slack login"], freeText: "we use Google", volunteered: [] },
  ]);
  const answers = salvage(QUESTIONS, raw);
  assert.deepEqual(answers[0]!.selected, ["Anyone"]);
  assert.equal(answers[0]!.source, "fact");
  assert.deepEqual(answers[1]!.selected, []);
  assert.match(answers[1]!.freeText ?? "", /we use Google/);
  assert.match(answers[1]!.freeText ?? "", /Slack login/);
  assert.equal(answers[1]!.source, "persona-fallback");
});

test("salvage: unparseable sim output degrades to empty answers, one per question", () => {
  const answers = salvage(QUESTIONS, "sorry, as an AI …");
  assert.equal(answers.length, 2);
  assert.deepEqual(answers[0]!.selected, []);
});

test("decisionsDigest lists improvised decisions and volunteered facts only", () => {
  const answers: SimAnswer[] = [
    { question: "Q1", selected: ["A"], source: "fact", volunteered: [] },
    { question: "Q2", selected: ["B"], freeText: "note", source: "improvised", volunteered: [] },
    { question: "Q3", selected: ["C"], source: "fact", volunteered: ["Slack pings at cutoff"] },
  ];
  const digest = decisionsDigest(answers);
  assert.match(digest, /Q2/);
  assert.match(digest, /Slack pings at cutoff/);
  assert.doesNotMatch(digest, /Q1/);
  assert.equal(decisionsDigest([answers[0]!]), "");
});
