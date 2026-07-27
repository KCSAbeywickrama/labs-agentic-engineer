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
 * The chat command taxonomy (pure `classifyChatInput`): precedence between
 * control words, phase-runners, and skill-load / plain-chat turns is pinned
 * here, and the non-interactive branches of the shared `ensureProjectDir`
 * fence-and-create helper.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyChatInput } from "../src/tui/chat-commands.js";
import { ensureProjectDir } from "../src/tui/ensure-dir.js";
import { REPO_ROOT } from "../src/paths.js";

// --- classifyChatInput: control words ---------------------------------------

test("control words win first", () => {
  assert.deepEqual(classifyChatInput("/menu"), { kind: "control", name: "menu" });
  assert.deepEqual(classifyChatInput("/threads"), { kind: "control", name: "menu" });
  assert.deepEqual(classifyChatInput("/quit"), { kind: "control", name: "quit" });
  assert.deepEqual(classifyChatInput("/help"), { kind: "control", name: "help" });
});

// --- classifyChatInput: phase-runners ---------------------------------------

test("phase-runners map to their phase, before the skill loader", () => {
  assert.deepEqual(classifyChatInput("/task"), { kind: "phase", name: "task" });
  assert.deepEqual(classifyChatInput("/validate"), { kind: "phase", name: "validate" });
  assert.deepEqual(classifyChatInput("/undo"), { kind: "phase", name: "undo" });
  assert.deepEqual(classifyChatInput("/code"), { kind: "phase", name: "code" });
});

test("/code takes an optional issue argument", () => {
  assert.deepEqual(classifyChatInput("/code issues/3.md"), {
    kind: "phase",
    name: "code",
    arg: "issues/3.md",
  });
});

test("a phase name must match exactly — /code-all and /tasky are not phases", () => {
  assert.deepEqual(classifyChatInput("/code-all"), {
    kind: "turn",
    instruction: "Load the code-all skill and follow it.",
  });
  assert.deepEqual(classifyChatInput("/tasky"), {
    kind: "turn",
    instruction: "Load the tasky skill and follow it.",
  });
});

// --- classifyChatInput: skill-load / plain chat -----------------------------

test("skill commands expand via slashSkillInstruction", () => {
  assert.deepEqual(classifyChatInput("/spec an app"), {
    kind: "turn",
    instruction: "Load the spec skill and follow it.\n\nan app",
  });
  assert.deepEqual(classifyChatInput("/design"), {
    kind: "turn",
    instruction: "Load the design skill and follow it.",
  });
  assert.deepEqual(classifyChatInput("/grilling"), {
    kind: "turn",
    instruction: "Load the grilling skill and follow it.",
  });
});

test("a plain line is a verbatim chat turn", () => {
  assert.deepEqual(classifyChatInput("please regenerate the design"), {
    kind: "turn",
    instruction: "please regenerate the design",
  });
});

// --- ensureProjectDir: non-interactive branches -----------------------------

test("ensureProjectDir accepts an existing directory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aep-ensure-"));
  try {
    const r = await ensureProjectDir(dir, { interactive: false });
    assert.deepEqual(r, { ok: true, path: dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureProjectDir refuses a missing dir when headless (never creates silently)", async () => {
  const base = mkdtempSync(join(tmpdir(), "aep-ensure-"));
  const missing = join(base, "does-not-exist");
  try {
    const r = await ensureProjectDir(missing, { interactive: false });
    assert.equal(r.ok, false);
    assert.equal(existsSync(missing), false); // and it did NOT create it
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("ensureProjectDir refuses a path that exists but is not a directory", async () => {
  const base = mkdtempSync(join(tmpdir(), "aep-ensure-"));
  const file = join(base, "a-file");
  writeFileSync(file, "x");
  try {
    const r = await ensureProjectDir(file, { interactive: false });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /not a directory/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("ensureProjectDir refuses an illegal in-repo path (the fence) before anything else", async () => {
  // A path inside the repo but outside playground/.projects/ is fenced —
  // services/ exists and is a directory, so only the fence can reject it.
  const r = await ensureProjectDir(join(REPO_ROOT, "services"), { interactive: false });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /refusing to use/);
});
