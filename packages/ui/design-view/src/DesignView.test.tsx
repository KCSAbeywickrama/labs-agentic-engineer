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
import { DesignView } from "./DesignView.js";

function designJson(deps: unknown[]): string {
  return JSON.stringify({
    name: "checkout-api",
    type: "service",
    version: "0.1.0",
    dependencies: deps,
  });
}

describe("DesignView — dependency status cards (#252 Task 9)", () => {
  it("renders without dependencyStatus/onResolveDependency — existing callers unaffected", () => {
    render(<DesignView design={designJson([{ kind: "external", name: "stripe" }])} />);
    expect(screen.getByText("stripe")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /resolve in chat/i }),
    ).not.toBeInTheDocument();
    // No status chip either — none of the known labels should appear.
    expect(screen.queryByText("Resolved")).not.toBeInTheDocument();
  });

  it("resolved: shows a Resolved chip and no Resolve in chat button", () => {
    render(
      <DesignView
        design={designJson([{ kind: "component", name: "orders-api" }])}
        dependencyStatus={{ "orders-api": { status: "resolved" } }}
        onResolveDependency={vi.fn()}
      />,
    );
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /resolve in chat/i }),
    ).not.toBeInTheDocument();
  });

  it("ambiguous: shows an Ambiguous chip, renders candidates with Docs links, and Resolve in chat fires the callback with the dependency name", () => {
    const onResolve = vi.fn();
    render(
      <DesignView
        design={designJson([
          {
            kind: "external",
            name: "payments",
            candidates: [
              {
                name: "stripe",
                style: "sdk",
                docsUrl: "https://stripe.com/docs",
                package: "npm:stripe",
              },
              {
                name: "adyen",
                style: "rest-api",
                docsUrl: "https://adyen.com/docs",
              },
            ],
          },
        ])}
        dependencyStatus={{ payments: { status: "ambiguous" } }}
        onResolveDependency={onResolve}
      />,
    );

    expect(screen.getByText("Ambiguous")).toBeInTheDocument();
    expect(screen.getByText("stripe")).toBeInTheDocument();
    expect(screen.getByText("adyen")).toBeInTheDocument();

    const docsLinks = screen.getAllByRole("link", { name: "Docs" });
    expect(docsLinks).toHaveLength(2);
    expect(docsLinks[0]).toHaveAttribute("href", "https://stripe.com/docs");
    expect(docsLinks[1]).toHaveAttribute("href", "https://adyen.com/docs");

    fireEvent.click(screen.getByRole("button", { name: /resolve in chat/i }));
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith("payments");
  });

  it("unresolved + reason: shows an Unresolved chip, the mapped reason, and the button", () => {
    render(
      <DesignView
        design={designJson([{ kind: "external", name: "sms-gateway", style: "sdk" }])}
        dependencyStatus={{
          "sms-gateway": { status: "unresolved", reason: "needs-input" },
        }}
        onResolveDependency={vi.fn()}
      />,
    );
    expect(screen.getByText("Unresolved")).toBeInTheDocument();
    expect(screen.getByText("needs input")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /resolve in chat/i }),
    ).toBeInTheDocument();
  });

  it("blocked (org-service access-required): shows a Blocked chip, the reason, and the button", () => {
    render(
      <DesignView
        design={designJson([{ kind: "org-service", name: "identity-api" }])}
        dependencyStatus={{
          "identity-api": { status: "blocked", reason: "access-required" },
        }}
        onResolveDependency={vi.fn()}
      />,
    );
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("access required")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /resolve in chat/i }),
    ).toBeInTheDocument();
  });

  it("no status entry for a dependency (map wired but not yet loaded for this one): no chip, no button", () => {
    render(
      <DesignView
        design={designJson([{ kind: "external", name: "unknown-dep" }])}
        dependencyStatus={{}}
        onResolveDependency={vi.fn()}
      />,
    );
    expect(screen.queryByText("Resolved")).not.toBeInTheDocument();
    expect(screen.queryByText("Ambiguous")).not.toBeInTheDocument();
    expect(screen.queryByText("Unresolved")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /resolve in chat/i }),
    ).not.toBeInTheDocument();
  });

  it("renders sources as links to the raw URL", () => {
    render(
      <DesignView
        design={designJson([
          {
            kind: "external",
            name: "stripe",
            sources: ["https://stripe.com/docs", "https://npmjs.com/stripe"],
          },
        ])}
        dependencyStatus={{ stripe: { status: "resolved" } }}
      />,
    );
    expect(
      screen.getByRole("link", { name: "https://stripe.com/docs" }),
    ).toHaveAttribute("href", "https://stripe.com/docs");
    expect(
      screen.getByRole("link", { name: "https://npmjs.com/stripe" }),
    ).toHaveAttribute("href", "https://npmjs.com/stripe");
  });

  it("renders config keys, marking exactly the secret one with the secret chip's icon", () => {
    render(
      <DesignView
        design={designJson([
          {
            kind: "external",
            name: "stripe",
            config: [
              { key: "STRIPE_API_KEY", secret: true },
              { key: "STRIPE_REGION" },
            ],
          },
        ])}
      />,
    );
    expect(screen.getByText("STRIPE_API_KEY")).toBeInTheDocument();
    expect(screen.getByText("STRIPE_REGION")).toBeInTheDocument();
    expect(screen.getAllByTestId("secret-icon")).toHaveLength(1);
  });
});

// #252 Task 15: cross-component "Used by" — the console computes this map
// across every component's dependencies (this package has no notion of
// "other components" of its own) and passes only the slice for the
// currently-rendered design.
describe("DesignView — cross-component 'Used by' (#252 Task 15)", () => {
  it('renders a "Used by" line listing every consuming component when 2+ are present', () => {
    render(
      <DesignView
        design={designJson([
          { kind: "platform-resource", name: "thunder-app", resourceType: "auth" },
        ])}
        dependencyUsedBy={{ "thunder-app": ["auth-service", "web-frontend"] }}
      />,
    );
    expect(screen.getByText(/used by/i)).toBeInTheDocument();
    expect(screen.getByText("auth-service")).toBeInTheDocument();
    expect(screen.getByText("web-frontend")).toBeInTheDocument();
  });

  it('renders no "Used by" line when the dependency has no entry (component-local, the common case)', () => {
    render(
      <DesignView
        design={designJson([{ kind: "external", name: "stripe" }])}
        dependencyUsedBy={{}}
      />,
    );
    expect(screen.queryByText(/used by/i)).not.toBeInTheDocument();
  });

  it('renders no "Used by" line for a single-entry (self-only) usedBy list', () => {
    render(
      <DesignView
        design={designJson([{ kind: "external", name: "stripe" }])}
        dependencyUsedBy={{ stripe: ["checkout-api"] }}
      />,
    );
    expect(screen.queryByText(/used by/i)).not.toBeInTheDocument();
  });

  it("renders without dependencyUsedBy at all — existing callers unaffected", () => {
    render(
      <DesignView design={designJson([{ kind: "external", name: "stripe" }])} />,
    );
    expect(screen.queryByText(/used by/i)).not.toBeInTheDocument();
  });
});
