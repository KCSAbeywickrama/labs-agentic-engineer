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

import { agentModelConnection } from "./agentModelConnection";

const LLM = {
  kind: "anthropic",
  baseURL: "https://api.anthropic.com/v1",
  model: "claude-sonnet-5",
} as const;

describe("agentModelConnection", () => {
  it("reads the model, the format's label and the host from the org's connection", () => {
    expect(agentModelConnection({ isPending: false, isError: false, data: { llm: LLM } })).toEqual({
      model: "claude-sonnet-5",
      format: "Anthropic Messages",
      host: "api.anthropic.com",
    });
  });

  it("keeps the port when the connection names one", () => {
    const local = { ...LLM, kind: "openai-compatible", baseURL: "http://localhost:11434/v1" } as const;

    expect(agentModelConnection({ isPending: false, isError: false, data: { llm: local } })).toMatchObject({
      format: "OpenAI-compatible",
      host: "localhost:11434",
    });
  });

  it("says loading while the config is being read", () => {
    expect(agentModelConnection({ isPending: true, isError: false, data: undefined })).toBe("loading");
  });

  it("says there is none when the org has no connection", () => {
    expect(agentModelConnection({ isPending: false, isError: false, data: { llm: null } })).toBeNull();
  });

  // A failed read is not "no model connected": saying so would send someone to
  // Settings to fix a connection that is fine.
  it("shows nothing when the config could not be read", () => {
    expect(agentModelConnection({ isPending: false, isError: true, data: undefined })).toBeUndefined();
  });
});
