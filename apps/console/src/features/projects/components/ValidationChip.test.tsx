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
import { describe, expect, it, vi } from "vitest";

// Router replaced so the link renders as a plain anchor whose href is the
// resolved route path — no RouterProvider needed (mirrors DeploymentsPage.test).
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

import { ValidationChip } from "./ValidationChip";

// Every value the contract's DeployStage.validation can carry, minus `none`.
// Kept in step with pipeline.test.ts's own exhaustiveness list and with the
// contract enum (packages/contracts/api/v1/openapi.yaml, DeployStage).
const VALIDATION_VALUES = [
  "running",
  "awaiting-fix",
  "passed",
  "partial",
  "failed",
  "inconclusive",
  "unreported",
  "skipped",
];

describe("ValidationChip", () => {
  it("links to the project's Validation page, in the same tab", () => {
    render(<ValidationChip projectName="acme" validation="passed" />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/projects/acme/validation");
    // Internal navigation, not a new-tab external link.
    expect(link).not.toHaveAttribute("target");
  });

  // The status mark and the arrow are the whole visual change, and both are
  // decorative: the accessible name must stay the label ALONE, or every caller's
  // `getByRole("link", { name: /^Validated$/ })` starts matching on chrome
  // instead of on copy. This is the assertion that keeps them aria-hidden.
  it("names itself with the label alone — the icons are decorative", () => {
    render(<ValidationChip projectName="acme" validation="passed" />);

    expect(screen.getByRole("link", { name: "Validated" })).toBeInTheDocument();
  });

  // A verdict with no glyph would still render, just bare — which reads as
  // "nothing to say about this state" rather than as an omission. Catch it here.
  it("renders a link and a status mark for every verdict the contract can send", () => {
    for (const validation of VALIDATION_VALUES) {
      const { unmount } = render(
        <ValidationChip projectName="acme" validation={validation} />,
      );

      expect(
        screen.getByRole("link"),
        `no link for ${validation}`,
      ).toHaveAttribute("href", "/projects/acme/validation");
      expect(
        screen.getByTestId("validation-status-mark"),
        `no status mark for ${validation}`,
      ).toBeInTheDocument();

      unmount();
    }
  });

  // `none` is not a state with a quiet rendering — it is the run not having
  // reached validation, so there is nothing to open yet.
  it("renders nothing when there is nothing to validate", () => {
    for (const validation of ["none", "", "bogus"]) {
      const { unmount, container } = render(
        <ValidationChip projectName="acme" validation={validation} />,
      );

      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
