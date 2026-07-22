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

import type { ElementType } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { components } from "../../../generated/aep-api";
import type { TaskLogState } from "../hooks/useTaskLog";

type TaskDetail = components["schemas"]["TaskDetail"];
type TaskView = components["schemas"]["TaskView"];
type CriterionStatus = components["schemas"]["CriterionStatus"];

// Router replaced so the back LinkIconButton renders as a plain anchor.
vi.mock("@tanstack/react-router", () => ({
  createLink: (Component: ElementType) =>
    function MockLink({
      to,
      params,
      ...rest
    }: {
      to: string;
      params?: Record<string, unknown>;
    } & Record<string, unknown>) {
      let href = to;
      for (const [key, value] of Object.entries(params ?? {})) {
        href = href.replace(`$${key}`, String(value));
      }
      return <Component component="a" href={href} {...rest} />;
    },
}));

// Data sources replaced wholesale — no QueryClientProvider / MSW needed, only
// the rendering under test is real (mirrors TasksList.test.tsx).
let mockDetail: {
  data?: TaskDetail;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
};
let mockCriteria: CriterionStatus[];
vi.mock("../api/queries", () => ({
  useTask: () => mockDetail,
  useTaskCriteria: () => ({ data: mockCriteria }),
}));

let mockLog: TaskLogState;
vi.mock("../hooks/useTaskLog", () => ({
  useTaskLog: () => mockLog,
}));

let mockSpecFiles: { path: string; sha: string }[];
let mockCriteriaFile: { content: string } | undefined;
vi.mock("../../spec/api/queries", () => ({
  useSpecFiles: () => ({ data: mockSpecFiles }),
  useSpecFileContent: () => ({ data: mockCriteriaFile }),
}));

import { ValidationPage } from "./ValidationPage";

// One base for both response shapes: the stream's task frame is a TaskView
// (no executionHistory, non-nullable blockedBy), get-task is a TaskDetail.
function taskView(overrides?: Partial<TaskView>): TaskView {
  return {
    issueNumber: 30,
    title: "Validate deployed system against acceptance criteria",
    issueUrl: "https://github.com/acme/demo/issues/30",
    executorClass: "validation",
    attention: [],
    dependsOn: [],
    executions: {},
    hold: false,
    lineage: { specTag: "v1" },
    derivedStatus: "in_progress",
    ...overrides,
  };
}

function detail(overrides?: Partial<TaskDetail>): TaskDetail {
  return { ...taskView(), executionHistory: [], ...overrides };
}

function logState(overrides?: Partial<TaskLogState>): TaskLogState {
  return {
    task: undefined,
    lines: [],
    executions: [],
    settledStatus: undefined,
    phase: "live",
    ...overrides,
  };
}

function loaded(overrides?: Partial<TaskDetail>) {
  mockDetail = {
    data: detail(overrides),
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

const CRITERIA_JSON = JSON.stringify({
  requirements: [
    {
      id: "REQ-001",
      statement: "The page greets the user",
      criteria: [
        { id: "AC-001-a", must: "text box is visible", method: "e2e" },
        { id: "AC-001-b", must: "greeting shows the name", method: "e2e" },
      ],
    },
  ],
});

beforeEach(() => {
  // Defaults: no criteria file → checklist hidden (header/log tests unaffected).
  mockCriteria = [];
  mockSpecFiles = [];
  mockCriteriaFile = undefined;
  mockLog = logState();
});

describe("ValidationPage", () => {
  it("renders the header and streams the log lines", () => {
    loaded();
    mockLog = logState({
      lines: [
        {
          schemaVersion: 1,
          ts: "2026-07-10T09:00:05Z",
          seq: 0,
          executionId: "exec-30-coding",
          executionKind: "coding",
          kind: "log",
          message: "Running Playwright specs against dev",
        },
      ],
    });

    render(<ValidationPage projectName="acme" issueNumber={30} />);

    expect(screen.getByText("#30")).toBeInTheDocument();
    expect(
      screen.getByText("Validate deployed system against acceptance criteria"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Running Playwright specs against dev/),
    ).toBeInTheDocument();
    // Back goes to the deployments board, not the builds list.
    expect(
      screen.getByRole("link", { name: "Back to deployments" }),
    ).toHaveAttribute("href", "/projects/acme/deployments");
  });

  it("links the validation issue and hides the PR button before a PR exists", () => {
    loaded();

    render(<ValidationPage projectName="acme" issueNumber={30} />);

    expect(
      screen.getByRole("link", { name: "GitHub issue #30" }),
    ).toHaveAttribute("href", "https://github.com/acme/demo/issues/30");
    expect(
      screen.queryByRole("link", { name: "Validation pull request" }),
    ).not.toBeInTheDocument();
  });

  it("shows the PR button once the stream's task frame carries prUrl", () => {
    loaded();
    // The stream is fresher than get-task: prUrl arrives on the live task
    // frame first, without a detail refetch.
    mockLog = logState({
      task: taskView({ prUrl: "https://github.com/acme/demo/pull/42" }),
    });

    render(<ValidationPage projectName="acme" issueNumber={30} />);

    expect(
      screen.getByRole("link", { name: "Validation pull request" }),
    ).toHaveAttribute("href", "https://github.com/acme/demo/pull/42");
  });

  it("reassures while the validation attempt is being prepared", () => {
    loaded();
    mockLog = logState({
      executions: [
        {
          id: "exec-30-coding",
          kind: "coding",
          status: "running",
          createdAt: "2026-07-10T09:00:00Z",
        },
      ],
    });

    render(<ValidationPage projectName="acme" issueNumber={30} />);

    expect(
      screen.getByText(/preparing the validation agent…/),
    ).toBeInTheDocument();
  });

  it("shows an error alert with a retry action when get-task fails", () => {
    mockDetail = {
      isPending: false,
      isError: true,
      error: new Error("boom"),
      refetch: vi.fn(),
    };

    render(<ValidationPage projectName="acme" issueNumber={30} />);

    expect(
      screen.getByText(/Failed to load the validation task: boom/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders the criteria checklist, overlaying the durable seed with live frames", () => {
    loaded();
    mockSpecFiles = [{ path: "specs/validation/validation-criteria.json", sha: "sha1" }];
    mockCriteriaFile = { content: CRITERIA_JSON };
    // Durable seed: AC-001-a passed. Live stream: AC-001-b is validating now.
    mockCriteria = [
      { id: "AC-001-a", requirementId: "REQ-001", status: "passed", updatedAt: "2026-07-10T09:05:00Z" },
    ];
    mockLog = logState({
      lines: [
        {
          schemaVersion: 1,
          ts: "2026-07-10T09:06:00Z",
          seq: 1,
          executionId: "exec-30-coding",
          executionKind: "coding",
          kind: "criterion",
          step: "AC-001-b",
          status: "validating",
        },
      ],
    });

    render(<ValidationPage projectName="acme" issueNumber={30} />);

    // Both criteria appear in the checklist with their statuses.
    expect(screen.getByText("AC-001-a")).toBeInTheDocument();
    expect(screen.getByText("AC-001-b")).toBeInTheDocument();
    expect(screen.getByText("passed")).toBeInTheDocument();
    expect(screen.getByText("validating")).toBeInTheDocument();
    // e2e done tally: 1 of 2 terminal.
    expect(screen.getByText("1/2 done")).toBeInTheDocument();
  });

  it("shows a finished run's checklist from the durable seed alone", () => {
    // Settled run, no live stream lines — the store is the sole source.
    loaded({ derivedStatus: "deployed" });
    mockSpecFiles = [{ path: "specs/validation/validation-criteria.json", sha: "sha1" }];
    mockCriteriaFile = { content: CRITERIA_JSON };
    mockCriteria = [
      { id: "AC-001-a", requirementId: "REQ-001", status: "passed", updatedAt: "2026-07-10T09:05:00Z" },
      { id: "AC-001-b", requirementId: "REQ-001", status: "failed", updatedAt: "2026-07-10T09:06:00Z" },
    ];
    mockLog = logState({ phase: "ended", settledStatus: "deployed" });

    render(<ValidationPage projectName="acme" issueNumber={30} />);

    expect(screen.getByText("passed")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("2/2 done")).toBeInTheDocument();
  });
});
