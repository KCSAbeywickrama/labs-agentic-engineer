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

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { setDocFile } from "@aep/collab-doc";
import { checkPrototypeFiles, resolveTheme } from "@wso2/prototype-kit/check";
import { manifestPath, sourcePath } from "../../features/prototype/model/prototypes";
import { SAMPLE_COMPONENT, SAMPLE_MANIFEST, SAMPLE_SOURCE, scriptPrototypeTurn, tweakSource } from "./prototype";

const oxygen = resolveTheme("@wso2/prototype-theme-oxygen", [new URL(".", import.meta.url).pathname]);

/** The file writes a turn streams, in order: tool name and path. */
function writes(frames: { part: { type: string; toolName?: string; input?: unknown } }[]): string[] {
  return frames
    .filter((f) => f.part.type === "tool-result")
    .map((f) => `${f.part.toolName} ${(f.part.input as { path: string }).path}`);
}

function text(turn: { reply: unknown[] }): string {
  return JSON.stringify(turn.reply);
}

function docWith(files: Record<string, string>): Y.Doc {
  const doc = new Y.Doc();
  for (const [path, content] of Object.entries(files)) setDocFile(doc, path, content, "test");
  return doc;
}

const made = () => docWith({ [manifestPath(SAMPLE_COMPONENT)]: SAMPLE_MANIFEST, [sourcePath(SAMPLE_COMPONENT)]: SAMPLE_SOURCE });

/**
 * The first check in a process loads the TypeScript compiler and parses the
 * standard library's, React's and the kit's declarations before it renders;
 * on a shared CI runner that alone can take several seconds.
 */
const FIRST_CHECK_TIMEOUT_MS = 60_000;

describe("the mock's sample prototype", () => {
  it("passes the kit's checks on the Oxygen theme as written", async () => {
    expect(await checkPrototypeFiles({ manifest: SAMPLE_MANIFEST, source: SAMPLE_SOURCE }, { theme: oxygen })).toEqual([]);
  }, FIRST_CHECK_TIMEOUT_MS);

  it("passes the kit's checks on the Oxygen theme as every comment it knows revises it", async () => {
    let source = SAMPLE_SOURCE;
    for (const comment of ["Approve on the right", "A bigger total", "Remove the Reject button"]) {
      const tweak = tweakSource(source, comment);
      expect(tweak, comment).not.toBeNull();
      source = source.replace(tweak!.from, tweak!.to);
    }
    expect(await checkPrototypeFiles({ manifest: SAMPLE_MANIFEST, source }, { theme: oxygen })).toEqual([]);
  });
});

describe("scriptPrototypeTurn", () => {
  const base = { webApps: [SAMPLE_COMPONENT], turnKey: "t1" };

  it("answers only /prototype", () => {
    expect(scriptPrototypeTurn({ ...base, instruction: "Design 2 features", doc: new Y.Doc() })).toBeNull();
  });

  it("makes the prototype: the manifest first, then the source", () => {
    const turn = scriptPrototypeTurn({ ...base, instruction: "/prototype expense-web", doc: new Y.Doc() })!;
    expect(writes(turn.frames)).toEqual([`addFile ${manifestPath(SAMPLE_COMPONENT)}`, `addFile ${sourcePath(SAMPLE_COMPONENT)}`]);
    expect(turn.files).toEqual({ [manifestPath(SAMPLE_COMPONENT)]: SAMPLE_MANIFEST, [sourcePath(SAMPLE_COMPONENT)]: SAMPLE_SOURCE });
  });

  it("writes nothing once the prototype is there, and says so", () => {
    const turn = scriptPrototypeTurn({ ...base, instruction: "/prototype", doc: made() })!;
    expect(writes(turn.frames)).toEqual([]);
    expect(turn.files).toBeUndefined();
    expect(text(turn)).toMatch(/up to date/);
  });

  it("says when the design has no web application", () => {
    const turn = scriptPrototypeTurn({ ...base, webApps: [], instruction: "/prototype", doc: new Y.Doc() })!;
    expect(writes(turn.frames)).toEqual([]);
    expect(text(turn)).toMatch(/no web application/);
  });
});
