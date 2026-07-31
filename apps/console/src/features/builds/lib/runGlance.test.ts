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
import { aheadSentence, buildGlance, glanceHeadline } from "./runGlance";
import type { SpineStage, StageState } from "./stage";

function stage(name: string, state: StageState): SpineStage {
  return { id: name.toLowerCase(), name, actor: "platform", state, note: "" };
}

/** The real shape: sessionSpine keys stages by id, not by display name. */
function withId(id: string, name: string, state: StageState): SpineStage {
  return { id, name, actor: "platform", state, note: "" };
}

const names = (entries: { stage: SpineStage }[]) =>
  entries.map((e) => e.stage.name);

describe("buildGlance", () => {
  it("makes the first unfinished stage NOW", () => {
    const glance = buildGlance([
      stage("Coding agent", "done"),
      stage("Pull request", "done"),
      stage("Merge", "active"),
      stage("Builds", "waiting"),
    ]);

    expect(glance.nowIndex).toBe(2);
    expect(glance.stages[glance.nowIndex!]?.stage.name).toBe("Merge");
  });

  it("collapses everything after NOW into the tail", () => {
    const glance = buildGlance([
      stage("Coding agent", "active"),
      stage("Pull request", "waiting"),
      stage("Merge", "waiting"),
    ]);

    expect(names(glance.ahead)).toEqual(["Pull request", "Merge"]);
  });

  it("treats a stopped stage as NOW — nothing after it ran", () => {
    // A failure is already the first non-done stage, so loudness needs no
    // special case; this pins that the frontier does not skip past it.
    const glance = buildGlance([
      stage("Coding agent", "failed"),
      stage("Pull request", "waiting"),
    ]);

    expect(glance.nowIndex).toBe(0);
    expect(glance.stages[0]?.stage.state).toBe("failed");
  });

  it("has nothing to narrate once every stage is done", () => {
    const glance = buildGlance([
      stage("Coding agent", "done"),
      stage("Deployment", "done"),
    ]);

    expect(glance.nowIndex).toBeNull();
    expect(glance.ahead).toEqual([]);
  });

  it("numbers from stepFrom so the glance and the rail agree", () => {
    // Provisioning takes step 1, so a session's stages start at 2.
    const glance = buildGlance(
      [stage("Coding agent", "active"), stage("Pull request", "waiting")],
      2,
    );

    expect(glance.stages.map((e) => e.step)).toEqual([2, 3]);
  });

  it("survives an empty flow", () => {
    const glance = buildGlance([]);

    expect(glance.nowIndex).toBeNull();
    expect(glance.stages).toEqual([]);
  });
});

describe("glanceHeadline", () => {
  it("says what a known stage is DOING while it runs", () => {
    // The headline is the meaning, not a state suffix the reader must decode.
    // Keyed by stage id, which is what sessionSpine actually emits.
    expect(glanceHeadline(withId("agent", "Coding agent", "active"))).toBe(
      "Coding agent is writing code",
    );
    expect(glanceHeadline(withId("merge", "Merge", "active"))).toBe(
      "Merging the agent's work",
    );
    expect(glanceHeadline(withId("deploy", "Deployment", "active"))).toBe(
      "Rolling out to the cluster",
    );
  });

  it("falls back to the generic form for a stage id it has not learned", () => {
    const unknown: SpineStage = {
      id: "something-new",
      name: "Something new",
      actor: "platform",
      state: "active",
      note: "",
    };
    expect(glanceHeadline(unknown)).toBe("Something new — running");
  });

  it("leads with what the state MEANS for every non-running state", () => {
    expect(glanceHeadline(stage("Merge", "waiting"))).toBe("Merge — waiting");
    expect(glanceHeadline(stage("Merge", "attention"))).toBe(
      "Merge — needs a human",
    );
    expect(glanceHeadline(stage("Merge", "failed"))).toBe("Merge — stopped");
    expect(glanceHeadline(stage("Merge", "done"))).toBe("Merge");
  });
});

describe("aheadSentence", () => {
  it("names the ACTOR of each stage still ahead, not just the stage", () => {
    const glance = buildGlance([
      withId("agent", "Coding agent", "active"),
      withId("pr", "Pull request", "waiting"),
      withId("merge", "Merge", "waiting"),
      withId("deploy", "Deployment", "waiting"),
    ]);

    expect(aheadSentence(glance.ahead)).toBe(
      "the agent opens a pull request → the platform merges it → a green build deploys itself",
    );
  });

  it("says nothing when nothing is ahead", () => {
    expect(aheadSentence([])).toBe("");
  });
});
