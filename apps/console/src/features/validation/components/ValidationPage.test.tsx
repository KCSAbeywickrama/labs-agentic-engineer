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
import { afterEach, describe, expect, it, vi } from "vitest";

// Router replaced so the PageHeader back-link renders as a plain anchor — no
// RouterProvider needed (mirrors DeploymentsPage.test.tsx / NotFound.test.tsx).
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

// The live log is rendered by the pure TaskLogView fed from the useTaskLog SSE
// hook. Both are out of scope here: stub TaskLogView to a marker so we can
// assert which lifecycle states show the log vs. the report, and make
// useTaskLog inert so no stream opens.
vi.mock("../../tasks/components/TaskLogView", () => ({
  TaskLogView: () => <div data-testid="log-view">log view</div>,
}));
vi.mock("../../tasks/hooks/useTaskLog", () => ({
  useTaskLog: () => ({
    lines: [],
    phase: "live",
    executions: [],
    settledStatus: undefined,
    task: undefined,
  }),
}));

// get-task feeds only the header issue/PR links here.
vi.mock("../../tasks/api/queries", () => ({
  useTask: () => ({
    data: {
      issueUrl: "https://github.com/acme/demo/issues/30",
      prUrl: "https://github.com/acme/demo/pull/42",
    },
  }),
}));

// Controllable status + file queries (no QueryClientProvider / MSW).
let mockValidation = "none";
let mockVerdict: string | undefined;
let mockFailureKind: string | undefined;
let mockIssue: number | undefined;
const mockSetVerdict = {
  mutate: vi.fn(),
  isPending: false,
  error: null as Error | null,
};
const mockCriteria = {
  isPending: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
  data: undefined as { content: string } | undefined,
};
const mockReport = {
  isPending: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
  data: undefined as { content: string } | undefined,
};

vi.mock("../../projects/api/queries", () => ({
  useProjectStatus: () => ({
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    data: {
      deploy: {
        version: "v1",
        validation: mockValidation,
        ...(mockVerdict ? { validationVerdict: mockVerdict } : {}),
        ...(mockFailureKind ? { validationFailureKind: mockFailureKind } : {}),
        ...(mockIssue ? { validationIssue: mockIssue } : {}),
      },
    },
  }),
}));

vi.mock("../api/queries", () => ({
  useValidationCriteria: () => mockCriteria,
  useValidationReport: () => mockReport,
  useSetValidationVerdict: () => mockSetVerdict,
}));

import { ValidationPage } from "./ValidationPage";

const CRITERIA = JSON.stringify({
  requirements: [
    {
      id: "REQ-001",
      statement: "Shoppers can search the catalog.",
      criteria: [
        { id: "AC-001-a", must: "Search returns matches", method: "e2e" },
        { id: "AC-001-b", must: "Category filter works", method: "e2e" },
        { id: "AC-003-b", must: "Payment is encrypted", method: "manual" },
      ],
    },
  ],
});

const REPORT = JSON.stringify({
  criteria: [
    { id: "AC-001-a", status: "pass" },
    {
      id: "AC-001-b",
      status: "fail",
      spec: "tests/e2e/specs/AC-001-b.spec.ts",
      failure: "TimeoutError: category option never appeared",
    },
    { id: "AC-003-b", status: "manual" },
  ],
});

function renderPage(view: "logs" | undefined, onViewChange = vi.fn()) {
  render(
    <ValidationPage
      projectName="acme"
      view={view}
      onViewChange={onViewChange}
    />,
  );
  return onViewChange;
}

afterEach(() => {
  vi.clearAllMocks();
  mockValidation = "none";
  mockVerdict = undefined;
  mockFailureKind = undefined;
  mockIssue = undefined;
  mockSetVerdict.isPending = false;
  mockSetVerdict.error = null;
  mockCriteria.isPending = false;
  mockCriteria.isError = false;
  mockCriteria.data = undefined;
  mockReport.isError = false;
  mockReport.data = undefined;
});

describe("ValidationPage lifecycle", () => {
  it("shows an empty state when nothing has run", () => {
    mockValidation = "none";
    renderPage(undefined);
    expect(screen.getByText(/No validation has run yet/)).toBeInTheDocument();
    expect(screen.queryByTestId("log-view")).not.toBeInTheDocument();
  });

  it("shows the inline log box while a run is in progress", () => {
    mockValidation = "running";
    mockIssue = 30;
    renderPage(undefined);
    expect(screen.getByTestId("log-view")).toBeInTheDocument();
  });

  it("shows the log box AND the cause for an errored run", () => {
    mockValidation = "errored";
    mockFailureKind = "runner_crashed";
    mockIssue = 30;
    renderPage(undefined);
    expect(screen.getByTestId("log-view")).toBeInTheDocument();
    // An errored chip that says only "failed" leaves the reader nowhere to go.
    expect(screen.getByText(/Validation could not complete/)).toBeInTheDocument();
    expect(screen.getByText(/runner died part-way/)).toBeInTheDocument();
  });

  // The pair the whole state model exists to separate.
  it("distinguishes a failing SUITE from a broken RUN in the header chip", () => {
    mockValidation = "finished";
    mockVerdict = "fail";
    mockIssue = 30;
    mockCriteria.data = { content: CRITERIA };
    mockReport.data = { content: REPORT };
    renderPage(undefined);
    // Both the header chip and the verdict banner say it — deliberately.
    expect(screen.getAllByText("Validation failed").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/At least one automated criterion did not pass/),
    ).toBeInTheDocument();
    // A failing suite is NOT a broken run: no error banner about the machinery.
    expect(
      screen.queryByText(/Validation could not complete/),
    ).not.toBeInTheDocument();
  });

  it("offers Pass/Fail only while awaiting review, and records the decision", () => {
    mockValidation = "finished";
    mockVerdict = "awaiting_review";
    mockIssue = 30;
    mockCriteria.data = { content: CRITERIA };
    mockReport.data = { content: REPORT };
    renderPage(undefined);

    expect(screen.getAllByText("Awaiting review").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/could not decide this on their own/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pass" }));
    expect(mockSetVerdict.mutate).toHaveBeenCalledWith({ verdict: "pass" });
  });

  it("shows no decision buttons once the verdict is automatic", () => {
    mockValidation = "finished";
    mockVerdict = "pass";
    mockIssue = 30;
    mockCriteria.data = { content: CRITERIA };
    mockReport.data = { content: REPORT };
    renderPage(undefined);

    // An automatic pass is final — nobody can re-decide it from the UI.
    expect(screen.queryByRole("button", { name: "Pass" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fail" })).not.toBeInTheDocument();
    expect(
      screen.getByText(/Every acceptance criterion is automated/),
    ).toBeInTheDocument();
  });

  it("renders the joined report once a run reached a verdict", () => {
    mockValidation = "finished";
    mockVerdict = "fail";
    mockIssue = 30;
    mockCriteria.data = { content: CRITERIA };
    mockReport.data = { content: REPORT };
    renderPage(undefined);

    // The report, not the log.
    expect(screen.queryByTestId("log-view")).not.toBeInTheDocument();
    expect(screen.getByText("Shoppers can search the catalog.")).toBeInTheDocument();
    // Per-criterion state chips from the join.
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
    // Rich failure detail for the failing e2e criterion.
    expect(
      screen.getByText(/category option never appeared/),
    ).toBeInTheDocument();
  });

  it("toggles to the log view via the View logs button", () => {
    mockValidation = "finished";
    mockVerdict = "fail";
    mockIssue = 30;
    mockCriteria.data = { content: CRITERIA };
    mockReport.data = { content: REPORT };
    const onViewChange = renderPage(undefined);

    fireEvent.click(screen.getByRole("button", { name: /View logs/ }));
    expect(onViewChange).toHaveBeenCalledWith("logs");
  });

  it("shows the log box (and a View report button) when ?view=logs", () => {
    mockValidation = "finished";
    mockVerdict = "fail";
    mockIssue = 30;
    mockCriteria.data = { content: CRITERIA };
    mockReport.data = { content: REPORT };
    const onViewChange = renderPage("logs");

    expect(screen.getByTestId("log-view")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /View report/ }));
    expect(onViewChange).toHaveBeenCalledWith(undefined);
  });

  it("falls back to criteria-only, as an ERROR, when the report cannot be read", () => {
    mockValidation = "finished";
    mockVerdict = "fail";
    mockIssue = 30;
    mockCriteria.data = { content: CRITERIA };
    mockReport.isError = true;
    renderPage(undefined);

    expect(
      screen.getByText(/report for this run could not be read/),
    ).toBeInTheDocument();
    expect(screen.getByText("Shoppers can search the catalog.")).toBeInTheDocument();
    // No state chips without a report.
    expect(screen.queryByText("Passed")).not.toBeInTheDocument();
  });
});
