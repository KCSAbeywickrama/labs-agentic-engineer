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

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

// The mutation doubles below are plain objects the component reads flags
// from; each test primes them for the state it exercises. Create always
// succeeds instantly (the confirm step is reached by then), upload behavior
// is per-test.
const createProject = {
  mutate: vi.fn(
    (
      body: { name: string },
      opts?: { onSuccess?: (p: { name: string }) => void },
    ) => opts?.onSuccess?.({ name: body.name }),
  ),
  reset: vi.fn(),
  isPending: false,
  isError: false,
  error: null as Error | null,
};
const uploadReferences = {
  mutate: vi.fn(),
  reset: vi.fn(),
  isPending: false,
  isError: false,
  error: null as Error | null,
};
vi.mock("../api/queries", () => ({
  useCreateProject: () => createProject,
  useGithubOrg: () => ({ data: "acme" }),
  useUploadReferences: () => uploadReferences,
}));

import { ProjectCreate } from "./ProjectCreate";

function attachAll(names: string[], content = "content"): void {
  const input = document.querySelector<HTMLInputElement>("input[type=file]");
  expect(input).not.toBeNull();
  fireEvent.change(input!, {
    target: { files: names.map((name) => new File([content], name)) },
  });
}

function attach(name: string, content = "content"): void {
  attachAll([name], content);
}

function typePrompt(): void {
  fireEvent.change(
    screen.getByPlaceholderText(/booking system/i),
    { target: { value: "A todo app" } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  uploadReferences.isError = false;
  uploadReferences.error = null;
});

describe("ProjectCreate reference documents (#383)", () => {
  it("shows an attached file as a card in the composer", () => {
    render(<ProjectCreate />);
    attach("prd.md");
    expect(screen.getByText(/prd\.md/)).toBeTruthy();
  });

  it("rejects an unsupported extension with a per-file notice", () => {
    render(<ProjectCreate />);
    attach("spec.docx");
    expect(screen.queryByText(/spec\.docx \(/)).toBeNull();
    expect(
      screen.getByText(/only \.md, \.txt, \.pdf, \.png, \.jpg, \.jpeg files are accepted/i),
    ).toBeTruthy();
  });

  // Two rejections can carry one name — the same unsupported file picked twice
  // in a selection. Each gets its own notice, and dismissing one leaves the
  // other standing.
  it("keeps one notice per rejected file, dismissed one at a time", () => {
    render(<ProjectCreate />);
    attachAll(["spec.docx", "spec.docx"]);
    expect(screen.getAllByText(/was not attached/i)).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: /close/i })[0]!);
    expect(screen.getAllByText(/was not attached/i)).toHaveLength(1);
  });

  it("creates without an upload when nothing is attached", () => {
    render(<ProjectCreate />);
    typePrompt();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(uploadReferences.mutate).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalled();
  });

  it("uploads after create and, on failure, offers Retry and Continue", () => {
    // The double records the call but never succeeds; the component re-renders
    // reading isError once the flow has marked the project created.
    uploadReferences.isError = true;
    uploadReferences.error = new Error("boom");
    render(<ProjectCreate />);
    attach("prd.md");
    typePrompt();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(uploadReferences.mutate).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(
      screen.getByText(/uploading the reference documents failed/i),
    ).toBeTruthy();

    // Retry replaces the create action and re-fires only the upload.
    fireEvent.click(screen.getByRole("button", { name: "Retry upload" }));
    expect(uploadReferences.mutate).toHaveBeenCalledTimes(2);
    expect(createProject.mutate).toHaveBeenCalledTimes(1);

    // The explicit escape navigates without the documents.
    fireEvent.click(
      screen.getByRole("button", { name: "Continue without documents" }),
    );
    expect(navigate).toHaveBeenCalled();
  });
});
