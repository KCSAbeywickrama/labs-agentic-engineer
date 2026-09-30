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
import type { LineBlock } from "../../spec/model/ids";
import { builtLines, changeWords, lineChanges } from "./changes";

const li = (text: string, emphasis: LineBlock["emphasis"] = []): LineBlock => ({ kind: "listItem", text, emphasis });
const h2 = (text: string): LineBlock => ({ kind: "heading", level: 2, text, emphasis: [] });

const assumed = "F2.4 A deputy approves in my place. assumed";
const tag = { start: assumed.indexOf("assumed"), end: assumed.length };

const v1 = builtLines([
  h2("User Stories"),
  li("F2.1 I see pending claims."),
  li("F2.2 I approve with a reason."),
  li(assumed, [tag]),
  h2("Decisions"),
  li("A claim is approved by the line manager."),
]);

describe("builtLines", () => {
  it("keeps each line's own ID and words, without headings or the assumed tag", () => {
    const lines = builtLines([h2("User Stories"), li(assumed, [tag])]);
    expect(lines).toEqual([{ id: "F2.4", words: "F2.4 A deputy approves in my place." }]);
  });
});

describe("lineChanges since the last build", () => {
  it("is nothing when the spec reads the same, a confirmed assumption included", () => {
    const now = builtLines([
      li("F2.1 I see pending claims."),
      li("F2.2 I approve with a reason."),
      li("F2.4 A deputy approves in my place."),
      li("A claim is approved by the line manager."),
    ]);
    expect(lineChanges(v1, now)).toEqual({ added: 0, edited: 0, retired: 0 });
    expect(changeWords(lineChanges(v1, now))).toBe("");
  });

  it("follows a story by its ID: reworded is edited, gone is retired, new is added", () => {
    const now = builtLines([
      li("F2.1 I see pending claims, oldest first."),
      li("F2.2 I approve with a reason."),
      li("F2.5 Finance gives a second approval."),
      li("A claim is approved by the line manager."),
    ]);
    expect(lineChanges(v1, now)).toEqual({ added: 1, edited: 1, retired: 1 });
    expect(changeWords(lineChanges(v1, now))).toBe("1 added, 1 edited, 1 retired");
  });

  it("knows a line without an ID by its words: rewording it retires one and adds one", () => {
    const now = builtLines([
      li("F2.1 I see pending claims."),
      li("F2.2 I approve with a reason."),
      li(assumed, [tag]),
      li("A claim is approved by the employee's line manager."),
    ]);
    expect(changeWords(lineChanges(v1, now))).toBe("1 added, 1 retired");
  });
});
