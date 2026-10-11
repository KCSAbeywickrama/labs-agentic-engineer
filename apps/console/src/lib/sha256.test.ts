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
import { sha256Text } from "./sha256";

describe("sha256Text", () => {
  it("is the SHA-256 of the text's UTF-8 bytes, as the agent and the save gate take it", async () => {
    for (const text of ["", "abc", "Amounts are kept in cents — £, € and 🧾.\n", "x".repeat(200_000)]) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      expect(sha256Text(text)).toBe([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""));
    }
    expect(sha256Text("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
