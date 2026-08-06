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

// Router replaced so the internal-link chip renders as a plain anchor whose
// href is the resolved route path, and the PageHeader back-link as a plain
// anchor — no RouterProvider needed (mirrors NotFound.test.tsx).
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

import { DeploymentsPage } from "./DeploymentsPage";

type ProjectStatus = components["schemas"]["ProjectStatus"];
type DeployStage = components["schemas"]["DeployStage"];
type ComponentDependencies = components["schemas"]["ComponentDependencies"];

// Query hooks replaced wholesale — no QueryClientProvider / MSW needed, only the
// rendering under test is real (mirrors TasksList.test.tsx).
let mockDeploy: DeployStage = {
  version: "v1",
  status: "deployed",
  components: { total: 1, ready: 1 },
  validation: "none",
};

// The design's dependency read (the promote dialog's connection list) —
// overridden per test; defaults to one required external connection.
let mockDependencies: ComponentDependencies[] = [
  {
    componentName: "storefront",
    dependencies: [
      {
        kind: "external-config",
        name: "stripe",
        config: [
          { key: "STRIPE_SECRET_KEY", description: "Secret key", secret: true },
        ],
      },
    ],
  },
];

function status(): ProjectStatus {
  return {
    phase: "components",
    repoStatus: "ready",
    repoUrl: "https://github.com/acme/demo",
    hasSpec: true,
    hasDesign: true,
    hasTasks: true,
    specStatus: "approved",
    designStatus: "approved",
    spec: { exists: true, version: "v1", dirty: false, design: true },
    build: { version: "v1", status: "succeeded" },
    deploy: mockDeploy,
  };
}

// The config dialog's hooks are mocked at module level so opening it needs no
// QueryClientProvider; mutate is captured for the save assertion.
const mockMutate = vi.fn();

vi.mock("../api/queries", () => ({
  useComponentConfig: () => ({
    data: {
      id: "cfg-storefront",
      projectName: "acme",
      componentName: "storefront",
      envVars: [{ key: "LOG_LEVEL", value: "info" }],
      createdAt: "2026-07-12T05:00:00Z",
      updatedAt: "2026-07-12T05:00:00Z",
    },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpdateComponentConfig: () => ({
    mutate: mockMutate,
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  useProjectComponents: () => ({
    data: { items: [{ name: "storefront", displayName: "Storefront", type: "web-application" }] },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useComponentsDeployments: () => ({
    isPending: false,
    deployments: [
      {
        componentName: "storefront",
        environment: "development",
        status: "Ready",
        endpointUrl: "https://storefront.dev.example.com",
      },
    ],
    failedCount: 0,
  }),
  useProjectStatus: () => ({ data: status() }),
}));

vi.mock("../../spec/api/queries", () => ({
  useDesignDependencies: () => ({ data: mockDependencies, isPending: false }),
}));

// Criteria counts (#395 decision 3) — undefined by default (the fallback
// path); individual tests set it to assert the "n/m passed" upgrade.
let mockCounts: { passed: number; total: number } | undefined;

vi.mock("../../validation/api/counts", () => ({
  useValidationCounts: () => mockCounts,
}));

beforeEach(() => {
  mockCounts = undefined;
  mockMutate.mockClear();
});

describe("DeploymentsPage — validation chip", () => {
  it("routes a RUNNING validation to the Validation page", () => {
    mockDeploy = {
      version: "v1",
      status: "deployed",
      components: { total: 1, ready: 1 },
      validation: "running",
    };

    render(<DeploymentsPage projectName="acme" />);

    const chip = screen.getByRole("link", { name: /^Validating$/ });
    expect(chip).toHaveAttribute("href", "/projects/acme/validation");
    // Internal navigation, not a new-tab external link.
    expect(chip).not.toHaveAttribute("target");
  });

  it("routes a FAILED validation to the Validation page", () => {
    mockDeploy = {
      version: "v1",
      status: "deployed",
      components: { total: 1, ready: 1 },
      validation: "failed",
    };

    render(<DeploymentsPage projectName="acme" />);

    const chip = screen.getByRole("link", { name: /^Validation failed$/ });
    expect(chip).toHaveAttribute("href", "/projects/acme/validation");
    expect(chip).not.toHaveAttribute("target");
  });

  it("routes a PASSED validation to the Validation page", () => {
    mockDeploy = {
      version: "v1",
      status: "deployed",
      components: { total: 1, ready: 1 },
      validation: "passed",
    };

    render(<DeploymentsPage projectName="acme" />);

    const chip = screen.getByRole("link", { name: /^Validated$/ });
    expect(chip).toHaveAttribute("href", "/projects/acme/validation");
    expect(chip).not.toHaveAttribute("target");
  });

  it("renders no validation chip or verdict when there is nothing to validate", () => {
    mockDeploy = {
      version: "v1",
      status: "deployed",
      components: { total: 1, ready: 1 },
      validation: "none",
    };

    render(<DeploymentsPage projectName="acme" />);

    // The rail's Validation STAGE is still on screen (it is a stage of the
    // story), but with no verdict there is no chip and no report link.
    expect(screen.queryByRole("link", { name: /Validat/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/View full report/)).not.toBeInTheDocument();
  });
});

describe("DeploymentsPage — story rail", () => {
  it("tells the three-stage story with the dev version and rollout facts", () => {
    mockDeploy = {
      version: "v1",
      status: "deployed",
      components: { total: 1, ready: 1 },
      validation: "passed",
    };

    render(<DeploymentsPage projectName="acme" />);

    expect(screen.getByText("What is running")).toBeInTheDocument();
    expect(screen.getByText("Development")).toBeInTheDocument();
    expect(screen.getByText("Validation")).toBeInTheDocument();
    // Twice: the rail's stage and the side panel's section share the name.
    expect(screen.getAllByText("Production")).toHaveLength(2);
    expect(screen.getByText("1 of 1 components ready")).toBeInTheDocument();
    // The side panel's at-a-glance facts.
    expect(screen.getByText("1 / 1 ready")).toBeInTheDocument();
    expect(screen.getByText("Nothing deployed yet")).toBeInTheDocument();
  });

  it("upgrades the validation fact and banner with criteria counts", () => {
    mockDeploy = {
      version: "v1",
      status: "deployed",
      components: { total: 1, ready: 1 },
      validation: "passed",
    };
    mockCounts = { passed: 12, total: 12 };

    render(<DeploymentsPage projectName="acme" />);

    expect(screen.getByText("12/12 passed")).toBeInTheDocument();
    expect(
      screen.getByText("Validated — 12 of 12 criteria passed on this deployment."),
    ).toBeInTheDocument();
  });
});

describe("DeploymentsPage — component configuration", () => {
  it("opens the env-var editor from a dev row and saves the full list", () => {
    mockDeploy = {
      version: "v1",
      status: "deployed",
      components: { total: 1, ready: 1 },
      validation: "passed",
    };

    render(<DeploymentsPage projectName="acme" />);

    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("Configuration — Storefront"),
    ).toBeInTheDocument();
    // Seeded from the read.
    expect(within(dialog).getByDisplayValue("LOG_LEVEL")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByDisplayValue("info"), {
      target: { value: "debug" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(mockMutate).toHaveBeenCalledWith(
      { envVars: [{ key: "LOG_LEVEL", value: "debug" }] },
      expect.anything(),
    );
  });
});

describe("DeploymentsPage — promotion", () => {
  it("opens the promote dialog and gates Promote on required values", () => {
    mockDeploy = {
      version: "v1",
      status: "deployed",
      components: { total: 1, ready: 1 },
      validation: "passed",
    };

    render(<DeploymentsPage projectName="acme" />);

    fireEvent.click(
      screen.getByRole("button", { name: /Promote v1 to production/ }),
    );

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/1 connection needs production values/),
    ).toBeInTheDocument();
    const promote = within(dialog).getByRole("button", { name: /^Promote$/ });
    expect(promote).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/Secret key/), {
      target: { value: "sk_live_x" },
    });
    expect(promote).toBeEnabled();
  });

  it("disables the promote entry point while validation is failing", () => {
    mockDeploy = {
      version: "v1",
      status: "deployed",
      components: { total: 1, ready: 1 },
      validation: "failed",
    };

    render(<DeploymentsPage projectName="acme" />);

    expect(
      screen.getByRole("button", { name: /Promote v1 to production/ }),
    ).toBeDisabled();
  });

  it("counts platform-provisioned connections as already set", () => {
    mockDeploy = {
      version: "v1",
      status: "deployed",
      components: { total: 1, ready: 1 },
      validation: "passed",
    };
    mockDependencies = [
      {
        componentName: "storefront",
        dependencies: [
          // Component wiring never surfaces as a connection…
          { kind: "component", name: "orders-api" },
          // …a config-less platform resource needs nothing…
          { kind: "platform-resource", name: "shop-db", resourceType: "postgres-cnpg" },
          // …and a defaulted key arrives already set.
          {
            kind: "external-config",
            name: "stripe",
            config: [{ key: "KEY", description: "Key", defaultValue: "k" }],
          },
        ],
      },
    ];

    render(<DeploymentsPage projectName="acme" />);

    expect(screen.getByText("2 / 2 set")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /Promote v1 to production/ }),
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("Provisioned by platform"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /^Promote$/ }),
    ).toBeEnabled();
  });
});
