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
import { bandFor, combineScore, sectionVerdict } from "../src/scoring/bands.js";

test("bands: pass ≥75, review 50–75, fail <50", () => {
  assert.equal(bandFor(75, false).band, "pass");
  assert.equal(bandFor(74, false).band, "review");
  assert.equal(bandFor(50, false).band, "review");
  assert.equal(bandFor(49, false).band, "fail");
  assert.equal(bandFor(0, false).band, "fail");
});

test("mustNot violation demotes a pass to review (forced), never upgrades", () => {
  assert.deepEqual(bandFor(90, true), { band: "review", forcedReview: true });
  assert.deepEqual(bandFor(60, true), { band: "review", forcedReview: false });
  assert.deepEqual(bandFor(30, true), { band: "fail", forcedReview: false });
});

test("combined score is the mean of structural and judge; structural-only without a judge", () => {
  assert.equal(combineScore(1, 0.5), 75);
  assert.equal(combineScore(0.8, null), 80);
  assert.equal(combineScore(0, 0), 0);
});

test("sectionVerdict composes score and band", () => {
  const v = sectionVerdict("requirements", 1, 0.5, false);
  assert.equal(v.score, 75);
  assert.equal(v.band, "pass");
  const demoted = sectionVerdict("design", 1, 1, true);
  assert.equal(demoted.band, "review");
  assert.equal(demoted.forcedReview, true);
});
