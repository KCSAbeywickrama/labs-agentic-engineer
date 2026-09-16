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
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { components } from "../../../generated/aep-api";

type Deployment = components["schemas"]["Deployment"];
type DeployStage = components["schemas"]["DeployStage"];
type MilestoneRunView = components["schemas"]["MilestoneRunView"];
type BuildSummary = components["schemas"]["BuildSummary"];

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
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

let mockDeploy: DeployStage = {
  version: "v2",
  status: "deployed",
  components: { total: 1, ready: 1 },
  validation: "running",
};
let mockDeployments: Deployment[] = [];
vi.mock("../api/queries", () => ({
  useProjectComponents: () => ({
    data: { items: [{ name: "web", displayName: "Web", type: "web-application" }] },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useComponentsDeployments: () => ({ isPending: false, deployments: mockDeployments, failedCount: 0 }),
  useProjectStatus: () => ({
    data: { repoUrl: "https://github.com/acme/expense.git", build: { version: "v2", status: "succeeded" }, deploy: mockDeploy },
  }),
}));

let mockBuilds: BuildSummary[] = [];
let mockBuildsPending = false;
let mockRuns: MilestoneRunView[] = [];
let mockRunsPending = false;
let mockRunsError = false;
const mockRunsRefetch = vi.fn();
vi.mock("../../builds/api/queries", () => ({
  useBuilds: () => ({
    data: mockBuildsPending ? undefined : mockBuilds,
    isPending: mockBuildsPending,
    isError: false,
    refetch: vi.fn(),
  }),
  useBuildRuns: () => ({
    data: mockRunsPending || mockRunsError ? undefined : { runs: mockRuns },
    isPending: mockRunsPending,
    isError: mockRunsError,
    error: mockRunsError ? new Error("runs down") : null,
    refetch: mockRunsRefetch,
  }),
}));

let mockCounts: { passed: number; failed: number; uncovered: number; total: number } | undefined;
vi.mock("../../validation/api/counts", () => ({
  useValidationEvidence: () => ({
    verdict: "passed",
    repairing: false,
    pending: false,
    ...(mockCounts ? { counts: mockCounts } : {}),
  }),
}));

import { DeploymentVersionPage } from "./DeploymentVersionPage";

const v1: BuildSummary = { tag: "v1", milestoneNumber: 1, status: "completed", startedAt: "2026-09-01T09:00:00Z", completedAt: "2026-09-01T10:00:00Z" };
const v2: BuildSummary = { tag: "v2", milestoneNumber: 2, status: "completed", startedAt: "2026-09-10T09:00:00Z", completedAt: "2026-09-10T11:00:00Z" };
const v3: BuildSummary = { tag: "v3", milestoneNumber: 3, status: "in_progress", startedAt: "2026-09-14T09:00:00Z" };

const judged = (verdict: string): MilestoneRunView =>
  ({
    id: "run-1",
    kind: "dev",
    state: "succeeded",
    milestoneNumber: 2,
    createdAt: "2026-09-10T09:00:00Z",
    validation: { verdict, issue: 1, reportPath: "tests/validation/report.json" },
    cycles: [{ id: "c1", kind: "coding", mergeSha: "4e8a0d6f1c2b3a4d", createdAt: "2026-09-10T09:00:00Z" }],
  }) as unknown as MilestoneRunView;

beforeEach(() => {
  mockDeploy = { version: "v2", status: "deployed", components: { total: 1, ready: 1 }, validation: "running" };
  mockDeployments = [
    { componentName: "web", environment: "development", status: "Ready", releaseName: "web-v2-4e8a0d6", endpointUrl: "https://web.dev.example", createdAt: "2026-09-12T10:00:00Z" },
  ];
  mockBuilds = [v3, v2, v1];
  mockBuildsPending = false;
  mockRuns = [judged("passed")];
  mockRunsPending = false;
  mockRunsError = false;
  mockCounts = undefined;
  mockRunsRefetch.mockClear();
});

/** The summary card's Deployed cell — its overline label, not the status chip. */
function deployedCell(): HTMLElement {
  const label = screen
    .getAllByText("Deployed")
    .find((el) => el.className.includes("MuiTypography-overline"));
  if (!label?.parentElement) throw new Error("no Deployed cell");
  return label.parentElement;
}

describe("DeploymentVersionPage (#779)", () => {
  it("tells the live version's story, and offers Try Out", () => {
    mockCounts = { passed: 12, failed: 0, uncovered: 0, total: 12 };

    render(<DeploymentVersionPage projectName="expense" environment="development" version="v2" />);

    expect(screen.getAllByRole("heading", { name: /Development · v2/ })).toHaveLength(2);
    expect(screen.getByText("Milestone #2")).toBeInTheDocument();
    expect(screen.getByText("12 / 12 passed")).toBeInTheDocument();
    expect(screen.getByText("4e8a0d6")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /GitHub/ })).toHaveAttribute(
      "href",
      "https://github.com/acme/expense/commit/4e8a0d6f1c2b3a4d",
    );
    expect(screen.getByRole("link", { name: "View the build" })).toHaveAttribute("href", "/projects/expense/builds/v2");
    // What it runs there now, and the way to try it.
    expect(screen.getByText("Running here now")).toBeInTheDocument();
    expect(screen.getByText("Web")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /web\.dev\.example/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Try out/ })).toHaveAttribute(
      "href",
      "/projects/expense/deployments/development/try-out",
    );
    // The live row's binding stamp is the one Deployed value the platform holds.
    expect(within(deployedCell()).queryByText("—")).toBeNull();
  });

  it("says a superseded version was superseded, and by what — with no rollout stamp of its own", () => {
    render(<DeploymentVersionPage projectName="expense" environment="development" version="v1" />);

    expect(screen.getByText("Superseded")).toBeInTheDocument();
    expect(screen.getByText(/v1 was superseded — v2 runs in Development now\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open v2" })).toHaveAttribute(
      "href",
      "/projects/expense/deployments/development/v2",
    );
    expect(screen.queryByText("Running here now")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Try out/ })).not.toBeInTheDocument();
    expect(within(deployedCell()).getByText("—")).toBeInTheDocument();
  });

  it("says a version still building has not reached the environment", () => {
    render(<DeploymentVersionPage projectName="expense" environment="development" version="v3" />);
    expect(screen.getByText("Building")).toBeInTheDocument();
    expect(screen.getByText(/v3 is still building — it deploys to Development when its work merges\./)).toBeInTheDocument();
  });

  it("is a dead end with a way back for a version the ledger does not list", () => {
    render(<DeploymentVersionPage projectName="expense" environment="development" version="v7" />);
    expect(screen.getByText("No version called v7")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Deployments" })).toHaveAttribute("href", "/projects/expense/deployments");
  });

  it("holds the verdict while the run story is out, and says Unavailable with a retry when it fails", () => {
    mockRunsPending = true;
    const { unmount } = render(<DeploymentVersionPage projectName="expense" environment="development" version="v2" />);
    expect(screen.getByTestId("validation-cell-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("Not run")).not.toBeInTheDocument();
    unmount();

    mockRunsPending = false;
    mockRunsError = true;
    render(<DeploymentVersionPage projectName="expense" environment="development" version="v2" />);
    expect(screen.getByText(/The version's run story could not be loaded: runs down/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mockRunsRefetch).toHaveBeenCalled();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Not run")).not.toBeInTheDocument();
  });

  it("rejects a segment that names no environment", () => {
    render(<DeploymentVersionPage projectName="expense" environment="staging" version="v2" />);
    expect(screen.getByText("No environment called staging")).toBeInTheDocument();
  });
});
