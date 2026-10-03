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
// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type Ended = (project: string, outcome: "completed" | "failed", instruction?: string) => void;
let ended: Ended | null = null;
const post = vi.fn();
vi.mock("../agent-chat/useProjectChat", () => ({
  chatStore: {
    onTurnEnd: (fn: Ended) => {
      ended = fn;
      return () => {
        ended = null;
      };
    },
    post: (...args: unknown[]) => post(...args),
  },
}));

const { usePrototypeNotes } = await import("./usePrototypeNotes");

afterEach(() => {
  cleanup();
  post.mockReset();
});

describe("the Open prototype note", () => {
  it("is posted to the project when a /prototype turn completes", () => {
    renderHook(() => usePrototypeNotes());
    ended!("acme", "completed", "/prototype expense-web");
    expect(post).toHaveBeenCalledWith("acme", expect.stringContaining("expense-web"), [
      { kind: "open-prototype", label: "Open prototype", component: "expense-web" },
    ]);
  });

  it("is not posted for a failed turn, another turn, or one whose instruction is unknown", () => {
    renderHook(() => usePrototypeNotes());
    ended!("acme", "failed", "/prototype expense-web");
    ended!("acme", "completed", "/design F1");
    ended!("acme", "completed");
    expect(post).not.toHaveBeenCalled();
  });

  it("stops listening when unmounted", () => {
    renderHook(() => usePrototypeNotes()).unmount();
    expect(ended).toBeNull();
  });
});
