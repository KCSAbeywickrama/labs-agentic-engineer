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

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HistoryView } from "../lib/environmentHistory";
import { PastDeployments, type PastDeploymentsProps } from "./PastDeployments";

const entryView: HistoryView = {
  unrecorded: false,
  pending: false,
  rows: [
    {
      key: "v3",
      version: "v3",
      milestoneNumber: 3,
      deployedAt: "2026-09-12T09:40:00Z",
      current: true,
    },
    {
      key: "v2",
      version: "v2",
      milestoneNumber: 2,
      deployedAt: "2026-09-08T16:12:00Z",
      until: "2026-09-12T09:40:00Z",
      current: false,
    },
  ],
};

const laterView: HistoryView = {
  unrecorded: true,
  pending: false,
  rows: [{ key: "staging:current", deployedAt: "2026-09-12T09:40:00Z", current: true }],
};

const props = (over: Partial<PastDeploymentsProps> = {}): PastDeploymentsProps => ({
  environmentLabel: "Development",
  view: entryView,
  repoUrl: "https://github.com/acme/expense.git",
  validation: { label: "validated", tone: "success", live: false },
  ...over,
});

describe("PastDeployments", () => {
  it("is section 4, named and captioned", () => {
    render(<PastDeployments {...props()} />);
    expect(screen.getByRole("heading", { level: 3, name: "Past deployments" })).toBeInTheDocument();
    expect(
      screen.getByText("every version that ran on Development, newest first"),
    ).toBeInTheDocument();
  });

  it("columns the table as the design does", () => {
    render(<PastDeployments {...props()} />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Version", "Milestone", "Validation", "Deployed", "Until", ""]);
  });

  it("lists the versions newest first, linking each milestone to GitHub", () => {
    render(<PastDeployments {...props()} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getByTestId("history-version").textContent)).toEqual([
      "v3",
      "v2",
    ]);
    expect(within(rows[1]!).getByRole("link", { name: "Milestone #2" })).toHaveAttribute(
      "href",
      "https://github.com/acme/expense/milestone/2",
    );
  });

  it("marks the running row and closes the superseded one", () => {
    render(<PastDeployments {...props()} />);
    const running = screen.getByRole("row", { name: /v3/ });
    expect(within(running).getByText("Running now")).toBeInTheDocument();
    const past = screen.getByRole("row", { name: /v2/ });
    expect(within(past).queryByText("Running now")).not.toBeInTheDocument();
    expect(within(past).getByTestId("history-until").textContent).not.toBe("—");
  });

  it("offers Roll back on every row, disabled, with the reason reachable by screen reader", () => {
    render(<PastDeployments {...props()} />);
    const buttons = screen.getAllByRole("button", { name: /Roll back/ });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription(/Not supported yet/);
    }
  });

  it("carries the verdict on the running row only, and claims none for a past one", () => {
    render(<PastDeployments {...props()} />);
    expect(within(screen.getByRole("row", { name: /v3/ })).getByText("validated")).toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /v2/ })).getByText("Not recorded"),
    ).toBeInTheDocument();
  });

  it("holds the verdict cell while the read behind it is still out", () => {
    render(
      <PastDeployments
        {...props({ validation: { label: "", tone: "neutral", live: false, pending: true } })}
      />,
    );
    expect(screen.getByTestId("validation-cell-skeleton")).toBeInTheDocument();
  });

  it("says plainly that a later environment's past is unrecorded", () => {
    render(<PastDeployments {...props({ view: laterView, environmentLabel: "Staging", validation: null })} />);
    expect(
      screen.getByText("No earlier deployments are recorded for this environment."),
    ).toBeInTheDocument();
    // …and states its own version as unknown rather than borrowing one.
    expect(screen.getByTestId("history-version").textContent).toBe("Unknown");
    expect(screen.getByText("Running now")).toBeInTheDocument();
  });

  it("says nothing of an empty, unrecorded environment beyond the admission", () => {
    render(
      <PastDeployments
        {...props({
          view: { rows: [], unrecorded: true, pending: false },
          environmentLabel: "Staging",
          validation: null,
        })}
      />,
    );
    expect(
      screen.getByText("No earlier deployments are recorded for this environment."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("waits rather than claiming nothing ever ran, while the version ledger is out", () => {
    render(<PastDeployments {...props({ view: { rows: [], unrecorded: false, pending: true } })} />);
    expect(screen.getByTestId("past-deployments-skeleton")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing has run here yet/)).not.toBeInTheDocument();
    expect(
      screen.queryByText("No earlier deployments are recorded for this environment."),
    ).not.toBeInTheDocument();
  });

  it("says the version ledger could not be read, with a Retry, rather than an empty past", () => {
    const onRetry = vi.fn();
    render(
      <PastDeployments
        {...props({ view: { rows: [], unrecorded: false, pending: false }, failed: "ledger down", onRetry })}
      />,
    );
    expect(screen.getByText(/The version ledger could not be read: ledger down/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing has run here yet/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("still says nothing ran here once the ledger answered and named nothing", () => {
    render(<PastDeployments {...props({ view: { rows: [], unrecorded: false, pending: false } })} />);
    expect(screen.getByText("Nothing has run here yet.")).toBeInTheDocument();
  });
});
