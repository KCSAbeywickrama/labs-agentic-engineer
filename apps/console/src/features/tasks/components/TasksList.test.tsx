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
import { TasksList } from "./TasksList";

type TaskView = components["schemas"]["TaskView"];

// --- Router -------------------------------------------------------------
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

// --- Tasks query: replaced wholesale so the test needs neither a
// QueryClientProvider nor MSW — only the rendering under test is real. ----
let mockTasks: TaskView[] = [];
vi.mock("../api/queries", () => ({
  useAllTasks: () => ({
    data: mockTasks,
    isPending: false,
    isError: false,
  }),
}));

function task(overrides: Partial<TaskView> & { issueNumber: number }): TaskView {
  return {
    title: `task ${overrides.issueNumber}`,
    issueUrl: `https://github.com/acme/demo/issues/${overrides.issueNumber}`,
    attention: null,
    dependsOn: null,
    executions: {},
    hold: false,
    lineage: {},
    derivedStatus: "pending",
    ...overrides,
  };
}

describe("TasksList", () => {
  it("renders a subtle 'Waiting for …' reason under an on_hold task's chip", () => {
    mockTasks = [
      task({
        issueNumber: 42,
        derivedStatus: "on_hold",
        blockedBy: ["user-auth"],
      }),
    ];

    render(<TasksList projectName="acme" />);

    expect(screen.getByText("On hold")).toBeInTheDocument();
    expect(screen.getByText("Waiting for user-auth")).toBeInTheDocument();
  });

  it("does not render a blocked-reason line for non-on_hold tasks", () => {
    mockTasks = [task({ issueNumber: 7, derivedStatus: "in_progress" })];

    render(<TasksList projectName="acme" />);

    expect(screen.queryByText(/Waiting for/)).not.toBeInTheDocument();
  });
});
