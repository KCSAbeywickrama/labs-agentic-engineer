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

// OUTSIDE src/ for the same reason the fixture contract test is: it reads a
// file, and `tsconfig.json` pins `types` to `vite/client` precisely so app code
// cannot reach for node's APIs and still typecheck.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CONSOLE = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Validation's URL contract, read off the tree the router is actually built
 * from — the route modules themselves carry only what `createFileRoute` was
 * handed, so their paths are not assertable in isolation.
 *
 * It gained a level: one page pinned to the newest milestone became a ledger
 * with a page per version. What must not break silently is the old link —
 * every `/validation` in a bookmark, a comment or a notification.
 */
describe("the validation routes", () => {
  const tree = readFileSync(join(CONSOLE, "src/generated/routeTree.gen.ts"), "utf8");

  it("serves the ledger and the per-version page", () => {
    expect(tree).toContain("/projects/$projectName/validation/");
    expect(tree).toContain("/projects/$projectName/validation/$tag");
  });

  // The flat route is gone — it WAS the page pinned to the newest milestone.
  // Old links resolve to the ledger, which is a better answer to "show me
  // validation" than the newest version alone was.
  it("no longer serves a validation page without a version", () => {
    expect(tree).not.toContain("projects.$projectName.validation.tsx");
  });
});
