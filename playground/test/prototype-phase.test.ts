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
 * The prototype verb: its gate, the fold of a prototype write (it lands only
 * when the design agent's render check passed it), the review the preview
 * saved becoming draft comments in specs/design/review.json, and
 * address-comments sending them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mockModel } from "@aep/ae-design-agent/shared/mock-model";
import { prototypeHash } from "@wso2/prototype-kit/feedback";
import { addressCommentsCommand, prototypeCommand } from "../src/commands.js";
import { foldSavedReview } from "../src/engine/prototype.js";
import { readReviewFile } from "../src/engine/review-file.js";

const WEB = "web";
const DIR = `specs/design/components/${WEB}`;

const MANIFEST = `${JSON.stringify(
  {
    schemaVersion: 3,
    name: "Hello",
    entryScreen: "screen.home",
    roles: [{ id: "user", name: "User" }],
    states: [{ id: "state.default", name: "Default" }],
    screens: [{ id: "screen.home", name: "Home", roleIds: ["user"] }],
    flows: [],
  },
  null,
  2,
)}\n`;

const SOURCE = `import { Heading, Screen, defineApp } from "@wso2/prototype-kit";

function Home() {
  return (
    <Screen>
      <Heading id="heading.home" text="Home" />
    </Screen>
  );
}

export default defineApp({ screens: { "screen.home": Home } });
`;

/** Passes every static check, and throws the moment its screen is drawn. */
const THROWS_ON_RENDER = SOURCE.replace("function Home() {\n", 'function Home() {\n  if (Math.abs(0) === 0) throw new Error("boom");\n');

function seedProject(opts: { webType?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "aep-play-proto-"));
  mkdirSync(join(dir, "specs/requirements"), { recursive: true });
  writeFileSync(join(dir, "specs/requirements/prd.md"), "# Hello\n\n## Features\n\n- F1 Home\n");
  mkdirSync(join(dir, DIR), { recursive: true });
  writeFileSync(join(dir, "specs/design/design.cell"), `title Hello\n\ncomponent ${WEB} as "Web" web-application\n`);
  writeFileSync(join(dir, DIR, "design.json"), JSON.stringify({ name: WEB, type: opts.webType ?? "web-application" }));
  return dir;
}

function emptySkills(): string {
  return mkdtempSync(join(tmpdir(), "aep-play-proto-skills-"));
}

function cleanup(...dirs: string[]): void {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

test("prototype is gated on a design with a web-application", async () => {
  const noDesign = mkdtempSync(join(tmpdir(), "aep-play-proto-"));
  const service = seedProject({ webType: "service" });
  const web = seedProject();
  const model = mockModel([{ kind: "text", text: "x" }]);
  try {
    assert.match((await prototypeCommand(noDesign, { silent: true, model })).detail ?? "", /design\.cell is missing/);
    assert.match((await prototypeCommand(service, { silent: true, model })).detail ?? "", /no web-application/);
    assert.match((await prototypeCommand(web, { silent: true, model }, "api")).detail ?? "", /api is not a web-application/);
  } finally {
    cleanup(noDesign, service, web);
  }
});

test("a prototype write lands only when the design agent's render check passed it", async () => {
  const projectDir = seedProject();
  const skillsDir = emptySkills();
  try {
    const model = mockModel([
      { kind: "toolCall", toolCallId: "m", toolName: "addFile", input: { path: `${DIR}/prototype.json`, content: MANIFEST } },
      { kind: "toolCall", toolCallId: "bad", toolName: "addFile", input: { path: `${DIR}/prototype.tsx`, content: THROWS_ON_RENDER } },
      { kind: "text", text: "Written." },
    ]);
    const outcome = await prototypeCommand(projectDir, { silent: true, model, skillsDir }, WEB);
    assert.equal(outcome.ok, true, outcome.detail);
    assert.equal(readFileSync(join(projectDir, DIR, "prototype.json"), "utf8"), MANIFEST, "half a pair has nothing to draw: it lands");
    assert.equal(existsSync(join(projectDir, DIR, "prototype.tsx")), false, "the source the render check refused is not on disk");

    const fixed = mockModel([
      { kind: "toolCall", toolCallId: "ok", toolName: "addFile", input: { path: `${DIR}/prototype.tsx`, content: SOURCE } },
      { kind: "text", text: "Fixed." },
    ]);
    assert.equal((await prototypeCommand(projectDir, { silent: true, model: fixed, skillsDir }, WEB)).ok, true);
    assert.equal(readFileSync(join(projectDir, DIR, "prototype.tsx"), "utf8"), SOURCE, "a pair that draws lands");
  } finally {
    cleanup(projectDir, skillsDir);
  }
});

/** What the preview's Save feedback writes (`@wso2/prototype-cli/feedback`). */
function saveReview(projectDir: string, hash: string): string {
  const file = join(projectDir, DIR, ".prototype/feedback.json");
  mkdirSync(join(projectDir, DIR, ".prototype"), { recursive: true });
  const requests = [{ screenId: "screen.home", roleId: "user", stateId: "state.default", elementIds: ["heading.home"], text: "Call it Start" }];
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), prototypeHash: hash, requests }));
  return file;
}

const PROTOTYPE_PATH = `${DIR}/prototype.json`;

test("a saved review becomes drafts on the prototype; a later save of the session replaces them", () => {
  const projectDir = seedProject();
  try {
    writeFileSync(join(projectDir, DIR, "prototype.json"), MANIFEST);
    writeFileSync(join(projectDir, DIR, "prototype.tsx"), SOURCE);
    assert.deepEqual(foldSavedReview(projectDir, WEB, [], "2026-10-11T10:00:00.000Z"), { ok: true, ids: [], count: 0 }, "nothing saved, nothing folded");

    const file = saveReview(projectDir, prototypeHash(MANIFEST, SOURCE));
    const first = foldSavedReview(projectDir, WEB, [], "2026-10-11T10:00:00.000Z");
    assert.ok(first.ok && first.count === 1, JSON.stringify(first));
    assert.equal(existsSync(file), false, "the saved file is folded and removed");
    const read = readReviewFile(projectDir);
    assert.ok(read.ok);
    const [entry] = read.review.artifacts;
    assert.equal(entry?.path, PROTOTYPE_PATH);
    assert.deepEqual(
      entry?.comments?.map((c) => ({ text: c.text, status: c.status, anchor: c.anchor })),
      [{ text: "Call it Start", status: "draft", anchor: { screenId: "screen.home", roleId: "user", stateId: "state.default", elementIds: ["heading.home"] } }],
    );

    saveReview(projectDir, prototypeHash(MANIFEST, SOURCE));
    const second = foldSavedReview(projectDir, WEB, first.ok ? first.ids : [], "2026-10-11T10:05:00.000Z");
    assert.ok(second.ok && second.count === 1);
    const again = readReviewFile(projectDir);
    assert.ok(again.ok);
    assert.equal(again.review.artifacts[0]?.comments?.length, 1, "the session's queue replaces its earlier save, never doubles it");
  } finally {
    cleanup(projectDir);
  }
});

test("address-comments marks the drafts sent and runs /address-comments on the design review", async () => {
  const projectDir = seedProject();
  const skillsDir = emptySkills();
  try {
    writeFileSync(join(projectDir, DIR, "prototype.json"), MANIFEST);
    writeFileSync(join(projectDir, DIR, "prototype.tsx"), SOURCE);
    const model = mockModel([{ kind: "text", text: "Renamed." }]);

    assert.match((await addressCommentsCommand(projectDir, { silent: true, model, skillsDir })).detail ?? "", /review\.json is missing/);

    saveReview(projectDir, prototypeHash(MANIFEST, SOURCE));
    foldSavedReview(projectDir, WEB, [], "2026-10-11T10:00:00.000Z");
    const outcome = await addressCommentsCommand(projectDir, { silent: true, model, skillsDir });
    assert.equal(outcome.ok, true, outcome.detail);
    const read = readReviewFile(projectDir);
    assert.ok(read.ok);
    const [comment] = read.review.artifacts[0]?.comments ?? [];
    assert.equal(comment?.status, "sent");
    assert.ok(comment?.sentAt);

    // The service journaled the bare command on the project's thread, as the console sends it.
    const conversations = join(projectDir, ".aep-playground/conversations");
    const journal = readdirSync(conversations)
      .map((f) => readFileSync(join(conversations, f), "utf8"))
      .find((t) => t.includes('"text": "/address-comments"'));
    assert.ok(journal, "the turn was /address-comments");

    assert.match((await addressCommentsCommand(projectDir, { silent: true, model, skillsDir })).detail ?? "", /no comment waits/);
  } finally {
    cleanup(projectDir, skillsDir);
  }
});
