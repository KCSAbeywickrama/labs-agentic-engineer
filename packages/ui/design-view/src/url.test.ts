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
import { safeHref } from "./url.js";

describe("safeHref", () => {
  it("returns http(s) URLs unchanged", () => {
    expect(safeHref("https://x")).toBe("https://x");
    expect(safeHref("http://x")).toBe("http://x");
    expect(safeHref("https://example.com/path?q=1")).toBe(
      "https://example.com/path?q=1",
    );
  });

  it("blocks script-bearing URI schemes", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,x")).toBeUndefined();
    expect(safeHref("vbscript:x")).toBeUndefined();
  });

  it("blocks schemes case-insensitively", () => {
    expect(safeHref("JavaScript:alert(1)")).toBeUndefined();
  });

  it("blocks relative or malformed URLs", () => {
    expect(safeHref("/foo/bar")).toBeUndefined();
    expect(safeHref("not a url")).toBeUndefined();
  });

  it("returns undefined for missing/empty input", () => {
    expect(safeHref(undefined)).toBeUndefined();
    expect(safeHref("")).toBeUndefined();
  });
});
