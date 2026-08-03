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
 * The `/<skill>` chat-composer shortcut (shared `@aep/contracts/prompts`
 * helper). One pure text→text function backs both the console composer and the
 * playground chat surfaces, so its grammar is pinned here: what expands to a
 * "load the skill and follow it" instruction, and what stays literal chat.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { slashSkillInstruction } from "@aep/contracts/prompts";

// --- expands ----------------------------------------------------------------

test("bare /<skill> → just the load directive", () => {
  assert.equal(slashSkillInstruction("/spec"), "Load the spec skill and follow it.");
  assert.equal(slashSkillInstruction("/design"), "Load the design skill and follow it.");
});

test("/<skill> with follow-up text rides after a blank line", () => {
  assert.equal(
    slashSkillInstruction("/spec an expense tracker"),
    "Load the spec skill and follow it.\n\nan expense tracker",
  );
});

test("kebab-case skill tokens are allowed", () => {
  assert.equal(
    slashSkillInstruction("/high-level-architecture redo the edges"),
    "Load the high-level-architecture skill and follow it.\n\nredo the edges",
  );
});

test("surrounding + inner whitespace is normalized", () => {
  assert.equal(slashSkillInstruction("  /spec   an app  "), "Load the spec skill and follow it.\n\nan app");
});

test("multi-line follow-up text is preserved", () => {
  assert.equal(
    slashSkillInstruction("/spec line one\nline two"),
    "Load the spec skill and follow it.\n\nline one\nline two",
  );
});

// --- stays literal (returns null) -------------------------------------------

test("a plain chat line is not a command", () => {
  assert.equal(slashSkillInstruction("please regenerate the design"), null);
});

test("a mid-message slash is literal", () => {
  assert.equal(slashSkillInstruction("fix the /spec route please"), null);
});

test("a bare slash is literal", () => {
  assert.equal(slashSkillInstruction("/"), null);
  assert.equal(slashSkillInstruction("/ spec"), null);
});

test("a doubled slash escapes expansion", () => {
  assert.equal(slashSkillInstruction("//spec"), null);
});

test("a trailing-punctuation token is literal (token must end at whitespace/EOL)", () => {
  assert.equal(slashSkillInstruction("/spec."), null);
  assert.equal(slashSkillInstruction("/design?"), null);
});

test("uppercase tokens do not match the lowercase skill charset", () => {
  assert.equal(slashSkillInstruction("/SPEC"), null);
});

test("empty / whitespace-only input is literal", () => {
  assert.equal(slashSkillInstruction(""), null);
  assert.equal(slashSkillInstruction("   "), null);
});

