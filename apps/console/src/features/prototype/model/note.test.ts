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
import { prototypeNote } from "./note";

describe("prototypeNote", () => {
  it("offers a component's review after a turn for it", () => {
    expect(prototypeNote("/prototype expense-web")).toEqual({
      text: expect.stringContaining("expense-web prototype is ready"),
      actions: [{ kind: "open-prototype", label: "Open prototype", component: "expense-web" }],
    });
  });

  it("offers the Prototype tab after a bare turn, which may have made several", () => {
    expect(prototypeNote("/prototype")?.actions).toEqual([{ kind: "open-prototype", label: "Open prototypes", component: null }]);
  });

  it("says nothing after any other turn", () => {
    expect(prototypeNote("/design F1")).toBeNull();
    expect(prototypeNote("/prototypes")).toBeNull();
    expect(prototypeNote("Where are we?")).toBeNull();
    expect(prototypeNote(undefined)).toBeNull();
  });
});
