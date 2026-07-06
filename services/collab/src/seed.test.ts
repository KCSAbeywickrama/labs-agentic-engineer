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
import * as Y from "yjs";
import { seedDocument, filesMap } from "./seed.js";

const bundle = [
  { path: "requirements/prd.md", group: "requirements", content: "# PRD\n" },
  { path: "design/arch.md", group: "designs", content: "# Arch\n" },
];

test("seeds an empty doc with one Y.Text per file", () => {
  const doc = new Y.Doc();
  seedDocument(doc, bundle);
  const map = filesMap(doc);
  assert.equal(map.size, 2);
  assert.equal(map.get("requirements/prd.md")?.toString(), "# PRD\n");
  assert.equal(map.get("design/arch.md")?.toString(), "# Arch\n");
});

test("never overwrites existing entries (live content wins over reseed)", () => {
  const doc = new Y.Doc();
  seedDocument(doc, bundle);
  const prd = filesMap(doc).get("requirements/prd.md");
  assert.ok(prd);
  prd.insert(prd.length, "user edit\n");

  seedDocument(doc, bundle);
  assert.equal(
    filesMap(doc).get("requirements/prd.md")?.toString(),
    "# PRD\nuser edit\n",
  );
});

test("seed changes replicate to a synced peer doc", () => {
  const server = new Y.Doc();
  const client = new Y.Doc();
  server.on("update", (u: Uint8Array) => Y.applyUpdate(client, u));
  seedDocument(server, bundle);
  assert.equal(
    client.getMap<Y.Text>("files").get("requirements/prd.md")?.toString(),
    "# PRD\n",
  );
});
