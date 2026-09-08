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
import { elideMiddle } from "./elide";

describe("elideMiddle", () => {
  // The reported case: five consecutive rows of one live run, every one of them
  // rendered as `cd expense-webapp && npm in…` — five different installs a
  // reader could not tell apart, because what identified them was at the end.
  it("keeps the end of a command, which is what tells two apart", () => {
    const commands = [
      "cd expense-webapp && npm install react@19.2.3",
      "cd expense-webapp && npm install vite@7.1.14",
    ];
    const tails = commands.map((c) => elideMiddle(c).tail);
    expect(tails[0]).toContain("react@19.2.3");
    expect(tails[1]).toContain("vite@7.1.14");
    expect(tails[0]).not.toBe(tails[1]);
  });

  // Nothing is dropped: the halves are the string, so the row still reads whole
  // to a screen reader and still copies whole.
  it("loses nothing — the two halves are the original", () => {
    const command = "cd expense-webapp && npm install react@19.2.3";
    const { head, tail } = elideMiddle(command);
    expect(head + tail).toBe(command);
  });

  // The budget is a ceiling on the tail, and the cut moves FORWARD to the next
  // boundary rather than back to the previous one: the head keeps its promised
  // room, and the tail never starts mid-token.
  it("starts the tail on a whole word rather than mid-token", () => {
    const { head, tail } = elideMiddle("cd expense-webapp && npm install react@19.2.3");
    expect(tail).toBe("install react@19.2.3");
    expect(head).toBe("cd expense-webapp && npm ");
  });

  // A string that fits its own budget has nothing to be protected from, and an
  // empty head is what renders no ellipsis at all.
  it("makes a short command all tail", () => {
    expect(elideMiddle("pnpm dev:mock")).toEqual({ head: "", tail: "pnpm dev:mock" });
  });

  // A path has no spaces to break on, and the budget has to win — otherwise the
  // whole string would ride in the tail and the row could not shrink at all.
  it("falls back to the character budget when a word boundary would leave nothing", () => {
    const path = "/home/runner/work/expense-webapp/src/components/ExpenseTable.tsx";
    const { head, tail } = elideMiddle(path);
    expect(tail).toBe("components/ExpenseTable.tsx".slice(-24));
    expect(head + tail).toBe(path);
  });

  // The last space sits at the very end, so honouring it would leave a
  // two-character tail identifying nothing.
  it("ignores a word boundary too close to the end", () => {
    const { tail } = elideMiddle("npm install --workspace=expense-webapp-frontend go");
    expect(tail.length).toBe(24);
  });
});
