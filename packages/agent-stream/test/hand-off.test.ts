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

import { test } from "node:test";
import assert from "node:assert/strict";
import { AREAS, areaCommand, areaLabel, HAND_OFF_TOOL, isAreaId, isHandOffTool } from "../src/contracts/sse-events.js";

test("one hand-off tool, recognised by name", () => {
  assert.equal(HAND_OFF_TOOL, "hand_off");
  assert.equal(isHandOffTool("hand_off"), true);
  assert.equal(isHandOffTool("hand_off_to_issues"), false);
  assert.equal(isHandOffTool("ask_question"), false);
  assert.equal(isHandOffTool(undefined), false);
});

test("the areas: Issues, by id and label, reached by its /issue command", () => {
  assert.deepEqual(AREAS, [{ id: "issues", label: "Issues", command: "/issue" }]);
  assert.equal(areaLabel("issues"), "Issues");
  assert.equal(areaCommand("issues"), "/issue");
});

test("an issue's own thread is not an area: it is the Issues area's focus", () => {
  assert.equal(isAreaId("issues"), true);
  assert.equal(isAreaId("issue"), false);
  assert.equal(isAreaId(undefined), false);
  // No area's name is mistaken for the hand-off tool.
  for (const area of AREAS) assert.equal(isHandOffTool(area.id), false, area.id);
});
