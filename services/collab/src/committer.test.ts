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

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import type { Document } from "@hocuspocus/server";
import { setDocFile } from "@aep/collab-doc";
import { flushRoom } from "./committer.js";
import {
  addParticipant,
  dropRoomState,
  ensureRoomState,
} from "./rooms.js";
import {
  ApplyConflictError,
  type ApplyOutcome,
  type BffClient,
  type SpecFile,
} from "./bff.js";
import type { CollabContext } from "./server.js";

const ROOM = "spec-acme-shop";

const ctx: CollabContext = {
  user: { name: "Mark", email: "mark@x.io", kind: "user" },
  token: "tok",
  projectName: "shop",
};

interface RecordedApply {
  writes: { path: string; content: string; baseSha: string }[];
  deletes: { path: string; baseSha: string }[];
  message: string;
}

function fakeBff(overrides: Partial<BffClient> = {}): {
  bff: BffClient;
  applies: RecordedApply[];
} {
  const applies: RecordedApply[] = [];
  const bff: BffClient = {
    validateAccess: () => {
      throw new Error("not used");
    },
    fetchSpecFiles: async () => [],
    applyFiles: async (_t, _p, batch) => {
      applies.push(batch);
      return {
        commitSha: "abc123",
        files: batch.writes.map((w) => ({ path: w.path, sha: `new-${w.path}` })),
      } satisfies ApplyOutcome;
    },
    ...overrides,
  };
  return { bff, applies };
}

function seededDoc(): Document {
  const doc = new Y.Doc() as Document;
  setDocFile(doc, "requirements/prd.md", "# PRD\n\nSeeded.");
  setDocFile(doc, "design/arch.excalidraw", '{"v":1}');
  const state = ensureRoomState(ROOM, "shop");
  state.baseline.set("requirements/prd.md", {
    content: "# PRD\n\nSeeded.",
    sha: "sha-prd",
  });
  state.baseline.set("design/arch.excalidraw", {
    content: '{"v":1}',
    sha: "sha-arch",
  });
  addParticipant(ROOM, { name: "Mark", email: "mark@x.io" });
  addParticipant(ROOM, { name: "John", email: "john@x.io" });
  return doc;
}

beforeEach(() => dropRoomState(ROOM));

test("clean room: no apply", async () => {
  const doc = seededDoc();
  const { bff, applies } = fakeBff();
  await flushRoom({ bff }, ROOM, doc, ctx);
  assert.equal(applies.length, 0);
});

test("flushes only changed files with baseShas and co-author trailers", async () => {
  const doc = seededDoc();
  setDocFile(doc, "design/arch.excalidraw", '{"v":2}');
  setDocFile(doc, "validation/plan.txt", "check\n"); // new file
  const { bff, applies } = fakeBff();

  await flushRoom({ bff }, ROOM, doc, ctx);

  assert.equal(applies.length, 1);
  const batch = applies[0]!;
  const paths = batch.writes.map((w) => w.path).sort();
  assert.deepEqual(paths, ["design/arch.excalidraw", "validation/plan.txt"]);
  const arch = batch.writes.find((w) => w.path === "design/arch.excalidraw")!;
  assert.equal(arch.baseSha, "sha-arch");
  const fresh = batch.writes.find((w) => w.path === "validation/plan.txt")!;
  assert.equal(fresh.baseSha, ""); // must-not-exist arm
  assert.match(batch.message, /^collab session/);
  assert.match(batch.message, /Co-authored-by: John <john@x\.io>/);
  assert.match(batch.message, /Co-authored-by: Mark <mark@x\.io>/);
});

test("baseline advances after a flush — the next one is a no-op", async () => {
  const doc = seededDoc();
  setDocFile(doc, "design/arch.excalidraw", '{"v":2}');
  const { bff, applies } = fakeBff();
  await flushRoom({ bff }, ROOM, doc, ctx);
  await flushRoom({ bff }, ROOM, doc, ctx);
  assert.equal(applies.length, 1);
});

test("deleted non-md files become DeleteOps", async () => {
  const doc = seededDoc();
  doc.getMap("files").delete("design/arch.excalidraw");
  const { bff, applies } = fakeBff();
  await flushRoom({ bff }, ROOM, doc, ctx);
  assert.equal(applies.length, 1);
  assert.deepEqual(applies[0]!.deletes, [
    { path: "design/arch.excalidraw", baseSha: "sha-arch" },
  ]);
  assert.equal(applies[0]!.writes.length, 0);
});

test("conflict: doc wins — adopts HEAD shas and re-applies", async () => {
  const doc = seededDoc();
  setDocFile(doc, "requirements/prd.md", "# PRD\n\nDoc version.");
  let first = true;
  const headFiles: SpecFile[] = [
    { path: "requirements/prd.md", content: "# PRD\n\nGit moved.", sha: "sha-head" },
  ];
  const { bff, applies } = fakeBff({
    fetchSpecFiles: async () => headFiles,
    applyFiles: async (_t, _p, batch) => {
      if (first) {
        first = false;
        throw new ApplyConflictError(["requirements/prd.md"]);
      }
      return {
        commitSha: "after-retry",
        files: batch.writes.map((w) => ({ path: w.path, sha: `new-${w.path}` })),
      };
    },
  });
  // record applies manually since we overrode applyFiles
  const record = bff.applyFiles.bind(bff);
  bff.applyFiles = async (t, p, batch) => {
    applies.push(batch);
    return record(t, p, batch);
  };

  await flushRoom({ bff }, ROOM, doc, ctx);

  assert.equal(applies.length, 2);
  assert.equal(applies[0]!.writes[0]!.baseSha, "sha-prd");
  // retry preconditioned on HEAD's sha, content still the DOC's version
  assert.equal(applies[1]!.writes[0]!.baseSha, "sha-head");
  assert.match(applies[1]!.writes[0]!.content, /Doc version/);
});

test("no token: skips without throwing", async () => {
  const doc = seededDoc();
  setDocFile(doc, "requirements/prd.md", "# changed");
  const { bff, applies } = fakeBff();
  await flushRoom({ bff }, ROOM, doc, { ...ctx, token: null });
  assert.equal(applies.length, 0);
});

test("participants without an email get the noreply trailer address", async () => {
  const doc = seededDoc();
  addParticipant(ROOM, { name: "Chris", email: "" });
  setDocFile(doc, "requirements/prd.md", "# changed again");
  const { bff, applies } = fakeBff();
  await flushRoom({ bff }, ROOM, doc, ctx);
  assert.match(
    applies[0]!.message,
    /Co-authored-by: Chris <Chris@users\.noreply\.aep\.dev>/,
  );
});
