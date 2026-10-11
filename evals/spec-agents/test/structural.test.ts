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
import { join } from "node:path";
import { FIXTURES_DIR } from "../src/config.js";
import type { SectionRunResult } from "../src/drivers/conversational.js";
import { designChecks } from "../src/scoring/structural.js";
import { newTurnRecord } from "../src/tracing.js";

// The committed design fixture is the reference bundle shape (design.cell root,
// domain-model.md, the prototype, decisions.md, the acceptance tests); every
// deterministic design check must pass on it, otherwise the scorer disagrees
// with the platform's own golden example. The run is one turn that wrote
// nothing and closed on the card, so only the files are judged.
test("designChecks: the lunch-coordinator design fixture passes every deterministic check", async () => {
  const closing = newTurnRecord("design", 1, "/design");
  closing.agentText = "Next on the Design card: check the design files.";
  const run: SectionRunResult = { section: "design", records: [closing], questionsAsked: 0, finishedInterview: true, answers: [] };
  const report = await designChecks(join(FIXTURES_DIR, "lunch-coordinator-design"), run);
  const failed = report.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail ?? ""}`);
  assert.deepEqual(failed, []);
});

