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

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { components } from "../../../generated/aep-api";

type Component = components["schemas"]["Component"];

// Query hooks replaced wholesale — no QueryClientProvider needed, only the
// rendering under test is real (mirrors DeploymentsPage.test.tsx).
let mockEndpointUrl: string | undefined;

vi.mock("../api/queries", () => ({
  useComponentEndpointUrl: () => ({ data: mockEndpointUrl }),
  useComponentOpenApi: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

import { ComponentsList } from "./ComponentsList";

function agentComponent(overrides: Partial<Component> = {}): Component {
  return {
    name: "leave-agent",
    displayName: "Leave Agent",
    type: "ai-agent",
    ...overrides,
  };
}

describe("ComponentsList — ai-agent chat link", () => {
  it("an ai-agent row links to its chat endpoint", () => {
    mockEndpointUrl = "https://leave-agent.dev";

    render(
      <ComponentsList
        projectName="acme"
        items={[agentComponent()]}
      />,
    );

    const link = screen.getByRole("link", { name: /chat/i });
    expect(link).toHaveAttribute("href", "https://leave-agent.dev/chat");
  });

  it("shows the placeholder until the agent has a dev endpoint", () => {
    mockEndpointUrl = undefined;

    render(
      <ComponentsList
        projectName="acme"
        items={[agentComponent({ name: "leave-agent-2" })]}
      />,
    );

    expect(screen.queryByRole("link", { name: /chat/i })).not.toBeInTheDocument();
    expect(screen.getByText("URL appears once deployed")).toBeInTheDocument();
  });
});
