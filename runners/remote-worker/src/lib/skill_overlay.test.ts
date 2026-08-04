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
import { applyOverlay, parseOverlay } from "./skill_overlay.js";

const SKILL = [
  "# Title",
  "",
  "intro prose",
  "",
  "## Where you are",
  "",
  "a fresh clone of the repo",
  "",
  "## Contract-first",
  "",
  "shared premise",
  "",
  "# The run",
  "",
  "### The set",
  "",
  "ask the issues API",
  "",
  "### Branch identity",
  "",
  "work out the branch",
  "",
  "## Green",
  "",
  "it compiles",
].join("\n");

function apply(skill: string, overlay: string): string {
  return applyOverlay(skill, parseOverlay(overlay));
}

// --- parseOverlay -----------------------------------------------------------

test("parseOverlay: a section directive takes its heading and the lines below as payload", () => {
  const directives = parseOverlay(["<!-- replace-section: ## Where you are -->", "", "a plain local dir", ""].join("\n"));
  assert.deepEqual(directives, [
    { kind: "replace-section", heading: "## Where you are", payload: "a plain local dir", line: 1 },
  ]);
});

test("parseOverlay: everything before the first directive is documentation", () => {
  const directives = parseOverlay(
    ["# Overlay", "", "How this works, with an indented example:", "", "    <!-- drop-section: ## X -->", "", "<!-- drop-section: ## Green -->"].join("\n"),
  );
  // The indented example is prose — the grammar can be documented in the file
  // it governs without the parser mistaking the example for an instruction.
  assert.deepEqual(directives, [{ kind: "drop-section", heading: "## Green", line: 7 }]);
});

test("parseOverlay: replace-text splits on the with marker", () => {
  const directives = parseOverlay(
    ["<!-- replace-text -->", "  push it", "<!-- with -->", "  keep it local", "<!-- /replace-text -->"].join("\n"),
  );
  assert.deepEqual(directives, [{ kind: "replace-text", find: "  push it", replacement: "  keep it local", line: 1 }]);
});

test("parseOverlay: an empty with half means delete", () => {
  const directives = parseOverlay(["<!-- replace-text -->", "  push it", "<!-- with -->", "<!-- /replace-text -->"].join("\n"));
  assert.equal(directives[0]?.kind, "replace-text");
  assert.equal((directives[0] as { replacement: string }).replacement, "");
});

// Every malformed shape must be an error. An overlay that silently does nothing
// leaves the platform's `gh`/PR procedure in a local session — the one failure
// this whole mechanism exists to make impossible.
test("parseOverlay: a misspelled directive name throws, naming the line", () => {
  assert.throws(
    () => parseOverlay(["<!-- replace-sektion: ## X -->", "body"].join("\n"), "local.md"),
    /local\.md:1: unknown overlay directive "replace-sektion"/,
  );
});

test("parseOverlay: a column-0 comment that is not a directive at all throws", () => {
  assert.throws(
    () => parseOverlay(["<!-- drop-section: ## Green -->", "", "<!-- note to self -->"].join("\n"), "local.md"),
    /local\.md:3: unrecognised overlay directive/,
  );
});

test("parseOverlay: a section directive with no heading throws", () => {
  assert.throws(() => parseOverlay("<!-- drop-section -->"), /needs a heading/);
});

test("parseOverlay: a heading argument that is not a heading throws", () => {
  assert.throws(() => parseOverlay("<!-- drop-section: The set -->"), /is not a markdown heading/);
});

test("parseOverlay: drop-section with a payload throws (it would be silently ignored)", () => {
  assert.throws(
    () => parseOverlay(["<!-- drop-section: ## Green -->", "", "did you mean replace?"].join("\n")),
    /carries a payload/,
  );
});

test("parseOverlay: replace-section with an empty payload throws", () => {
  assert.throws(() => parseOverlay(["<!-- replace-section: ## Green -->", ""].join("\n")), /empty payload/);
});

test("parseOverlay: replace-text without a with half throws", () => {
  assert.throws(() => parseOverlay(["<!-- replace-text -->", "text", "<!-- /replace-text -->"].join("\n")), /no <!-- with --> half/);
});

test("parseOverlay: an unterminated replace-text throws", () => {
  assert.throws(() => parseOverlay(["<!-- replace-text -->", "text", "<!-- with -->", "other"].join("\n")), /not closed/);
});

test("parseOverlay: an overlay with no directives throws", () => {
  assert.throws(() => parseOverlay("# Just prose\n\nnothing to do\n", "local.md"), /no directives/);
});

// --- applyOverlay: sections -------------------------------------------------

test("applyOverlay: replace-section swaps the body and keeps the heading", () => {
  const out = apply(SKILL, ["<!-- replace-section: ## Where you are -->", "", "a plain local dir", ""].join("\n"));
  assert.match(out, /## Where you are\n\na plain local dir\n/);
  assert.ok(!out.includes("a fresh clone of the repo"));
  // The next section is untouched.
  assert.match(out, /## Contract-first\n\nshared premise/);
});

test("applyOverlay: a section ends at the next heading of the same or higher level", () => {
  const out = apply(SKILL, ["<!-- replace-section: ### The set -->", "", "list issues/<n>.md", ""].join("\n"));
  assert.match(out, /### The set\n\nlist issues\/<n>\.md\n/);
  // The sibling H3 after it survives.
  assert.match(out, /### Branch identity\n\nwork out the branch/);
});

test("applyOverlay: drop-section removes the heading with its body", () => {
  const out = apply(SKILL, "<!-- drop-section: ### Branch identity -->");
  assert.ok(!out.includes("### Branch identity"));
  assert.ok(!out.includes("work out the branch"));
  assert.match(out, /### The set/);
  assert.match(out, /## Green/);
});

test("applyOverlay: append-section adds to the end of a section, before the next heading", () => {
  const out = apply(SKILL, ["<!-- append-section: ### The set -->", "", "and read each App Path", ""].join("\n"));
  const setBody = out.slice(out.indexOf("### The set"), out.indexOf("### Branch identity"));
  assert.match(setBody, /ask the issues API/);
  assert.match(setBody, /and read each App Path/);
});

test("applyOverlay: append-section at the end of the document works", () => {
  const out = apply(SKILL, ["<!-- append-section: ## Green -->", "", "say why before deleting", ""].join("\n"));
  assert.match(out, /it compiles\n\nsay why before deleting/);
});

// The skill's branch-identity snippet contains a `# re-verify, then:` comment
// inside a fenced block. Treating that as a heading would end the section early
// and leave half the platform's procedure in a local run.
test("applyOverlay: a #-line inside a fenced block is not a heading", () => {
  const skill = ["## One", "", "```bash", "git commit", "# re-verify, then:", "git push", "```", "", "tail prose", "", "## Two", "", "b"].join("\n");
  const out = apply(skill, "<!-- drop-section: ## One -->");
  assert.ok(!out.includes("# re-verify, then:"));
  assert.ok(!out.includes("tail prose"));
  assert.match(out, /## Two/);
});

test("applyOverlay: a heading that appears twice throws rather than patching the first", () => {
  const skill = ["## Notes", "", "a", "", "## Notes", "", "b"].join("\n");
  assert.throws(() => apply(skill, "<!-- drop-section: ## Notes -->"), /appears 2 times/);
});

test("applyOverlay: a heading that is absent throws", () => {
  assert.throws(() => apply(SKILL, "<!-- drop-section: ## Nope -->"), /appears 0 times/);
});

// The silent failure mode a matching anchor cannot catch. A section runs to the
// next heading of the same or higher level, so a heading RENAMED elsewhere
// widens an earlier directive's range over the section below it: the anchor
// still matches exactly once and a whole section disappears from the composed
// body. Every directive in the real overlay targets a leaf today; this is what
// keeps that true.
test("applyOverlay: a section edit that spans a nested heading throws", () => {
  assert.throws(
    () => apply(SKILL, ["<!-- replace-section: # The run -->", "", "no remote here", ""].join("\n")),
    /spans a nested heading "### The set"/,
  );
});

test("applyOverlay: a rename below the anchor turns a swallow into an error", () => {
  // `### The set`'s range ends at its sibling. Rename that sibling and the range
  // widens to the next H2 — which used to swallow it in silence.
  const renamed = SKILL.replace("### Branch identity", "### Establishing the branch");
  const overlay = ["<!-- replace-section: ### The set -->", "", "list issues/<n>.md", ""].join("\n");
  // Still a leaf, still fine: renaming a SIBLING is harmless.
  assert.match(apply(renamed, overlay), /### Establishing the branch\n\nwork out the branch/);
  // Demoting it to a child is the dangerous edit, and it is now loud.
  const demoted = SKILL.replace("### Branch identity", "#### Branch identity");
  assert.throws(() => apply(demoted, overlay), /spans a nested heading "#### Branch identity"/);
});

test("applyOverlay: append-section will not land past a nested heading", () => {
  const skill = ["## Green", "", "it compiles", "", "### Verify", "", "run the command", "", "## Next", "", "x"].join("\n");
  assert.throws(
    () => apply(skill, ["<!-- append-section: ## Green -->", "", "say why before deleting", ""].join("\n")),
    /spans a nested heading "### Verify"/,
  );
});

// --- applyOverlay: text -----------------------------------------------------

test("applyOverlay: replace-text substitutes exactly one occurrence", () => {
  const out = apply(SKILL, ["<!-- replace-text -->", "ask the issues API", "<!-- with -->", "list the issue files", "<!-- /replace-text -->"].join("\n"));
  assert.match(out, /### The set\n\nlist the issue files/);
});

test("applyOverlay: an empty replacement takes the line with it", () => {
  const skill = ["```bash", "git commit", "git push -u origin HEAD", "```"].join("\n");
  const out = apply(skill, ["<!-- replace-text -->", "git push -u origin HEAD", "<!-- with -->", "<!-- /replace-text -->"].join("\n"));
  // No blank line left behind inside the fence.
  assert.equal(out, ["```bash", "git commit", "```"].join("\n"));
});

test("applyOverlay: an anchor that matches nothing throws, quoting the anchor", () => {
  assert.throws(
    () => apply(SKILL, ["<!-- replace-text -->", "ask the issues api", "<!-- with -->", "x", "<!-- /replace-text -->"].join("\n")),
    /matched 0 times[\s\S]*ask the issues api/,
  );
});

test("applyOverlay: an anchor that matches twice throws", () => {
  const skill = ["## A", "", "push it", "", "## B", "", "push it"].join("\n");
  assert.throws(
    () => apply(skill, ["<!-- replace-text -->", "push it", "<!-- with -->", "x", "<!-- /replace-text -->"].join("\n")),
    /matched 2 times/,
  );
});

test("applyOverlay: an anchor that starts mid-line throws", () => {
  assert.throws(
    () => apply(SKILL, ["<!-- replace-text -->", "issues API", "<!-- with -->", "x", "<!-- /replace-text -->"].join("\n")),
    /matched mid-line/,
  );
});

test("applyOverlay: directives apply in file order", () => {
  const out = apply(
    SKILL,
    [
      "<!-- replace-section: ### The set -->",
      "",
      "list the issue files",
      "",
      "<!-- replace-text -->",
      "list the issue files",
      "<!-- with -->",
      "list issues/<n>.md",
      "<!-- /replace-text -->",
    ].join("\n"),
  );
  assert.match(out, /### The set\n\nlist issues\/<n>\.md/);
});
