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
      { key: "STRIPE_API_KEY", secret: true },
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

function setup(items: PreflightItem[] = ITEMS) {
  const onClose = vi.fn();
  const onContinue = vi.fn();
  render(
    <BuildDependencyDrawer
      open
      items={items}
      onClose={onClose}
      onContinue={onContinue}
    />,
  );
  return { onClose, onContinue };
}

describe("BuildDependencyDrawer", () => {
  it("renders a sub-panel per dependency kind present in items", () => {
    setup();

    expect(screen.getByText(/stripe-config/i)).toBeInTheDocument();
    expect(screen.getByText(/partner-openapi-spec/i)).toBeInTheDocument();
    expect(screen.getAllByText(/postgres/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/billing-service/i)).toBeInTheDocument();
  });

  it("checks platform-resource and org-service approvals by default", () => {
    setup();

    const postgresCheckbox = screen.getByRole("checkbox", {
      name: /postgres/i,
    });
    const billingCheckbox = screen.getByRole("checkbox", {
      name: /billing-service/i,
    });

    expect(postgresCheckbox).toBeChecked();
    expect(billingCheckbox).toBeChecked();
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

  it("emits approved:false for an unchecked approval without blocking Continue", () => {
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

    fireEvent.click(screen.getByRole("checkbox", { name: /postgres/i }));

    const continueButton = screen.getByRole("button", { name: /continue/i });
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);

    const inputs = onContinue.mock.calls[0]?.[0] as BuildInputItem[];
    const resourceInput = inputs.find((i) => i.dependency === "postgres");
    expect(resourceInput).toMatchObject({ approved: false });
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
    fireEvent.click(screen.getByRole("checkbox", { name: /postgres/i }));

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

    expect(screen.getByLabelText(/STRIPE_API_KEY/i)).toHaveValue("");
    expect(
      screen.getByRole("checkbox", { name: /postgres/i }),
    ).toBeChecked();
  });
});
