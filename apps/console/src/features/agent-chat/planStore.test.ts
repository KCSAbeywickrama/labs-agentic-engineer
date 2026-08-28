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

import { afterEach, describe, expect, it } from "vitest";
import {
  clearPlan,
  parseDeclarePlan,
  peekPlan,
  planDeclared,
  planFileDone,
  planFileWriting,
  planTurnEnded,
  rehydratePlanFromHistory,
} from "./planStore";

const KEY = "test-key";
const CELL = "specs/design/design.cell";
const OVERVIEW = "specs/design/design.md";
const PORTAL = "specs/design/components/portal/design.json";

afterEach(() => clearPlan(KEY));

describe("planDeclared — union, no removal", () => {
  it("appends in first-seen order and dedupes restated paths", () => {
    expect(planDeclared(KEY, "t1", [CELL, OVERVIEW])).toBe(2);
    // The second wave restates OVERVIEW — the union must ignore it, so a
    // full-plan restatement can never shrink or double the count.
    expect(planDeclared(KEY, "t1", [OVERVIEW, PORTAL])).toBe(1);
    expect(peekPlan(KEY)?.entries.map((e) => e.path)).toEqual([CELL, OVERVIEW, PORTAL]);
  });

  it("a new turn's declaration replaces the previous turn's plan", () => {
    planDeclared(KEY, "t1", [CELL]);
    planTurnEnded(KEY, "t1", "failed"); // leaves wreckage
    planDeclared(KEY, "t2", [OVERVIEW]);
    const plan = peekPlan(KEY);
    expect(plan?.turnId).toBe("t2");
    expect(plan?.wreckage).toBe(false);
    expect(plan?.entries.map((e) => e.path)).toEqual([OVERVIEW]);
  });
});

describe("derived lifecycle", () => {
  it("planned → writing → done follows the mutation stream", () => {
    planDeclared(KEY, "t1", [CELL, OVERVIEW]);
    planFileWriting(KEY, "t1", CELL);
    expect(peekPlan(KEY)?.entries[0]?.status).toBe("writing");
    expect(peekPlan(KEY)?.writingPath).toBe(CELL);
    planFileDone(KEY, "t1", CELL);
    expect(peekPlan(KEY)?.entries[0]?.status).toBe("done");
    expect(peekPlan(KEY)?.writingPath).toBe(null);
  });

  it("tracks the writing path for an UNdeclared file too — follow-the-write steers by it", () => {
    planFileWriting(KEY, "t1", CELL);
    expect(peekPlan(KEY)?.writingPath).toBe(CELL);
    expect(peekPlan(KEY)?.entries).toEqual([]);
  });

  it("a clean turn's plan dissolves — the files are simply there", () => {
    planDeclared(KEY, "t1", [CELL]);
    planFileWriting(KEY, "t1", CELL);
    planFileDone(KEY, "t1", CELL);
    planTurnEnded(KEY, "t1", "completed");
    expect(peekPlan(KEY)).toBe(null);
  });

  it("a dead turn leaves wreckage: writing → error, planned stays a ghost", () => {
    planDeclared(KEY, "t1", [CELL, OVERVIEW, PORTAL]);
    planFileWriting(KEY, "t1", CELL);
    planFileDone(KEY, "t1", CELL);
    planFileWriting(KEY, "t1", OVERVIEW);
    planTurnEnded(KEY, "t1", "failed");
    const plan = peekPlan(KEY);
    expect(plan?.wreckage).toBe(true);
    expect(plan?.turnActive).toBe(false);
    expect(plan?.entries.map((e) => e.status)).toEqual(["done", "error", "planned"]);
  });

  it("a failed turn whose plan all landed leaves nothing — no residue without loss", () => {
    planDeclared(KEY, "t1", [CELL]);
    planFileWriting(KEY, "t1", CELL);
    planFileDone(KEY, "t1", CELL);
    planTurnEnded(KEY, "t1", "failed");
    expect(peekPlan(KEY)).toBe(null);
  });

  it("ignores a terminal for a turn the snapshot no longer belongs to", () => {
    planDeclared(KEY, "t2", [CELL]);
    planTurnEnded(KEY, "t1", "failed");
    expect(peekPlan(KEY)?.turnId).toBe("t2");
    expect(peekPlan(KEY)?.turnActive).toBe(true);
  });
});

describe("parseDeclarePlan", () => {
  it("accepts an object or its JSON string, drops junk entries", () => {
    expect(parseDeclarePlan({ paths: [CELL, "", 42, ` ${OVERVIEW} `] })).toEqual([
      CELL,
      OVERVIEW,
    ]);
    expect(parseDeclarePlan(JSON.stringify({ paths: [CELL] }))).toEqual([CELL]);
  });

  it("rejects shapes that are not a plan", () => {
    expect(parseDeclarePlan(null)).toBe(null);
    expect(parseDeclarePlan("not json")).toBe(null);
    expect(parseDeclarePlan({ files: [CELL] })).toBe(null);
  });
});

describe("rehydratePlanFromHistory", () => {
  const declareCall = (paths: string[]) => ({
    type: "tool-call",
    toolName: "declare_plan",
    input: { paths },
  });
  const addCall = (path: string) => ({
    type: "tool-call",
    toolName: "addFile",
    input: { path, content: "…" },
  });

  it("rebuilds wreckage from the last declaring turn's record", () => {
    rehydratePlanFromHistory(KEY, [
      { role: "user", content: "/design" },
      { role: "assistant", content: [declareCall([CELL, OVERVIEW]), addCall(CELL)] },
    ]);
    const plan = peekPlan(KEY);
    expect(plan?.wreckage).toBe(true);
    expect(plan?.entries.map((e) => e.status)).toEqual(["done", "planned"]);
  });

  it("a completed plan projects to nothing — it dissolved", () => {
    planDeclared(KEY, "t1", [CELL]);
    planTurnEnded(KEY, "t1", "failed"); // stale residue a fresh read clears
    rehydratePlanFromHistory(KEY, [
      { role: "assistant", content: [declareCall([CELL]), addCall(CELL)] },
    ]);
    expect(peekPlan(KEY)).toBe(null);
  });

  it("never clobbers a live fold", () => {
    planDeclared(KEY, "t-live", [CELL, OVERVIEW]);
    rehydratePlanFromHistory(KEY, [
      { role: "assistant", content: [declareCall([PORTAL]), addCall(PORTAL)] },
    ]);
    expect(peekPlan(KEY)?.turnId).toBe("t-live");
  });
});
