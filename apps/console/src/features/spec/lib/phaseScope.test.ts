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
import { nextVersionLabel, parseCellPhase, parsePhasingStories } from "./phaseScope";

describe("phaseScope display parsers", () => {
  it("reads the cell's phase, null when undeclared", () => {
    expect(parseCellPhase("title X\nphase 2\ncomponent a service")).toBe(2);
    expect(parseCellPhase("component a service")).toBeNull();
  });

  it("reads one phase's stories from the PRD Phasing section", () => {
    const prd = "## Phasing\n- **Phase 1 — slice**: core. Stories: 1, 2, 4.\n- **Phase 2**: Stories: 7.\n";
    expect(parsePhasingStories(prd, 1)).toEqual([1, 2, 4]);
    expect(parsePhasingStories(prd, 3)).toEqual([]);
  });

  // The spec agent hard-wraps PRD prose, so "Stories:" routinely ends one line
  // and its numbers begin the next. A line-scanning parser showed "Stories in
  // scope: —" in the cut drawer for a PRD that declared them perfectly well.
  it("reads a hard-wrapped Phasing entry", () => {
    const prd =
      "## Phasing\n\n" +
      "- **Phase 1 — Working hello-world round trip**: build the `GET /hello` API\n" +
      "endpoint and the web page that calls it and displays the result. Stories:\n" +
      "1, 2.\n";
    expect(parsePhasingStories(prd, 1)).toEqual([1, 2]);
  });

  it("keeps a wrapped entry's stories out of the next entry", () => {
    const prd =
      "## Phasing\n" +
      "- **Phase 1 — core**: the loop. Stories:\n1, 2.\n" +
      "- **Phase 2 — extras**: the rest.\n  Stories: 7,\n  9.\n";
    expect(parsePhasingStories(prd, 1)).toEqual([1, 2]);
    expect(parsePhasingStories(prd, 2)).toEqual([7, 9]);
  });

  it("stops at the end of the Phasing section", () => {
    const prd =
      "## Phasing\n- **Phase 1 — core**: Stories: 1.\n" +
      "## Out of Scope\n- Phase 1 of something else. Stories: 8, 9.\n";
    expect(parsePhasingStories(prd, 1)).toEqual([1]);
  });

  it("predicts the next version label", () => {
    expect(nextVersionLabel("v3")).toBe("v4");
    expect(nextVersionLabel(undefined)).toBe("v1");
  });
});
