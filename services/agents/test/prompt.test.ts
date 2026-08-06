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
import { testSkillSource, type TestSkill } from "./skill-source.js";
import {
  instructions,
  taskPlanInstructions,
  buildInstructions,
  buildTaskPlanInstructions,
  buildSkillCatalog,
  buildEagerSkillsBlock,
  buildOrgDefaultsBlock,
} from "../src/agents/main/prompt.js";

const SKILL_LIST: TestSkill[] = [
  { name: "a-skill", description: "does A", content: "BODY A — secret guidance" },
  { name: "b-skill", description: "does B", content: "BODY B — secret guidance" },
];
const SKILLS = testSkillSource(SKILL_LIST);

test("no skills → catalog is empty and instructions are byte-identical to base", () => {
  assert.equal(buildSkillCatalog(undefined), "");
  assert.equal(buildSkillCatalog(testSkillSource([])), "");
  assert.equal(buildInstructions(), instructions);
  assert.equal(buildInstructions(testSkillSource([])), instructions);
});

test("catalog lists name+description, appended at the END (base prefix preserved)", () => {
  const out = buildInstructions(SKILLS);
  assert.ok(out.startsWith(instructions), "base instructions stay the cacheable prefix");
  assert.match(out, /# Skills/);
  assert.match(out, /- a-skill: does A/);
  assert.match(out, /- b-skill: does B/);
  assert.match(out, /loadSkill/);
});

test("catalog NEVER inlines skill bodies (progressive disclosure)", () => {
  const out = buildInstructions(SKILLS);
  assert.doesNotMatch(out, /BODY A/);
  assert.doesNotMatch(out, /secret guidance/);
});

test("catalog mentions loadSkillReference only when a skill carries references", () => {
  const withRefs = testSkillSource([
    ...SKILL_LIST,
    {
      name: "c-skill",
      description: "does C",
      content: "see references/deep.md",
      references: { "references/deep.md": "REF BODY — never inlined" },
    },
  ]);
  const out = buildInstructions(withRefs);
  assert.match(out, /loadSkillReference/);
  assert.doesNotMatch(out, /REF BODY/); // reference bodies are third-level, never in the prompt
  assert.doesNotMatch(buildInstructions(SKILLS), /loadSkillReference/); // refs-free library = today's catalog
});

test("eager skills inline resolved bodies into a per-turn block (#335)", () => {
  const block = buildEagerSkillsBlock(SKILLS, ["a-skill"]);
  assert.match(block, /ALREADY LOADED/);
  assert.match(block, /## Skill: a-skill/);
  assert.match(block, /BODY A — secret guidance/);
  assert.doesNotMatch(block, /BODY B/);
});

test("eager skills: unknown names skip; nothing resolved → empty string", () => {
  assert.equal(buildEagerSkillsBlock(SKILLS, ["nope"]), "");
  assert.equal(buildEagerSkillsBlock(SKILLS, []), "");
  assert.equal(buildEagerSkillsBlock(SKILLS, undefined), "");
  assert.equal(buildEagerSkillsBlock(undefined, ["a-skill"]), "");
  const mixed = buildEagerSkillsBlock(SKILLS, ["nope", "b-skill"]);
  assert.match(mixed, /## Skill: b-skill/);
  assert.doesNotMatch(mixed, /nope/);
});

test("eager skills never touch the SYSTEM instructions (cacheable prefix)", () => {
  assert.equal(buildInstructions(SKILLS), instructions + buildSkillCatalog(SKILLS));
});

// --- Organization defaults --------------------------------------------------
//
// The org's standing decisions ride the SYSTEM prompt of every turn rather than
// a per-flow eager block: they answer interview questions the agent would
// otherwise put to the user, and pin providers at design time, on every turn
// regardless of flow.

const ORG: TestSkill = {
  name: "organization",
  description: "The organization's settled decisions.",
  content: "## Authentication & identity\n\nUse Thunder.",
};

test("the org defaults are inlined into the system prompt, body and all", () => {
  const out = buildInstructions(testSkillSource([...SKILL_LIST, ORG]));
  assert.match(out, /# Organization defaults/);
  assert.match(out, /Use Thunder\./, "the BODY is inlined — unlike every other skill");
});

test("the org skill is never catalogued — its body is already in the prompt", () => {
  const skills = testSkillSource([...SKILL_LIST, ORG]);
  // A catalog line would offer a loadSkill round-trip returning text the agent
  // is already holding, and charge for the description a second time.
  assert.ok(!buildSkillCatalog(skills).includes("organization"));
  // Its heading is the composer's alone, so it appears exactly once.
  assert.equal(buildInstructions(skills).match(/# Organization defaults/g)?.length, 1);
});

test("a library of nothing but the org skill renders no catalog at all", () => {
  assert.equal(buildSkillCatalog(testSkillSource([ORG])), "");
});

test("the org defaults trail the catalog, leaving the base prefix intact", () => {
  const skills = testSkillSource([...SKILL_LIST, ORG]);
  assert.equal(buildInstructions(skills), instructions + buildSkillCatalog(skills) + buildOrgDefaultsBlock(skills));
  assert.ok(buildInstructions(skills).startsWith(instructions));
});

test("no org skill in the snapshot → byte-identical to a turn without it", () => {
  // An older org, or one that never seeded the skill: the prompt must not grow
  // an empty heading.
  assert.equal(buildOrgDefaultsBlock(SKILLS), "");
  assert.equal(buildOrgDefaultsBlock(undefined), "");
  assert.equal(buildOrgDefaultsBlock(testSkillSource([{ ...ORG, content: "   " }])), "");
  assert.equal(buildInstructions(SKILLS), instructions + buildSkillCatalog(SKILLS));
});

test("the task planner gets the org defaults too", () => {
  const out = buildTaskPlanInstructions(testSkillSource([ORG]));
  assert.match(out, /# Organization defaults/);
  assert.match(out, /Use Thunder\./);
  assert.ok(out.startsWith(taskPlanInstructions), "the planner's own charter still leads");
});
