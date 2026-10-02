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
import { legStateLabel, trackLegs } from "./trackLegs";
import type { ProjectTrack } from "./model/track";

const acme: ProjectTrack = {
  spec: { state: "done", summary: "5 features" },
  design: { state: "waiting", summary: "2 features to design" },
  build: { state: "notyet", summary: "Not yet" },
};

describe("trackLegs", () => {
  it("draws Spec, Design, Build, Deploy in order, each opening its own card", () => {
    expect(trackLegs(acme).map((l) => [l.step, l.title, l.card])).toEqual([
      [1, "Spec", "spec"],
      [2, "Design", "design"],
      [3, "Build", "builds"],
      [4, "Deploy", null],
    ]);
  });

  it("carries each leg's state and state line from the track", () => {
    const [spec, design] = trackLegs(acme);
    expect(spec).toMatchObject({ state: "done", stateLabel: "Done", summary: "5 features" });
    expect(design).toMatchObject({
      state: "waiting",
      stateLabel: "Waiting on you",
      summary: "2 features to design",
    });
  });

  it("keeps Deploy at not yet whatever the other legs say", () => {
    const shipped: ProjectTrack = {
      spec: { state: "done", summary: "" },
      design: { state: "done", summary: "" },
      build: { state: "done", summary: "v1 built" },
    };
    expect(trackLegs(shipped)[3]).toMatchObject({ state: "notyet", summary: "Not yet" });
  });
});

describe("a leg's accessible name", () => {
  it("says the state in words, then the state line", () => {
    expect(trackLegs(acme)[1]?.accessibleName).toBe("Design: Waiting on you. 2 features to design");
  });

  it("does not repeat a state line that only restates the state", () => {
    expect(trackLegs(acme)[2]?.accessibleName).toBe("Build: Not yet");
  });
});

describe("legStateLabel", () => {
  it("names every lamp in words", () => {
    expect(legStateLabel("done")).toBe("Done");
    expect(legStateLabel("live")).toBe("In progress");
    expect(legStateLabel("waiting")).toBe("Waiting on you");
    expect(legStateLabel("notyet")).toBe("Not yet");
  });
});
