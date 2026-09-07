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
import { OxygenTheme, OxygenUIThemeProvider } from "@wso2/oxygen-ui";
import type { DependencyState } from "../lib/dependencyStates";
import { DependencyPage } from "./DependencyPage";

const provideMutate = vi.fn();
const acceptMutate = vi.fn();
vi.mock("../api/queries", () => ({
  useProvideDependencyContract: () => ({
    mutate: provideMutate,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
  }),
  useAcceptDependencyAssumption: () => ({
    mutate: acceptMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

const stateOf = (over: Partial<DependencyState["dependency"]>, extra: Partial<DependencyState> = {}): DependencyState => {
  const dependency = { kind: "external", name: "dhl-courier", ...over } as DependencyState["dependency"];
  return { dependency, usedBy: ["parcel-api"], blocking: false, todo: "", flags: [], ...extra };
};

function renderPage(state: DependencyState | undefined) {
  const onResolve = vi.fn();
  const onReconsider = vi.fn();
  const onOpenFile = vi.fn();
  render(
    <OxygenUIThemeProvider theme={OxygenTheme}>
      <DependencyPage
        projectName="proj1"
        name="dhl-courier"
        state={state}
        node={{
          name: "dhl-courier",
          definitionPath: "specs/design/dependencies/dhl-courier/dependency.json",
          files: [{ path: "specs/design/dependencies/dhl-courier/openapi.yaml", sha: "s", group: "designs" }],
        }}
        onOpenFile={onOpenFile}
        onResolve={onResolve}
        onReconsider={onReconsider}
      />
    </OxygenUIThemeProvider>,
  );
  return { onResolve, onReconsider, onOpenFile };
}

describe("DependencyPage", () => {
  it("names the one thing to do and runs the guided flow from Resolve", () => {
    const { onResolve } = renderPage(
      stateOf(
        { status: "unresolved", reason: "needs-contract", provider: "DHL", style: "rest-api" },
        { blocking: true, todo: "Needs a contract" },
      ),
    );
    expect(screen.getByRole("heading", { name: "dhl-courier" })).toBeInTheDocument();
    expect(screen.getByText("Needs a contract")).toBeInTheDocument();
    expect(screen.getByText("No contract on file yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    expect(onResolve).toHaveBeenCalledWith("dhl-courier");
  });

  it("lets the user provide the contract by URL, straight from the page", () => {
    renderPage(stateOf({ status: "unresolved", reason: "needs-contract", provider: "DHL", style: "rest-api" }, { blocking: true, todo: "Needs a contract" }));
    fireEvent.change(screen.getByLabelText("OpenAPI document URL"), { target: { value: "https://x/openapi.yaml" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch" }));
    expect(provideMutate).toHaveBeenCalledWith({ depName: "dhl-courier", url: "https://x/openapi.yaml" }, expect.anything());
  });

  it("offers acceptance for a contract the agent wrote, and nothing else can accept it", () => {
    renderPage(
      stateOf(
        { status: "unresolved", reason: "needs-acceptance", provider: "DHL", style: "rest-api", contract: "openapi.yaml", contractAssumed: true },
        { blocking: true, todo: "Needs your acceptance" },
      ),
    );
    expect(screen.getByText(/the agent wrote this contract from research/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /accept the assumption/i }));
    expect(acceptMutate).toHaveBeenCalledWith({ depName: "dhl-courier" });
  });

  it("shows a resolved dependency's contract, provenance and flags, and offers Reconsider", () => {
    const { onReconsider, onOpenFile } = renderPage(
      stateOf(
        {
          status: "resolved",
          provider: "DHL",
          style: "rest-api",
          contract: "openapi.yaml",
          flags: ["assumed"],
          assumed: { by: "admin", at: "2026-09-08T10:00:00Z" },
          provenance: { sourceUrl: "https://developer.dhl.com", sliced: true },
          config: [{ key: "DHL_API_KEY", secret: true, description: "Developer API key" }],
        },
        { flags: ["Assumed"] },
      ),
    );
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.getAllByText("Assumed").length).toBeGreaterThan(0);
    expect(screen.getByText("https://developer.dhl.com")).toBeInTheDocument();
    expect(screen.getByText("DHL_API_KEY")).toBeInTheDocument();
    // The contract is reachable twice — the Contract section and the Files list.
    fireEvent.click(screen.getAllByRole("button", { name: "openapi.yaml" })[0]!);
    expect(onOpenFile).toHaveBeenCalledWith("specs/design/dependencies/dhl-courier/openapi.yaml");
    fireEvent.click(screen.getByRole("button", { name: "Reconsider" }));
    expect(onReconsider).toHaveBeenCalledWith("dhl-courier");
    expect(screen.queryByRole("button", { name: "Resolve" })).not.toBeInTheDocument();
  });

  it("lists open candidates and asks the user to choose rather than offering an upload", () => {
    renderPage(
      stateOf(
        { status: "ambiguous", candidates: [{ name: "sendgrid", style: "rest-api", description: "Mail API" }, { name: "postmark", style: "rest-api" }] },
        { blocking: true, todo: "Choose a provider" },
      ),
    );
    expect(screen.getByText("sendgrid")).toBeInTheDocument();
    expect(screen.getByText("postmark")).toBeInTheDocument();
    expect(screen.queryByLabelText("OpenAPI document URL")).not.toBeInTheDocument();
  });

  it("is honest when the read model does not know the name yet", () => {
    renderPage(undefined);
    expect(screen.getByText(/no component references this dependency yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "dependency.json" })).toBeInTheDocument();
  });
});
