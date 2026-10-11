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
import { outOfDateByAnswers } from "./useAnsweredHere";

describe("outOfDateByAnswers (why the Overview says a design is out of date)", () => {
  const here = new Map([["F2", "b2"]]);

  it("is the answer when every out-of-date feature was answered here and not designed since", () => {
    expect(outOfDateByAnswers(["F2"], here, { F2: "b2" })).toBe(true);
  });

  it("is a Spec edit once the feature was designed again after the answer", () => {
    expect(outOfDateByAnswers(["F2"], here, { F2: "b3" })).toBe(false);
  });

  it("is a Spec edit when any out-of-date feature was not answered here", () => {
    expect(outOfDateByAnswers(["F2", "F3"], here, { F2: "b2", F3: "c1" })).toBe(false);
    expect(outOfDateByAnswers([], here, {})).toBe(false);
  });
});
