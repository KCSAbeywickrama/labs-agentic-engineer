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

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDesignCellRewriteCount } from "./useDesignCellRewrite";

function setup(live: string | null, active: boolean) {
  return renderHook(
    (p: { live: string | null; active: boolean }) =>
      useDesignCellRewriteCount(p.live, p.active),
    { initialProps: { live, active } },
  );
}

describe("useDesignCellRewriteCount", () => {
  it("does not count a file streaming in for the first time (null → content)", () => {
    const { result, rerender } = setup(null, true);
    rerender({ live: "title X\n", active: true });
    expect(result.current).toBe(0);
  });

  it("counts a rewrite: non-empty → null while an agent turn is active", () => {
    const { result, rerender } = setup("title X\n", true);
    rerender({ live: null, active: true });
    expect(result.current).toBe(1);
    // The re-streamed content does not re-fire.
    rerender({ live: "title X\nsouth email\n", active: true });
    expect(result.current).toBe(1);
  });

  it("counts each rewrite burst separately", () => {
    const { result, rerender } = setup("v1", true);
    rerender({ live: null, active: true });
    rerender({ live: "v2", active: true });
    rerender({ live: null, active: true });
    expect(result.current).toBe(2);
  });

  it("ignores the transition when inactive (no agent peer)", () => {
    const { result, rerender } = setup("title X\n", false);
    rerender({ live: null, active: false });
    expect(result.current).toBe(0);
  });

  it("ignores a disconnect (text nulls and active drops in the same render)", () => {
    const { result, rerender } = setup("title X\n", true);
    rerender({ live: null, active: false });
    expect(result.current).toBe(0);
  });

  it("ignores a whitespace-only previous value", () => {
    const { result, rerender } = setup("  \n", true);
    rerender({ live: null, active: true });
    expect(result.current).toBe(0);
  });
});
