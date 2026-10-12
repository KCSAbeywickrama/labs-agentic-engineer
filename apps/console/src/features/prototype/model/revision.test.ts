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
import type { PrototypeManifest } from "@wso2/prototype-kit/host";
import type { AppPrototype, PrototypeFiles } from "./prototypes";
import { NEW_SESSION, follow } from "./revision";

const manifest: PrototypeManifest = {
  schemaVersion: 3,
  name: "Expenses",
  entryScreen: "screen.claims",
  roles: [{ id: "manager", name: "Manager" }],
  states: [{ id: "state.default", name: "Default" }],
  screens: [{ id: "screen.claims", name: "Claims", roleIds: ["manager"] }],
  flows: [],
};

const filesOf = (source: string): PrototypeFiles => ({ manifestText: JSON.stringify(manifest), manifest, source });
const V1 = filesOf("// one");
const V2 = filesOf("// two");

const app = (status: AppPrototype["status"], files: PrototypeFiles | null, problem: string | null = null): AppPrototype => ({
  component: "expense-web",
  status,
  problem,
  files,
  exists: true,
});

describe("a revision landing", () => {
  it("keeps showing the revision it had while the agent writes the next", () => {
    const revising = follow(follow(NEW_SESSION, app("ready", V1)), app("revising", V2));
    expect(revising).toMatchObject({ revising: true, shown: V1, notice: null });
  });

  it("swaps the landed revision in, and says so", () => {
    const landed = follow(follow(follow(NEW_SESSION, app("ready", V1)), app("revising", V1)), app("ready", V2));
    expect(landed).toMatchObject({ revising: false, shown: V2, notice: { kind: "updated" } });
  });

  it("keeps the last good revision showing when the new one is invalid, and says why", () => {
    const failed = follow(follow(follow(NEW_SESSION, app("ready", V1)), app("revising", V1)), app("invalid", null, "prototype.tsx is missing"));
    expect(failed.shown).toBe(V1);
    expect(failed.notice).toEqual({
      kind: "failed",
      reason: "The updated prototype can't be shown (prototype.tsx is missing), so you're still seeing the previous version.",
    });
  });

  it("says nothing of a run that left the prototype as it was, or made the first one", () => {
    const same = follow(follow(follow(NEW_SESSION, app("ready", V1)), app("revising", V1)), app("ready", filesOf("// one")));
    expect(same.notice).toBeNull();
    const first = follow(follow(NEW_SESSION, app("revising", null)), app("ready", V1));
    expect(first).toMatchObject({ shown: V1, notice: null });
  });

  it("is the same session while nothing changed", () => {
    const shown = follow(NEW_SESSION, app("ready", V1));
    expect(follow(shown, app("ready", V1))).toBe(shown);
  });
});
