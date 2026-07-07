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
import { resolveAuthMode } from "./authMode";

describe("resolveAuthMode", () => {
  it("always uses thunder in production, whatever the flags say", () => {
    expect(resolveAuthMode(false, "mock", "mock")).toBe("thunder");
    expect(resolveAuthMode(false, undefined, undefined)).toBe("thunder");
  });

  it("defaults dev to the API mode: mock APIs → mock auth", () => {
    expect(resolveAuthMode(true, "mock", undefined)).toBe("mock");
  });

  it("defaults dev to thunder when the API is real (proxy mode)", () => {
    expect(resolveAuthMode(true, undefined, undefined)).toBe("thunder");
    expect(resolveAuthMode(true, "proxy", undefined)).toBe("thunder");
  });

  it("VITE_AUTH_MODE=thunder opts dev into real login with mock APIs", () => {
    expect(resolveAuthMode(true, "mock", "thunder")).toBe("thunder");
  });

  it("VITE_AUTH_MODE=mock forces mock auth in dev", () => {
    expect(resolveAuthMode(true, undefined, "mock")).toBe("mock");
  });

  it("ignores unknown override values", () => {
    expect(resolveAuthMode(true, "mock", "bogus")).toBe("mock");
    expect(resolveAuthMode(true, undefined, "bogus")).toBe("thunder");
  });
});
