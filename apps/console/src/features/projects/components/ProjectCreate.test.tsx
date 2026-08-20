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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../../api/errors";
import { ProjectCreate } from "./ProjectCreate";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

let createState: {
  isError: boolean;
  isPending: boolean;
  error: unknown;
} = { isError: false, isPending: false, error: null };

vi.mock("../api/queries", () => ({
  useGithubOrg: () => ({ data: "HevayoFactory" }),
  useCreateProject: () => ({ ...createState, mutate: vi.fn(), reset: vi.fn() }),
}));

/** Walk the prompt step so the name/repo step is on screen. */
function reachNameStep() {
  render(<ProjectCreate />);
  fireEvent.click(screen.getByRole("button", { name: /Expense approval/ }));
}

describe("ProjectCreate", () => {
  beforeEach(() => {
    createState = { isError: false, isPending: false, error: null };
  });

  it("asks for the idea without promising what happens next", () => {
    render(<ProjectCreate />);
    expect(screen.getByText("Describe it in your own words — rough is fine.")).toBeInTheDocument();
    // The journey explains itself as it happens (#522); the create page does not
    // narrate it, and never claims design starts first.
    expect(screen.queryByText(/deriving its design/)).not.toBeInTheDocument();
  });

  it("offers examples for the persona, not consumer apps", () => {
    render(<ProjectCreate />);
    // The placeholder is an example too — it carried a hair-salon booking
    // system, which models the product as a consumer app generator.
    expect(screen.getByPlaceholderText(/service desk/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/hair salon/)).not.toBeInTheDocument();
    expect(screen.getByText("Expense approval")).toBeInTheDocument();
    expect(screen.getByText("Employee onboarding")).toBeInTheDocument();
    expect(screen.getByText("Support triage agent")).toBeInTheDocument();
  });

  it("clamps the echoed idea so a long one cannot push the form off-screen", () => {
    reachNameStep();
    const echo = screen.getByText(/Employees submit expense claims/);
    // The clamp mechanism, as the project cards use it. Asserted through
    // computed style because `sx` emits a class, not inline styles.
    const css = getComputedStyle(echo);
    expect(css.overflow).toBe("hidden");
    expect(css.display).toBe("-webkit-box");
    expect(css.getPropertyValue("-webkit-line-clamp")).toBe("2");
    // Nothing is lost — the full idea stays reachable without leaving the step.
    expect(echo).toHaveAttribute("title", expect.stringContaining("payroll") as unknown as string);
  });

  it("says the repository is created, rather than implying it exists", () => {
    reachNameStep();
    expect(
      screen.getByText(/Agentic Engineer creates this repository in your organization/),
    ).toBeInTheDocument();
  });

  it("names what is being made while it waits", () => {
    createState = { isError: false, isPending: true, error: null };
    reachNameStep();
    expect(screen.getByRole("button", { name: /Creating your project/ })).toBeInTheDocument();
  });

  it("puts a taken repository name on the field, naming the org", () => {
    createState = {
      isError: true,
      isPending: false,
      error: new ApiRequestError({ code: "conflict", message: "server wording" }, "fallback"),
    };
    reachNameStep();
    expect(
      screen.getByText("That repository name already exists in HevayoFactory — pick another."),
    ).toBeInTheDocument();
    // A field failure is not a page failure: the Alert stays away, and the
    // BFF's own wording is not shown twice.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("server wording")).not.toBeInTheDocument();
  });

  it("still shows an Alert for a failure the user cannot fix in the form", () => {
    createState = {
      isError: true,
      isPending: false,
      error: new ApiRequestError({ code: "internal_error", message: "boom" }, "fallback"),
    };
    reachNameStep();
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });
});
