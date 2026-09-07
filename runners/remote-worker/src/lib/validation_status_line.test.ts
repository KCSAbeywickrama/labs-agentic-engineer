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

import assert from "node:assert/strict";
import test from "node:test";

import { ValidationProgressState } from "./validation_progress.js";
import type { LadderState } from "./validation_status_line.js";
import {
  LADDER,
  LADDER_LINES,
  Ladder,
  MAX_POSTS,
  OBSERVED_COMMENT_MARKER,
  createValidationStatusLine,
  ladderStateFor,
  repoSlug,
} from "./validation_status_line.js";

const write = (file: string, content: string) => ({
  toolName: "Write",
  input: { file_path: file, content },
});
const bash = (command: string) => ({ toolName: "Bash", input: { command } });

function stateFor(call: { toolName: string; input: unknown }, progress = new ValidationProgressState()) {
  return ladderStateFor(call.toolName, call.input, progress);
}

// --- which calls announce which rung ---------------------------------------

// The two ends are matched here because no per-criterion status describes them:
// the harness is scaffolding, and the report is a verdict over every criterion
// at once.
test("ladderStateFor: the harness install and the report generator are the two ends", () => {
  assert.equal(stateFor(bash("npm install --prefix tests/e2e")), "harness");
  assert.equal(stateFor(bash("npm ci --prefix tests/e2e")), "harness");
  assert.equal(
    stateFor(bash('node "$AEP_SKILLS_DIR/aep-validation/scripts/generate-report.mjs" --issue 7')),
    "reporting",
  );
});

// p44, 01:18:13: "Generating the validation report from the results on disk."
// posted as the run's FIRST line, before the app had been opened. Step 5
// scaffolds the package by copying this very file into the repo, and a pattern
// matching the bare filename read that copy as a verdict being generated.
test("ladderStateFor: scaffolding the report generator is not generating a report", () => {
  assert.equal(
    stateFor(
      bash(
        'cp "$AEP_SKILLS_DIR/aep-validation/scripts/generate-report.mjs" tests/e2e/scripts/generate-report.mjs',
      ),
    ),
    undefined,
    "the copy announces nothing — harness already fired on the package write",
  );
  assert.equal(stateFor(bash("ls tests/e2e/scripts/generate-report.mjs")), undefined);
  assert.equal(stateFor(bash("cat scripts/generate-report.mjs | head -20")), undefined);
});

// p44 posted no harness line at all. The skill writes
// `npm install --prefix tests/e2e`, but the order of a flag and a verb is the
// agent's to choose and the pattern demanded one of them.
test("ladderStateFor: an install is an install whatever order it is written in", () => {
  for (const command of [
    "npm install --prefix tests/e2e",
    "npm --prefix tests/e2e install",
    "npm --prefix tests/e2e ci",
    "cd tests/e2e && npm install",
    "pnpm --prefix tests/e2e install",
  ]) {
    assert.equal(stateFor(bash(command)), "harness", command);
  }
});

// The surer signal, and the reason the shell form no longer has to be guessed:
// the skill NAMES these files, and re-copies the config on every run — so this
// fires on a re-validation too, where the install may legitimately not happen.
test("ladderStateFor: writing a scaffold file is the harness", () => {
  for (const file of [
    "tests/e2e/package.json",
    "tests/e2e/playwright.config.ts",
    "tests/e2e/targets.json",
    "tests/e2e/lib/targets.ts",
    "/home/aep/aep-workspace/tests/e2e/.gitignore",
  ]) {
    assert.equal(stateFor(write(file, "{}")), "harness", file);
  }
});

// The exclusion that keeps the rung honest: a spec lives under the same package
// and means the rung ABOVE. Without it every spec write would report harness and
// the ladder would ratchet backwards for the whole authoring phase.
test("ladderStateFor: a spec under tests/e2e is never the harness", () => {
  assert.equal(
    stateFor(write("tests/e2e/specs/AC-001-a.spec.ts", "// spec: AC-001-a\n")),
    "exploring",
  );
  assert.equal(
    stateFor(
      write("tests/e2e/specs/AC-001-a.spec.ts", "// spec: AC-001-a\ntest('AC-001-a: x', async () => {});"),
    ),
    "authoring",
  );
});

// The middle three ARE ProgressItemStatus values, read through the same
// derivation the console's rows use. Pinned here so a change to that derivation
// cannot silently take the issue's line with it.
test("ladderStateFor: the middle rungs come from the per-criterion derivation", () => {
  assert.equal(
    stateFor(write("tests/e2e/specs/AC-001-a.spec.ts", "// spec: AC-001-a\n")),
    "exploring",
    "a header-only spec is the stub written BEFORE exploring",
  );
  assert.equal(
    stateFor(write("tests/e2e/specs/AC-001-a.spec.ts", "// spec: AC-001-a\ntest('AC-001-a: x', async () => {});")),
    "authoring",
  );
  assert.equal(stateFor(bash("npm test --prefix tests/e2e -- specs/AC-001-a.spec.ts")), "running");
});

// The rungs are about the RUN. A criterion status with no rung of its own must
// not fall through to one that means something else — `planned` in particular,
// which the test plan raises for every criterion at once.
test("ladderStateFor: a call that announces no rung announces nothing", () => {
  assert.equal(stateFor(write("tests/validation/test-plan.md", "## AC-001-a — a box\n")), undefined);
  assert.equal(stateFor(bash("cat tests/e2e/specs/AC-001-a.spec.ts")), undefined);
  assert.equal(stateFor(bash("git push --force-with-lease -u origin aep/m1-validation")), undefined);
  assert.equal(stateFor(write("src/app.ts", "export const x = 1;")), undefined);
});

// `npm install` in some other package is a different run doing different work.
test("ladderStateFor: only the e2e package's install is the harness", () => {
  assert.equal(stateFor(bash("npm install --prefix apps/web")), undefined);
});

// --- the ratchet ------------------------------------------------------------

// A criterion authored twelve times is one line. Twelve identical comments would
// say nothing the first did not, and each one costs a slot in the window the
// status line is read inside.
test("Ladder: the state a run is already in is not news", () => {
  const ladder = new Ladder();
  assert.equal(ladder.admit("exploring"), true);
  assert.equal(ladder.admit("exploring"), false);
  assert.equal(ladder.admit("exploring"), false);
});

// The shape of a real middle: twelve criteria, each walking the same three
// rungs. This is the case that decides whether the ladder is usable at all —
// three lines per criterion would exhaust the cap around the fourth and leave
// the rest of a two-hour run silent, which is the defect the ladder exists to
// fix, returning at its worst possible moment.
test("Ladder: working criteria one at a time posts each rung once, not once per criterion", () => {
  const ladder = new Ladder();
  const posted: LadderState[] = [];
  const say = (s: LadderState) => {
    if (ladder.admit(s)) posted.push(s);
  };

  say("harness");
  for (let criterion = 0; criterion < 12; criterion += 1) {
    say("exploring");
    say("authoring");
    say("running");
  }
  say("reporting");

  assert.deepEqual(posted, ["harness", "exploring", "authoring", "running", "reporting"]);
});

// Step 8 heals by editing a spec and re-running it, over and over. At the run
// altitude nothing has changed — it is still running tests against the deployed
// system — and the console already says which criterion is healing, per row.
test("Ladder: healing does not walk the line backwards", () => {
  const ladder = new Ladder();
  for (const s of ["harness", "exploring", "authoring", "running"] as const) ladder.admit(s);

  for (let heal = 0; heal < 5; heal += 1) {
    assert.equal(ladder.admit("authoring"), false, "a heal is not a regression");
    assert.equal(ladder.admit("running"), false, "…and neither is re-running it");
  }
});

// Step 9's exit-2 sends a run back to authoring, and that is the ordinary path
// rather than a fault. A strict first-occurrence ratchet would leave it under
// "generating the report" for the rest of the run — silent AND wrong, which is
// worse than the silence this exists to fix.
test("Ladder: going backwards posts again and resets the high-water mark", () => {
  const ladder = new Ladder();
  for (const state of LADDER) assert.equal(ladder.admit(state), true, state);

  assert.equal(ladder.admit("authoring"), true, "the loop back to authoring is news");
  assert.equal(ladder.admit("authoring"), false, "…but only once");
  assert.equal(ladder.admit("reporting"), true, "and reaching the report again is news too");
});

// The rollback rule has no natural bound. A run thrashing between authoring and
// the generator could post on every lap, and past the read window the earlier
// lines are gone anyway — so the ladder goes quiet and leaves the last one
// standing, which is what a finished run looks like.
test("Ladder: a thrashing run stops posting at the cap", () => {
  const ladder = new Ladder();
  let posted = 0;
  for (let i = 0; i < MAX_POSTS * 3; i += 1) {
    if (ladder.admit(i % 2 === 0 ? "authoring" : "reporting")) posted += 1;
  }
  assert.equal(posted, MAX_POSTS);
});

// --- the hook ---------------------------------------------------------------

function hookInput(call: { toolName: string; input: unknown }) {
  return {
    hook_event_name: "PreToolUse",
    tool_name: call.toolName,
    tool_input: call.input,
    tool_use_id: "tu_1",
  };
}

test("the hook posts one branded line per rung", async () => {
  const posted: string[] = [];
  const { hook } = createValidationStatusLine(
    new ValidationProgressState(),
    async (body) => {
      posted.push(body);
    },
    () => assert.fail("a successful post must not warn"),
  );

  await hook(hookInput(bash("npm ci --prefix tests/e2e")) as never, undefined, { signal: undefined } as never);
  await hook(
    hookInput(write("tests/e2e/specs/AC-001-a.spec.ts", "// spec: AC-001-a\n")) as never,
    undefined,
    { signal: undefined } as never,
  );

  assert.deepEqual(posted, [
    `${OBSERVED_COMMENT_MARKER}\n${LADDER_LINES.harness}`,
    `${OBSERVED_COMMENT_MARKER}\n${LADDER_LINES.exploring}`,
  ]);
});

// The brand is what keeps these OUT of the platform's notes-to-the-agent class,
// which the BFF drops on read. Unbranded they would be indistinguishable from
// the agent's own words; branded as machine they would vanish entirely.
test("every line carries the observed brand, first", async () => {
  const posted: string[] = [];
  const { hook } = createValidationStatusLine(new ValidationProgressState(), async (b) => void posted.push(b), () => {});
  await hook(hookInput(bash("npm ci --prefix tests/e2e")) as never, undefined, { signal: undefined } as never);
  assert.ok(posted[0]?.startsWith(OBSERVED_COMMENT_MARKER), posted[0]);
});

// The status line is the newest comment's FIRST non-empty line, so a rung's
// sentence is the whole claim — there is no second line a reader will see.
test("every rung's line is a single sentence on one line", () => {
  for (const state of LADDER) {
    const line = LADDER_LINES[state];
    assert.ok(!line.includes("\n"), `${state} spans lines`);
    assert.ok(line.length > 0 && line.length < 120, `${state} is not one readable line: ${line}`);
  }
});

// A validation cycle is two hours of work and the status line is commentary on
// it. Losing the commentary must never lose a criterion, so the failure is
// reported on the run's own feed and swallowed.
test("a failed post warns and never throws", async () => {
  const warnings: string[] = [];
  const { hook } = createValidationStatusLine(
    new ValidationProgressState(),
    async () => {
      throw new Error("gh: 403 rate limited");
    },
    (reason) => warnings.push(reason),
  );

  const decision = await hook(hookInput(bash("npm ci --prefix tests/e2e")) as never, undefined, {
    signal: undefined,
  } as never);

  assert.deepEqual(decision, {}, "the hook watches; it never decides");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /harness/);
  assert.match(warnings[0] ?? "", /rate limited/);
});

// It watches the calls a run has to make. A hook that could refuse one would be
// a far worse bargain than no status line.
test("the hook never blocks a tool call", async () => {
  const { hook } = createValidationStatusLine(new ValidationProgressState(), async () => {}, () => {});
  for (const call of [bash("npm ci --prefix tests/e2e"), bash("ls"), write("x.ts", "y")]) {
    const decision = await hook(hookInput(call) as never, undefined, { signal: undefined } as never);
    assert.deepEqual(decision, {});
  }
});

// --- the repair mode --------------------------------------------------------

function reportCall(id = "tu_report") {
  return {
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: 'node "$AEP_SKILLS_DIR/aep-validation/scripts/generate-report.mjs" --issue 7' },
    tool_use_id: id,
  };
}

async function fire(hook: ReturnType<typeof createValidationStatusLine>["hook"], input: unknown) {
  return hook(input as never, undefined, { signal: undefined } as never);
}

// The whole reason this mode exists. Step 9's exit 2 is "the ordinary loop, not
// a defect" — the generator names specs with no result, the run covers them and
// regenerates, and it may lap several times. Narrating each lap as rungs put
// three lines on the issue per lap and reached MAX_POSTS at the third.
test("a lapping run says it is repairing ONCE, however many laps it takes", async () => {
  const posted: string[] = [];
  const line = createValidationStatusLine(new ValidationProgressState(), async (b) => void posted.push(b), () => {});

  await fire(line.hook, hookInput(bash("npm ci --prefix tests/e2e")));
  await fire(line.hook, hookInput(write("tests/e2e/specs/AC-001-a.spec.ts", "// spec: AC-001-a\n")));
  await fire(line.hook, hookInput(write("tests/e2e/specs/AC-001-a.spec.ts", "// spec: AC-001-a\ntest('AC-001-a: x', () => {});")));
  await fire(line.hook, hookInput(bash("npm test --prefix tests/e2e -- specs/AC-001-a.spec.ts")));

  // Four laps: generate, refused, cover the gap, generate again…
  for (let lap = 0; lap < 4; lap += 1) {
    await fire(line.hook, reportCall(`tu_${lap}`));
    line.settle(`tu_${lap}`, false);
    await fire(line.hook, hookInput(bash("npm test --prefix tests/e2e -- specs/AC-001-b.spec.ts")));
    await fire(line.hook, hookInput(write("tests/e2e/specs/AC-001-b.spec.ts", "test('AC-001-b: y', () => {});")));
  }
  // …and the fifth one lands.
  await fire(line.hook, reportCall("tu_ok"));
  line.settle("tu_ok", true);

  const lines = posted.map((b) => b.split("\n")[1]);
  assert.deepEqual(lines, [
    LADDER_LINES.harness,
    LADDER_LINES.exploring,
    LADDER_LINES.authoring,
    LADDER_LINES.running,
    LADDER_LINES.reporting,
    LADDER_LINES.repairing,
  ]);
  assert.ok(posted.length < MAX_POSTS, "four laps must not approach the cap");
});

// Only the generator's own outcome enters the mode. A failing `npm test` is
// ordinary — a criterion failed, the rows say so, and step 8 heals it.
test("a failing spec run is not a repair", async () => {
  const posted: string[] = [];
  const line = createValidationStatusLine(new ValidationProgressState(), async (b) => void posted.push(b), () => {});

  await fire(line.hook, {
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "npm test --prefix tests/e2e -- specs/AC-001-a.spec.ts" },
    tool_use_id: "tu_test",
  });
  line.settle("tu_test", false);

  assert.deepEqual(posted.map((b) => b.split("\n")[1]), [LADDER_LINES.running]);
});

// Leaving the mode is silent: step 10's push, pull request and the agent's own
// closing summary follow, and that summary says more than a rung could.
test("the report landing says nothing — the closing summary is next", async () => {
  const posted: string[] = [];
  const line = createValidationStatusLine(new ValidationProgressState(), async (b) => void posted.push(b), () => {});

  await fire(line.hook, reportCall("tu_1"));
  line.settle("tu_1", false);
  const afterRepair = posted.length;
  await fire(line.hook, reportCall("tu_2"));
  line.settle("tu_2", true);

  assert.equal(posted.length, afterRepair, "landing the report posted a line of its own");
});

// The cap going quiet looks exactly like a run that finished, which is the
// failure shape this whole mechanism exists to remove — so it says so once, on
// the run's own feed, where it is diagnosable.
test("reaching the cap warns once and then stops posting", async () => {
  const posted: string[] = [];
  const warnings: string[] = [];
  const line = createValidationStatusLine(
    new ValidationProgressState(),
    async (b) => void posted.push(b),
    (reason) => warnings.push(reason),
  );

  // Alternating the last rung with a fall from it is the one shape that can
  // still climb without bound — a generator invoked, a spec edited, repeat —
  // and it is why the backstop is still here now that the repair mode absorbs
  // the ordinary loop.
  for (let i = 0; i < MAX_POSTS * 2; i += 1) {
    await fire(line.hook, i % 2 === 0 ? reportCall(`tu_${i}`) : hookInput(write("tests/e2e/specs/AC-001-a.spec.ts", "test('AC-001-a: x', () => {});")));
  }

  assert.equal(posted.length, MAX_POSTS, "the cap did not hold");
  assert.equal(warnings.length, 1, "the cap must announce itself exactly once");
  assert.match(warnings[0] ?? "", /capped at 12/);
  assert.match(warnings[0] ?? "", /last line will stand/);
});

// --- addressing the issue ---------------------------------------------------

// Naming the repository rather than letting `gh` infer it from a remote: the
// clone URL is the one form every dispatch carries.
test("repoSlug: owner/repo out of the clone URLs a dispatch can carry", () => {
  for (const [url, want] of [
    ["https://github.com/acme/widgets.git", "acme/widgets"],
    ["https://github.com/acme/widgets", "acme/widgets"],
    ["git@github.com:acme/widgets.git", "acme/widgets"],
    ["https://ghe.example.com/acme/widgets.git", "acme/widgets"],
  ] as const) {
    assert.equal(repoSlug(url), want, url);
  }
});
