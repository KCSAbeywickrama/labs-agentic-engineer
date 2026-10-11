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
 * when the design agent's render check passed it), and the review batch the
 * preview saved going back as a revision turn.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mockModel } from "@aep/ae-design-agent/shared/mock-model";
import { prototypeHash } from "@wso2/prototype-kit/feedback";
import { prototypeCommand } from "../src/commands.js";

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

test("--feedback sends the saved review as a revision turn and clears it", async () => {
  const projectDir = seedProject();
  const skillsDir = emptySkills();
  try {
    writeFileSync(join(projectDir, DIR, "prototype.json"), MANIFEST);
    writeFileSync(join(projectDir, DIR, "prototype.tsx"), SOURCE);
    const model = mockModel([{ kind: "text", text: "Renamed." }]);

    assert.match((await prototypeCommand(projectDir, { silent: true, model, skillsDir, feedback: true })).detail ?? "", /no saved review/);

    const stale = saveReview(projectDir, "0".repeat(64));
    assert.match((await prototypeCommand(projectDir, { silent: true, model, skillsDir, feedback: true })).detail ?? "", /earlier revision/);
    assert.ok(existsSync(stale), "a refused review is kept");

    const file = saveReview(projectDir, prototypeHash(MANIFEST, SOURCE));
    const outcome = await prototypeCommand(projectDir, { silent: true, model, skillsDir, feedback: true });
    assert.equal(outcome.ok, true, outcome.detail);
    assert.equal(existsSync(file), false, "a sent review is cleared");

    // The service journaled the batch on the project's thread, as it does for the console.
    const conversations = join(projectDir, ".aep-playground/conversations");
    const journal = readdirSync(conversations)
      .map((f) => readFileSync(join(conversations, f), "utf8"))
      .find((t) => t.includes("Call it Start"));
    assert.ok(journal, "the revision turn carried the review batch");
  } finally {
    cleanup(projectDir, skillsDir);
  }
});
