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

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { components } from "../../../generated/aep-api";
import { UsageSection } from "./UsageSection";

type ProjectUsageList = components["schemas"]["ProjectUsageList"];
type Usage = components["schemas"]["Usage"];

// --- Usage query: replaced wholesale so the test needs neither a
// QueryClientProvider nor MSW — only the rendering under test is real. ----
let mockResult: {
  data?: ProjectUsageList;
  isPending: boolean;
  isError: boolean;
  error?: Error;
} = { isPending: false, isError: false };
vi.mock("../api/queries", () => ({
  useProjectUsageList: () => mockResult,
}));

function usage(costUsd: number | null): Usage {
  return {
    inputTokens: 100_000,
    outputTokens: 50_000,
    cacheReadTokens: 1_000_000,
    cacheCreationTokens: 200_000,
    model: "claude-fable-5",
    costUsd,
  };
}

describe("UsageSection", () => {
  it("renders one card per project with the USD figure on the cost chip", () => {
    mockResult = {
      isPending: false,
      isError: false,
      data: {
        projects: [
          {
            projectName: "storefront-webapp",
            displayName: "Storefront Webapp",
            deleted: false,
            usage: usage(12.34),
          },
        ],
      },
    };
    render(<UsageSection />);
    expect(screen.getByText("Storefront Webapp")).toBeTruthy();
    expect(screen.getByText("storefront-webapp")).toBeTruthy();
    expect(screen.getByText("$12.34")).toBeTruthy();
  });

  it("marks deleted projects and falls back to tokens when no cost is stamped", () => {
    mockResult = {
      isPending: false,
      isError: false,
      data: {
        projects: [
          {
            projectName: "legacy-crm-poc",
            displayName: "legacy-crm-poc",
            deleted: true,
            usage: usage(3.5),
          },
          {
            projectName: "spike",
            displayName: "Spike",
            deleted: false,
            usage: usage(null), // pre-stamping rows: tokens only, no USD
          },
        ],
      },
    };
    render(<UsageSection />);
    expect(screen.getByText("Deleted project")).toBeTruthy();
    // 1.35M total tokens, abbreviated by the shared formatter.
    expect(screen.getByText("1.4M tok")).toBeTruthy();
  });

  it("expands the token breakdown when the cost chip is clicked", () => {
    mockResult = {
      isPending: false,
      isError: false,
      data: {
        projects: [
          {
            projectName: "storefront-webapp",
            displayName: "Storefront Webapp",
            deleted: false,
            usage: usage(12.34),
          },
        ],
      },
    };
    render(<UsageSection />);
    fireEvent.click(screen.getByText("$12.34"));
    expect(screen.getByText("Agent spend — Storefront Webapp")).toBeTruthy();
    expect(screen.getByText("Cache read")).toBeTruthy();
    expect(screen.getByText("1.0M tok")).toBeTruthy();
  });

  it("shows the empty state when no project has usage", () => {
    mockResult = {
      isPending: false,
      isError: false,
      data: { projects: [] },
    };
    render(<UsageSection />);
    expect(screen.getByText(/No agent usage yet/)).toBeTruthy();
  });

  it("shows the error state with the server detail", () => {
    mockResult = {
      isPending: false,
      isError: true,
      error: new Error("usage roll-up unavailable"),
    };
    render(<UsageSection />);
    expect(
      screen.getByText(/Failed to load usage: usage roll-up unavailable/),
    ).toBeTruthy();
  });
});
