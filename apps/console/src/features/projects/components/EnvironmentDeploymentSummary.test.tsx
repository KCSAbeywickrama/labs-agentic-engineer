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

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  EnvironmentDeploymentSummary,
  type EnvironmentDeploymentSummaryProps,
} from "./EnvironmentDeploymentSummary";

const base = (): EnvironmentDeploymentSummaryProps => ({
  version: "v3",
  bound: true,
  pending: false,
  milestoneNumber: 3,
  milestoneHref: "https://github.com/acme/expense/milestone/3",
  commit: { sha: "b71f2c9d4e5a6b7c", href: "https://github.com/acme/expense/commit/b71f2c9d4e5a6b7c" },
  validation: { label: "validated", tone: "success", live: false },
  counts: { passed: 12, failed: 0, uncovered: 0, total: 12 },
  builtAt: "Sep 12, 09:10 AM",
  deployedAt: "Sep 12, 09:40 AM",
  live: 4,
  total: 4,
});

const props = (
  over: Partial<EnvironmentDeploymentSummaryProps> = {},
): EnvironmentDeploymentSummaryProps => ({ ...base(), ...over });

describe("EnvironmentDeploymentSummary", () => {
  it("leads with the version and milestone, the milestone linking to GitHub", () => {
    render(<EnvironmentDeploymentSummary {...props()} />);
    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Milestone #3/ })).toHaveAttribute(
      "href",
      "https://github.com/acme/expense/milestone/3",
    );
  });

  it("links the commit and shortens the sha", () => {
    render(<EnvironmentDeploymentSummary {...props()} />);
    expect(screen.getByRole("link", { name: "b71f2c9" })).toHaveAttribute(
      "href",
      "https://github.com/acme/expense/commit/b71f2c9d4e5a6b7c",
    );
  });

  it("carries the verdict with its counts, the stamps and the live count", () => {
    render(<EnvironmentDeploymentSummary {...props()} />);
    expect(screen.getByText("validated")).toBeInTheDocument();
    expect(screen.getByText("12/12")).toBeInTheDocument();
    expect(screen.getByText(/Built Sep 12, 09:10 AM/)).toBeInTheDocument();
    expect(screen.getByText(/Deployed Sep 12, 09:40 AM/)).toBeInTheDocument();
    expect(screen.getByText(/4 of 4 components live/)).toBeInTheDocument();
  });

  it("says Version unknown rather than guessing when the binding names none", () => {
    render(<EnvironmentDeploymentSummary {...props({ version: undefined })} />);
    expect(screen.getByText("Version unknown")).toBeInTheDocument();
    expect(screen.queryByText(/^v\d/)).not.toBeInTheDocument();
  });

  it("omits what this environment cannot resolve rather than printing dashes", () => {
    // A later environment: nothing names its version, its milestone, its
    // commit or a verdict for it — and borrowing the entry environment's
    // would be a lie about which deployment this is.
    render(
      <EnvironmentDeploymentSummary
        {...props({
          version: undefined,
          milestoneNumber: undefined,
          milestoneHref: undefined,
          commit: undefined,
          validation: null,
          counts: undefined,
          builtAt: undefined,
        })}
      />,
    );
    expect(screen.queryByText("Milestone")).not.toBeInTheDocument();
    expect(screen.queryByText("Commit")).not.toBeInTheDocument();
    expect(screen.queryByText("Validation")).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.getByText(/Deployed Sep 12, 09:40 AM/)).toBeInTheDocument();
  });

  it("says nothing runs here, without dashes, on an empty environment", () => {
    render(<EnvironmentDeploymentSummary {...props({ bound: false })} />);
    expect(screen.getByText("Nothing running yet.")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.queryByText("v3")).not.toBeInTheDocument();
  });

  it("draws a skeleton while the read that names the version is still out", () => {
    render(<EnvironmentDeploymentSummary {...props({ pending: true })} />);
    expect(screen.getByTestId("deployment-summary-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("Version unknown")).not.toBeInTheDocument();
    expect(screen.queryByText("Nothing running yet.")).not.toBeInTheDocument();
  });

  it("holds the verdict cell, rather than a word, while the run story is out", () => {
    render(
      <EnvironmentDeploymentSummary
        {...props({ validation: { label: "", tone: "neutral", live: false, pending: true } })}
      />,
    );
    expect(screen.getByTestId("validation-cell-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("12/12")).not.toBeInTheDocument();
  });

  it("waits for the commit rather than printing a placeholder sha", () => {
    render(<EnvironmentDeploymentSummary {...props({ commit: "loading" })} />);
    expect(screen.getByLabelText("Loading the commit")).toBeInTheDocument();
    expect(screen.queryByText("b71f2c9")).not.toBeInTheDocument();
  });
});
