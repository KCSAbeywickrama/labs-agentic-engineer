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
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { components } from "../../../generated/aep-api";

type Deployment = components["schemas"]["Deployment"];
type DeployStage = components["schemas"]["DeployStage"];
type MilestoneRunView = components["schemas"]["MilestoneRunView"];

// Router replaced so links render as plain anchors whose href is the resolved
// route path — no RouterProvider needed (mirrors DeploymentsPage.test.tsx).
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
  version: "v1",
  status: "deployed",
  components: { total: 2, ready: 2 },
  validation: "passed",
};
let mockDeployments: Deployment[] = [];
let mockComponentsPending = false;
let mockFailedCount = 0;

// The mock contract every service panel reads its endpoints from.
const MOCK_SPEC = `openapi: 3.0.0
info: { title: claims-api, version: 1.0.0 }
paths:
  /claims:
    get:
      summary: List claims
      responses: { "200": { description: OK } }
    post:
      summary: File a claim
      responses: { "201": { description: Created } }
  /claims/{id}:
    delete:
      summary: Withdraw
      responses: { "204": { description: Gone } }
`;
let mockContractError = false;
type ProjectDependencyReadiness = components["schemas"]["ProjectDependencyReadiness"];
let mockReadiness: ProjectDependencyReadiness | undefined;
const mockSaveValues = vi.fn();

vi.mock("../api/queries", () => ({
  useComponentOpenApi: (_p: string, componentName: string) => ({
    data: mockContractError ? undefined : { componentName, componentType: "service", spec: MOCK_SPEC },
    isPending: false,
    isError: mockContractError,
    error: mockContractError ? new Error("contract down") : null,
    refetch: vi.fn(),
  }),
  useProjectDependencyReadiness: () => ({ data: mockReadiness, isPending: false, isError: false }),
  useSaveConnectionValues: () => ({
    mutate: mockSaveValues,
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  useProjectComponents: () => ({
    data: {
      items: [
        { name: "claims-api", displayName: "claims-api", type: "service" },
        { name: "approvals-web", displayName: "approvals-web", type: "web-application" },
      ],
    },
    isPending: mockComponentsPending,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useComponentsDeployments: () => ({
    isPending: false,
    deployments: mockDeployments,
    failedCount: mockFailedCount,
  }),
  useProjectStatus: () => ({
    data: {
      repoUrl: "https://github.com/acme/expense.git",
      build: { version: "v1", status: "succeeded" },
      deploy: mockDeploy,
    },
  }),
}));

// The design's graph: the web app talks to the service; the service carries
// one external with values to collect and one platform resource.
type ComponentDependencies = components["schemas"]["ComponentDependencies"];
const mockDependencies: ComponentDependencies[] = [
  {
    componentName: "approvals-web",
    dependencies: [{ kind: "component", name: "claims-api" }],
  },
  {
    componentName: "claims-api",
    dependencies: [
      { kind: "platform-resource", name: "claims-db", resourceType: "postgres-cnpg" },
      { kind: "external", name: "stripe", config: [{ key: "STRIPE_SECRET_KEY", description: "Secret key", secret: true }] },
    ],
  },
];
let mockDependenciesPending = false;
vi.mock("../../spec/api/queries", () => ({
  useDesignDependencies: () => ({
    data: mockDependenciesPending ? undefined : mockDependencies,
    isPending: mockDependenciesPending,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("../../settings/api/queries", () => ({
  useExternalResources: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));

let mockRuns: MilestoneRunView[] = [];
let mockRunsPending = false;
vi.mock("../../builds/api/queries", () => ({
  useBuilds: () => ({
    data: [{ tag: "v1", milestoneNumber: 3, status: "completed", startedAt: "2026-08-14T16:20:00Z" }],
    isPending: false,
    isError: false,
  }),
  useBuildRuns: () => ({
    data: mockRunsPending ? undefined : { runs: mockRuns },
    isPending: mockRunsPending,
    isError: false,
  }),
}));

let mockCounts:
  | { passed: number; failed: number; uncovered: number; total: number }
  | undefined;
vi.mock("../../validation/api/counts", () => ({
  useValidationEvidence: () => ({
    verdict: "passed",
    repairing: false,
    ...(mockCounts ? { counts: mockCounts } : {}),
  }),
}));

// The roles read behind the Test users panel (ADR-0032: the panel lives on this
// page now). Empty by default so a green development shows the Thunder sentence
// alone; the panel's own cases inject accounts.
type ProjectTestUserState = components["schemas"]["ProjectTestUserState"];
let mockTestUsers: ProjectTestUserState[] = [];
let mockRolesPending = false;
vi.mock("../../spec/api/roles", () => ({
  useProjectRoles: () => ({
    data: { directoryAvailable: true, roles: [], testUsers: mockTestUsers },
    isPending: mockRolesPending,
    isError: false,
  }),
  useRevealTestUserPassword: () => ({
    mutateAsync: vi.fn(async (username: string) => ({ username, password: "mocknotreal", rotatedAt: null })),
    isPending: false,
  }),
}));

// The contract viewer is a dialog over its own query; only its opening is
// under test here.
const openApiDialog = vi.fn();
vi.mock("./ComponentOpenApiDialog", () => ({
  ComponentOpenApiDialog: (props: { componentName: string | null }) => {
    openApiDialog(props.componentName);
    return null;
  },
}));

import { DeploymentDetailPage } from "./DeploymentDetailPage";

const devDeployments = (): Deployment[] => [
  {
    componentName: "claims-api",
    environment: "development",
    status: "Ready",
    releaseName: "claims-api-v1-4e8a0d6",
    endpointUrl: "https://api.dev.expense.localhost/claims",
    createdAt: "2026-08-14T16:54:00Z",
  },
  {
    componentName: "approvals-web",
    environment: "development",
    status: "Ready",
    releaseName: "approvals-web-v1-4e8a0d6",
    endpointUrl: "https://approvals.dev.expense.localhost",
    createdAt: "2026-08-14T16:52:00Z",
  },
];

beforeEach(() => {
  mockDeploy = {
    version: "v1",
    status: "deployed",
    components: { total: 2, ready: 2 },
    validation: "passed",
  };
  mockDeployments = devDeployments();
  mockComponentsPending = false;
  mockFailedCount = 0;
  mockRuns = [];
  mockRunsPending = false;
  mockCounts = undefined;
  mockTestUsers = [];
  mockRolesPending = false;
  mockContractError = false;
  mockReadiness = undefined;
  mockDependenciesPending = false;
  mockSaveValues.mockClear();
  openApiDialog.mockClear();
});

describe("DeploymentDetailPage", () => {
  it("names the environment and version, and links the build that shipped it", () => {
    mockCounts = { passed: 24, failed: 0, uncovered: 0, total: 24 };
    mockRuns = [
      {
        id: "run-1",
        kind: "dev",
        milestoneNumber: 3,
        createdAt: "2026-08-14T16:20:00Z",
        cycles: [
          {
            id: "c1",
            kind: "coding",
            mergeSha: "4e8a0d6f1c2b3a4d",
            createdAt: "2026-08-14T16:20:00Z",
          },
        ],
      } as MilestoneRunView,
    ];

    render(<DeploymentDetailPage projectName="expense" environment="development" />);

    // The page title and the summary card's own header both name it.
    expect(screen.getAllByRole("heading", { name: /Development · v1/ })).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: "View the build that shipped this" }),
    ).toHaveAttribute("href", "/projects/expense/builds/v1");
    // The summary card's facts.
    expect(screen.getByText("Milestone #3")).toBeInTheDocument();
    expect(screen.getByText("24 / 24 passed")).toBeInTheDocument();
    // The commit that shipped it, short, linked on the repo's web root — the
    // `.git` suffix stripped from the platform's clone url.
    expect(screen.getByText("4e8a0d6")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /GitHub/ })).toHaveAttribute(
      "href",
      "https://github.com/acme/expense/commit/4e8a0d6f1c2b3a4d",
    );
  });

  it("gives each component its own way in", () => {
    render(<DeploymentDetailPage projectName="expense" environment="development" />);

    expect(screen.getByText(/2 of 2 components live/)).toBeInTheDocument();
    // A web application is visited; a service opens its contract.
    expect(screen.getByRole("link", { name: "Visit approvals-web" })).toHaveAttribute(
      "href",
      "https://approvals.dev.expense.localhost",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try claims-api API" }));
    expect(openApiDialog).toHaveBeenLastCalledWith("claims-api");
    // Every bound component's URL is on its second line.
    expect(
      screen.getByRole("link", { name: /api.dev.expense.localhost\/claims/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("claims-api-v1-4e8a0d6")).toBeInTheDocument();
  });

  it("says a version has no commit rather than guessing one", () => {
    // The run story answered with no merged cycle — a version tagged before
    // the platform kept run rows.
    render(<DeploymentDetailPage projectName="expense" environment="development" />);

    const commit = screen.getByText("Commit").parentElement;
    expect(commit).not.toBeNull();
    expect(within(commit as HTMLElement).getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /GitHub/ })).not.toBeInTheDocument();
  });

  it("reads production from its bindings, with no version and no validation", () => {
    mockDeployments = [
      {
        componentName: "claims-api",
        environment: "production",
        status: "Ready",
        releaseName: "claims-api-prod",
        createdAt: "2026-08-15T09:00:00Z",
      },
    ];

    render(<DeploymentDetailPage projectName="expense" environment="production" />);

    // No version to name: the aggregate describes development only.
    expect(screen.getByRole("heading", { name: "Production" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "View the build that shipped this" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/1 of 1 components live/)).toBeInTheDocument();
    // Only the bound component is listed for production.
    expect(screen.queryByText("approvals-web")).not.toBeInTheDocument();
  });

  it("is honest about an empty environment", () => {
    mockDeployments = [];

    render(<DeploymentDetailPage projectName="expense" environment="production" />);

    expect(
      screen.getByText(/Nothing deployed here yet — promote a validated version/),
    ).toBeInTheDocument();
  });

  it("does not call an environment empty when the reads that would say so failed", () => {
    // Every list-deployments read failed, so nothing is bound — but that is
    // ignorance, not emptiness, and the page must not report it as emptiness.
    mockDeployments = [];
    mockFailedCount = 2;

    render(<DeploymentDetailPage projectName="expense" environment="development" />);

    expect(
      screen.getByText(/Deployments for 2 components could not be loaded/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Nothing deployed here yet/)).not.toBeInTheDocument();
  });

  it("still says nothing is deployed when every read answered", () => {
    mockDeployments = [];
    mockFailedCount = 0;

    render(<DeploymentDetailPage projectName="expense" environment="development" />);

    expect(
      screen.getByText(/Nothing deployed here yet — agents deploy to development/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument();
  });

  it("rejects a segment that names no environment", () => {
    render(<DeploymentDetailPage projectName="expense" environment="staging" />);

    expect(screen.getByText("No environment called staging")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Deployments" })).toHaveAttribute(
      "href",
      "/projects/expense/deployments",
    );
  });
});

describe("DeploymentDetailPage — test users", () => {
  it("carries the test users when every component in development is live", () => {
    mockTestUsers = [
      {
        username: "test-viewer",
        roleName: "Viewer",
        coldStart: true,
        exists: true,
        owned: true,
        supplied: false,
      },
    ];
    render(<DeploymentDetailPage projectName="expense" environment="development" />);
    // Inside the web app's panel, the accounts that sign in to it.
    expect(screen.getByText("Sign in with a test user")).toBeInTheDocument();
    expect(screen.getByText("1 account · one per role · Development only")).toBeInTheDocument();
    expect(screen.getByText("test-viewer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reveal the password for test-viewer" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Thunder Console to add or remove real accounts" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/sign in with a test user below/)).toBeInTheDocument();
  });

  it("keeps the panel off a converging development, and off production", () => {
    mockDeploy = { ...mockDeploy, status: "deploying" };
    const { unmount } = render(
      <DeploymentDetailPage projectName="expense" environment="development" />,
    );
    expect(screen.queryByText("Sign in with a test user")).toBeNull();
    unmount();

    mockDeploy = { ...mockDeploy, status: "deployed" };
    mockDeployments = devDeployments().map((d) => ({ ...d, environment: "production" }));
    render(<DeploymentDetailPage projectName="expense" environment="production" />);
    expect(screen.queryByText("Sign in with a test user")).toBeNull();
  });
});

describe("DeploymentDetailPage — try it out (ADR-0032)", () => {
  it("lists a service's endpoints off its contract, with a curl for the deployed URL", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<DeploymentDetailPage projectName="expense" environment="development" />);

    const list = screen.getByRole("list", { name: "claims-api endpoints" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("GET/claims List claims"),
      expect.stringContaining("POST/claims File a claim"),
      expect.stringContaining("DELETE/claims/{id} Withdraw"),
    ]);
    // The header counts them.
    expect(screen.getByText(/· service · 3 endpoints/)).toBeInTheDocument();

    fireEvent.click(within(rows[0]!).getByRole("button", { name: "Copy a curl for GET /claims" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const curl = writeText.mock.calls[0]?.[0] as string;
    expect(curl).toBe(
      [
        "curl -X GET 'https://api.dev.expense.localhost/claims/claims'",
        "-H 'Accept: application/json'",
        "-H 'Authorization: Bearer <token>'",
      ].join(" \\\n  "),
    );
    // …and the chosen command expands under the list.
    expect(screen.getByText(/curl -X GET 'https:\/\/api\.dev\.expense\.localhost\/claims\/claims'/)).toBeInTheDocument();

    // Try opens the contract viewer on that service.
    fireEvent.click(within(rows[1]!).getByRole("button", { name: "Try POST /claims" }));
    expect(openApiDialog).toHaveBeenLastCalledWith("claims-api");
  });

  it("filters the endpoints by method and by text", () => {
    render(<DeploymentDetailPage projectName="expense" environment="development" />);

    fireEvent.click(screen.getByRole("button", { name: "DELETE" }));
    let rows = within(screen.getByRole("list", { name: "claims-api endpoints" })).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain("/claims/{id}");

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search claims-api endpoints" }), {
      target: { value: "file" },
    });
    rows = within(screen.getByRole("list", { name: "claims-api endpoints" })).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain("File a claim");
  });

  it("says the contract could not be loaded rather than showing no endpoints", () => {
    mockContractError = true;
    render(<DeploymentDetailPage projectName="expense" environment="development" />);
    expect(screen.getByText(/The contract could not be loaded: contract down/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "claims-api endpoints" })).not.toBeInTheDocument();
  });

  it("gives the web app its Visit, its URL copy, and who it talks to", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<DeploymentDetailPage projectName="expense" environment="development" />);

    expect(screen.getByRole("link", { name: "Visit approvals-web" })).toHaveAttribute(
      "href",
      "https://approvals.dev.expense.localhost",
    );
    expect(screen.getByText(/Talks to/)).toHaveTextContent("Talks to claims-api on this environment");
    fireEvent.click(screen.getByRole("button", { name: "Copy the URL of approvals-web" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://approvals.dev.expense.localhost"));
  });
});

describe("DeploymentDetailPage — connections (ADR-0032)", () => {
  it("tables the design's connections with their keys masked and the readiness word", () => {
    mockReadiness = {
      configured: false,
      dependencies: [{ name: "stripe", state: "unset", missingKeys: ["STRIPE_SECRET_KEY"] }],
    };

    render(<DeploymentDetailPage projectName="expense" environment="development" />);

    const table = screen.getByRole("table", { name: "Connections on Development" });
    expect(screen.getByText("2 dependencies · values for Development")).toBeInTheDocument();
    const stripe = within(table).getByRole("row", { name: "stripe" });
    expect(within(stripe).getByText("used by claims-api")).toBeInTheDocument();
    expect(within(stripe).getByText("External")).toBeInTheDocument();
    expect(within(stripe).getByText(/STRIPE_SECRET_KEY/)).toBeInTheDocument();
    expect(within(stripe).queryByText(/sk_/)).not.toBeInTheDocument();
    expect(within(stripe).getByText("Missing")).toBeInTheDocument();
    const db = within(table).getByRole("row", { name: "claims-db" });
    expect(within(db).getByText("postgres-cnpg")).toBeInTheDocument();
    expect(within(db).getByText("Provisioned")).toBeInTheDocument();
    expect(within(db).getByRole("link", { name: "View claims-db in the design" })).toHaveAttribute(
      "href",
      "/projects/expense/spec",
    );

    // Edit re-collects the external's development values.
    fireEvent.click(within(stripe).getByRole("button", { name: "Edit stripe values" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Configure — stripe")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("STRIPE_SECRET_KEY"), { target: { value: "sk_live_real" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save values/ }));
    expect(mockSaveValues).toHaveBeenCalledWith(
      { name: "stripe", environment: "development", values: { STRIPE_SECRET_KEY: "sk_live_real" } },
      expect.anything(),
    );
  });

  it("offers no Edit on production, where nothing collects values", () => {
    mockDeployments = devDeployments().map((d) => ({ ...d, environment: "production" }));
    render(<DeploymentDetailPage projectName="expense" environment="production" />);
    expect(screen.getByRole("table", { name: "Connections on Production" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /in the design$/ })).toHaveLength(2);
  });

  it("holds the table back while the design read is out", () => {
    mockDependenciesPending = true;
    render(<DeploymentDetailPage projectName="expense" environment="development" />);
    expect(screen.queryByRole("table", { name: /^Connections/ })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "claims-api endpoints" })).toBeInTheDocument();
  });
});
