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
import { CHAT_MIN_WIDTH, chatWidth } from "./chatWidth";

describe("chatWidth", () => {
  it("splits the room in the golden ratio, the chat the shorter part", () => {
    const room = 1388; // a 1440px window less the rail
    const chat = chatWidth(room, null);
    expect((room - chat) / chat).toBeCloseTo((1 + Math.sqrt(5)) / 2, 2);
  });

  it("keeps a saved width as the room changes", () => {
    expect(chatWidth(1388, 400)).toBe(400);
    expect(chatWidth(1868, 400)).toBe(400);
  });

  it("caps the chat at half the room, saved or not", () => {
    expect(chatWidth(1000, 700)).toBe(500);
  });

  it("holds the floor where the golden share falls under it", () => {
    expect(chatWidth(809, null)).toBe(CHAT_MIN_WIDTH); // an 861px window
    expect(chatWidth(1388, 200)).toBe(CHAT_MIN_WIDTH);
  });
});
