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
import { BuildDependencyDrawer } from "./BuildDependencyDrawer";

type PreflightItem = components["schemas"]["PreflightItem"];
type BuildInputItem = components["schemas"]["BuildInputItem"];

const ITEMS: PreflightItem[] = [
  {
    component: "checkout-api",
    dependency: "stripe-config",
    kind: "external-config",
    description: "Stripe API credentials",
    config: [
      { key: "STRIPE_API_KEY", secret: true, description: "Your Stripe secret API key" },
      { key: "STRIPE_WEBHOOK_ID", secret: false },
    ],
  },
  {
    component: "checkout-api",
    dependency: "partner-openapi-spec",
    kind: "external-spec",
    description: "Partner API spec",
  },
  {
    component: "checkout-api",
    dependency: "postgres",
    kind: "platform-resource",
    description: "Postgres database",
    resourceType: "postgres",
  },
  {
    component: "checkout-api",
    dependency: "billing-service",
    kind: "org-service",
    description: "Billing service endpoint",
  },
];

function setup(items: PreflightItem[] = ITEMS, submitting = false) {
  const onClose = vi.fn();
  const onContinue = vi.fn();
  const onResolveDependency = vi.fn();
  render(
    <BuildDependencyDrawer
      open
      items={items}
      submitting={submitting}
      onClose={onClose}
      onContinue={onContinue}
      onResolveDependency={onResolveDependency}
    />,
  );
  return { onClose, onContinue, onResolveDependency };
}

describe("BuildDependencyDrawer", () => {
  it("renders a sub-panel per dependency kind present in items", () => {
    setup();

    expect(screen.getByText(/stripe-config/i)).toBeInTheDocument();
    expect(screen.getByText(/partner-openapi-spec/i)).toBeInTheDocument();
    expect(screen.getAllByText(/postgres/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/billing-service/i)).toBeInTheDocument();
  });

  it("shows platform-resource and org-service as informational (no approval checkbox)", () => {
    setup();

    // Continue is the approval, so these kinds render as title + description
    // only — there is no per-item checkbox to toggle.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getAllByText(/postgres/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/billing-service/i)).toBeInTheDocument();
  });

  // A single informational platform-resource requires no input, so Continue is enabled on
  // its own — the ideal fixture to prove that `submitting` is what disables it.
  const PLATFORM_ONLY: PreflightItem[] = [
    {
      component: "api",
      dependency: "notes-db",
      kind: "platform-resource",
      description: "Provision this postgres-cnpg for you",
      resourceType: "postgres-cnpg",
    },
  ];

  it("keeps Continue enabled for an informational platform-resource when not submitting", () => {
    setup(PLATFORM_ONLY, false);
    expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled();
  });

  it("shows a spinner on Continue and disables both buttons while submitting", () => {
    const { onContinue } = setup(PLATFORM_ONLY, true);

    const continueButton = screen.getByRole("button", { name: /continue/i });
    // Disabled despite no input being required — the in-flight build is what
    // blocks it, so the request can't be double-submitted.
    expect(continueButton).toBeDisabled();
    // The Continue button (not the Build button behind the drawer) carries the
    // spinner while POST /build is in flight.
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    // Cancel is locked so the drawer can't be dismissed mid-call.
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();

    fireEvent.click(continueButton);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("disables Continue until external-config values and external-spec url/content are filled", () => {
    setup();

    const continueButton = screen.getByRole("button", { name: /continue/i });
    expect(continueButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/STRIPE_API_KEY/i), {
      target: { value: "sk_test_123" },
    });
    fireEvent.change(screen.getByLabelText(/STRIPE_WEBHOOK_ID/i), {
      target: { value: "whsec_456" },
    });
    expect(continueButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/spec url/i), {
      target: { value: "https://example.com/openapi.json" },
    });

    expect(continueButton).toBeEnabled();
  });

  it("renders a config key's description as helper text under the field", () => {
    setup();

    expect(
      screen.getByText(/Your Stripe secret API key/i),
    ).toBeInTheDocument();
  });

  // defaultValue pre-fills a NON-secret field so the user starts from a sensible
  // suggestion (a region, a base URL); a secret key never carries a default an
  // agent could invent, and the drawer must never pre-fill one even defensively.
  const DEFAULTS: PreflightItem[] = [
    {
      component: "checkout-api",
      dependency: "aws-config",
      kind: "external-config",
      description: "AWS region + credentials",
      config: [
        { key: "AWS_REGION", secret: false, defaultValue: "us-east-1" },
        { key: "AWS_SECRET_KEY", secret: true, defaultValue: "must-not-prefill" },
      ],
    },
  ];

  it("pre-fills a non-secret config key with its defaultValue", () => {
    setup(DEFAULTS);

    expect(screen.getByLabelText(/AWS_REGION/i)).toHaveValue("us-east-1");
  });

  it("never pre-fills a secret config key even when a defaultValue is present", () => {
    setup(DEFAULTS);

    expect(screen.getByLabelText(/AWS_SECRET_KEY/i)).toHaveValue("");
  });

  it("masks secret config fields as password inputs", () => {
    setup();

    expect(screen.getByLabelText(/STRIPE_API_KEY/i)).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByLabelText(/STRIPE_WEBHOOK_ID/i)).not.toHaveAttribute(
      "type",
      "password",
    );
  });

  it("emits BuildInputItem[] on Continue with approvals true and typed values", () => {
    const { onContinue } = setup();

    fireEvent.change(screen.getByLabelText(/STRIPE_API_KEY/i), {
      target: { value: "sk_test_123" },
    });
    fireEvent.change(screen.getByLabelText(/STRIPE_WEBHOOK_ID/i), {
      target: { value: "whsec_456" },
    });
    fireEvent.change(screen.getByLabelText(/spec url/i), {
      target: { value: "https://example.com/openapi.json" },
    });

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onContinue).toHaveBeenCalledTimes(1);
    const inputs = onContinue.mock.calls[0]?.[0] as BuildInputItem[];

    const configInput = inputs.find(
      (i) => i.dependency === "stripe-config",
    );
    expect(configInput).toMatchObject({
      component: "checkout-api",
      dependency: "stripe-config",
      kind: "external-config",
      values: expect.arrayContaining([
        { key: "STRIPE_API_KEY", value: "sk_test_123" },
        { key: "STRIPE_WEBHOOK_ID", value: "whsec_456" },
      ]),
    });

    const specInput = inputs.find(
      (i) => i.dependency === "partner-openapi-spec",
    );
    expect(specInput).toMatchObject({
      component: "checkout-api",
      dependency: "partner-openapi-spec",
      kind: "external-spec",
      specUrl: "https://example.com/openapi.json",
    });

    const resourceInput = inputs.find((i) => i.dependency === "postgres");
    expect(resourceInput).toMatchObject({
      component: "checkout-api",
      dependency: "postgres",
      kind: "platform-resource",
      approved: true,
    });

    const orgServiceInput = inputs.find(
      (i) => i.dependency === "billing-service",
    );
    expect(orgServiceInput).toMatchObject({
      component: "checkout-api",
      dependency: "billing-service",
      kind: "org-service",
      approved: true,
    });
  });

  it("always emits approved:true for platform-resource/org-service (Continue is the approval)", () => {
    const { onContinue } = setup();

    fireEvent.change(screen.getByLabelText(/STRIPE_API_KEY/i), {
      target: { value: "sk_test_123" },
    });
    fireEvent.change(screen.getByLabelText(/STRIPE_WEBHOOK_ID/i), {
      target: { value: "whsec_456" },
    });
    fireEvent.change(screen.getByLabelText(/spec url/i), {
      target: { value: "https://example.com/openapi.json" },
    });

    const continueButton = screen.getByRole("button", { name: /continue/i });
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);

    const inputs = onContinue.mock.calls[0]?.[0] as BuildInputItem[];
    expect(
      inputs.find((i) => i.dependency === "postgres"),
    ).toMatchObject({ approved: true });
    expect(
      inputs.find((i) => i.dependency === "billing-service"),
    ).toMatchObject({ approved: true });
  });

  it("accepts a pasted spec via the content field and emits specContent (not specUrl)", () => {
    const specItem: PreflightItem = {
      component: "checkout-api",
      dependency: "partner-openapi-spec",
      kind: "external-spec",
      description: "Partner API spec",
    };
    const { onContinue } = setup([specItem]);

    const continueButton = screen.getByRole("button", { name: /continue/i });
    expect(continueButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/spec content/i), {
      target: { value: "openapi: 3.0.0\ninfo:\n  title: Partner API" },
    });

    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);

    expect(onContinue).toHaveBeenCalledTimes(1);
    const inputs = onContinue.mock.calls[0]?.[0] as BuildInputItem[];
    const specInput = inputs.find(
      (i) => i.dependency === "partner-openapi-spec",
    );
    expect(specInput).toMatchObject({
      component: "checkout-api",
      dependency: "partner-openapi-spec",
      kind: "external-spec",
      specContent: "openapi: 3.0.0\ninfo:\n  title: Partner API",
    });
    expect(specInput).not.toHaveProperty("specUrl");
  });

  it("calls onClose when Cancel is clicked", () => {
    const { onClose } = setup();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("resets to fresh state each time it is reopened", () => {
    const onClose = vi.fn();
    const onContinue = vi.fn();
    const { rerender } = render(
      <BuildDependencyDrawer
        open
        items={ITEMS}
        onClose={onClose}
        onContinue={onContinue}
      />,
    );

    fireEvent.change(screen.getByLabelText(/STRIPE_API_KEY/i), {
      target: { value: "sk_test_123" },
    });

    rerender(
      <BuildDependencyDrawer
        open={false}
        items={ITEMS}
        onClose={onClose}
        onContinue={onContinue}
      />,
    );
    rerender(
      <BuildDependencyDrawer
        open
        items={ITEMS}
        onClose={onClose}
        onContinue={onContinue}
      />,
    );

    // The typed external-config value is cleared on reopen.
    expect(screen.getByLabelText(/STRIPE_API_KEY/i)).toHaveValue("");
  });
});

// #252 Task 10: the restored external proceed gate's blocker items
// (external-ambiguous / external-unresolved) — no local form, Continue stays
// disabled while present, and "Resolve via chat" is the only affordance.
describe("BuildDependencyDrawer blocker items (#252 Task 10)", () => {
  const AMBIGUOUS_ITEM: PreflightItem = {
    component: "checkout-api",
    dependency: "crm",
    kind: "external-ambiguous",
    description: "More than one candidate fits — resolve which one to use.",
  };
  const UNRESOLVED_ITEM: PreflightItem = {
    component: "checkout-api",
    dependency: "weather-api",
    kind: "external-unresolved",
    description: "Needs information only you can provide.",
  };

  it("renders the blocker's dependency name and plain-language reason", () => {
    setup([AMBIGUOUS_ITEM, UNRESOLVED_ITEM]);

    expect(screen.getByText("crm")).toBeInTheDocument();
    expect(
      screen.getByText(/more than one candidate fits/i),
    ).toBeInTheDocument();
    expect(screen.getByText("weather-api")).toBeInTheDocument();
    expect(
      screen.getByText(/needs information only you can provide/i),
    ).toBeInTheDocument();
  });

  it("keeps Continue disabled while a blocker item is present, regardless of other items", () => {
    setup([AMBIGUOUS_ITEM]);

    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("never renders a local input for a blocker item (no textbox)", () => {
    setup([AMBIGUOUS_ITEM, UNRESOLVED_ITEM]);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("fires onResolveDependency with the blocker item when 'Resolve via chat' is clicked", () => {
    const { onResolveDependency } = setup([AMBIGUOUS_ITEM]);

    fireEvent.click(
      screen.getByRole("button", { name: /resolve via chat/i }),
    );

    expect(onResolveDependency).toHaveBeenCalledTimes(1);
    expect(onResolveDependency).toHaveBeenCalledWith(AMBIGUOUS_ITEM);
  });

  it("re-enables Continue once the blocker item is no longer in items (simulating a resolved refetch)", () => {
    const onClose = vi.fn();
    const onContinue = vi.fn();
    const { rerender } = render(
      <BuildDependencyDrawer
        open
        items={[AMBIGUOUS_ITEM]}
        onClose={onClose}
        onContinue={onContinue}
      />,
    );
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();

    // The parent refetched preflight after the chat resolved it — the item
    // is simply gone from the next `items` array.
    rerender(
      <BuildDependencyDrawer
        open
        items={[]}
        onClose={onClose}
        onContinue={onContinue}
      />,
    );

    expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled();
  });

  it("submits only the config item once the blocker resolves out of items, never a stray blocker entry", () => {
    const onClose = vi.fn();
    const onContinue = vi.fn();
    const configItem: PreflightItem = {
      component: "checkout-api",
      dependency: "stripe-config",
      kind: "external-config",
      description: "Stripe API credentials",
      config: [{ key: "STRIPE_API_KEY", secret: true }],
    };
    const { rerender } = render(
      <BuildDependencyDrawer
        open
        items={[AMBIGUOUS_ITEM, configItem]}
        onClose={onClose}
        onContinue={onContinue}
      />,
    );
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();

    // Chat resolved the blocker; the parent's refetch drops it from items.
    rerender(
      <BuildDependencyDrawer
        open
        items={[configItem]}
        onClose={onClose}
        onContinue={onContinue}
      />,
    );
    fireEvent.change(screen.getByLabelText(/STRIPE_API_KEY/i), {
      target: { value: "sk_test_123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onContinue).toHaveBeenCalledTimes(1);
    const inputs = onContinue.mock.calls[0]?.[0] as BuildInputItem[];
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      dependency: "stripe-config",
      kind: "external-config",
    });
  });

  it("renders 'Resolve via chat' for a still-unfed external-spec item too, alongside its existing form", () => {
    const specItem: PreflightItem = {
      component: "checkout-api",
      dependency: "partner-api",
      kind: "external-spec",
      description: "No API spec yet — provide one to continue.",
    };
    const { onResolveDependency } = setup([specItem]);

    // The pre-existing local form is untouched...
    expect(screen.getByLabelText(/spec url/i)).toBeInTheDocument();
    // ...and the new chat affordance sits alongside it.
    fireEvent.click(
      screen.getByRole("button", { name: /resolve via chat/i }),
    );
    expect(onResolveDependency).toHaveBeenCalledWith(specItem);
  });
});
