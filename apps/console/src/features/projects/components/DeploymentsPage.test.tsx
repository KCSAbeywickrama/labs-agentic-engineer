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

// The design's dependency read (the promote dialog's connection list, and
// the Configure button's own gate) — overridden per test; defaults to one
// required external connection, reset in beforeEach so a test that mutates
// it can't bleed into the next.
const DEFAULT_DEPENDENCIES: ComponentDependencies[] = [
  {
    componentName: "storefront",
    dependencies: [
      {
        kind: "external",
        name: "stripe",
        config: [
          { key: "STRIPE_SECRET_KEY", description: "Secret key", secret: true },
        ],
      },
    ],
  },
];
let mockDependencies: ComponentDependencies[] = DEFAULT_DEPENDENCIES;

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

// The connection-values dialog's mutation is mocked at module level so opening
// it needs no QueryClientProvider; mutate is captured for the save assertion.
const mockMutate = vi.fn();

vi.mock("../api/queries", () => ({
  useSaveConnectionValues: () => ({
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
  mockDependencies = DEFAULT_DEPENDENCIES;
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

    // The card header is the deploy-lifecycle chip itself — no heading.
    expect(screen.getByText("Deployed")).toBeInTheDocument();
    // The place stages name themselves as environments (#401 feedback);
    // Validation is the check between them, not a place.
    expect(screen.getByText("Development environment")).toBeInTheDocument();
    expect(screen.getByText("Validation")).toBeInTheDocument();
    expect(screen.getByText("Production environment")).toBeInTheDocument();
    // The side panel's scoped section label keeps the short name.
    expect(screen.getByText("Production")).toBeInTheDocument();
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

describe("DeploymentsPage — connections", () => {
  it("re-collects an external connection's values from the side panel", () => {
    mockDeploy = {
      version: "v1",
      status: "deployed",
      components: { total: 1, ready: 1 },
      validation: "passed",
    };

    render(<DeploymentsPage projectName="acme" />);

    // Exactly ONE Configure on screen — the side panel's connection action;
    // the rail rows stay uniform with no per-row extras.
    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("Configure — stripe"),
    ).toBeInTheDocument();

    // Write-only: the field opens empty and masked, never echoing a stored
    // value; Save enables once every value is set.
    // The key labels the field; the description renders as helper text.
    const field = within(dialog).getByLabelText("STRIPE_SECRET_KEY");
    expect(within(dialog).getByText("Secret key")).toBeInTheDocument();
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveValue("");
    const saveButton = within(dialog).getByRole("button", { name: /Save values/ });
    expect(saveButton).toBeDisabled();
    fireEvent.change(field, { target: { value: "sk_live_real" } });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    expect(mockMutate).toHaveBeenCalledWith(
      {
        name: "stripe",
        environment: "development",
        values: { STRIPE_SECRET_KEY: "sk_live_real" },
      },
      expect.anything(),
    );
  });

  it("shows platform-provisioned connections without an update action", () => {
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
          { kind: "component", name: "orders-api" },
          { kind: "platform-resource", name: "shop-db", resourceType: "postgres-cnpg" },
        ],
      },
    ];

    render(<DeploymentsPage projectName="acme" />);

    expect(screen.getByText("shop-db (postgres-cnpg)")).toBeInTheDocument();
    expect(screen.getByText("provisioned")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Configure" }),
    ).not.toBeInTheDocument();
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

    fireEvent.change(within(dialog).getByLabelText(/STRIPE_SECRET_KEY/), {
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
            kind: "external",
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
