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
import { loadScenarios, rubricSchema } from "../src/scenario.js";

test("rubric: plain strings normalize to weight 1; explicit weights survive", () => {
  const rubric = rubricSchema.parse({
    mustCover: ["a prose item long enough", { item: "a weighted item here", weight: 2 }],
  });
  assert.equal(rubric.mustCover[0]!.weight, 1);
  assert.equal(rubric.mustCover[1]!.weight, 2);
  assert.deepEqual(rubric.mustNot, []);
});

test("rubric: rejects empty mustCover", () => {
  assert.throws(() => rubricSchema.parse({ mustCover: [] }));
});

test("committed scenarios all validate against their schemas", () => {
  // Throws on any invalid YAML — the committed dataset must always load.
  const requirements = loadScenarios("requirements");
  const chains = loadScenarios("chains");
  assert.ok(requirements.length >= 1, "at least one requirements scenario");
  assert.ok(chains.length >= 1, "at least one chain scenario");
  for (const sc of requirements) assert.ok(sc.rubric.mustCover.length > 0);
  // Design + tasks scenarios exist once their fixtures are captured; loading
  // must not throw either way.
  loadScenarios("design");
  loadScenarios("tasks");
});
