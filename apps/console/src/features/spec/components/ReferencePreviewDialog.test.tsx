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
import { ReferencePreviewDialog } from "./ReferencePreviewDialog";
import type { SpecFileEntry } from "../api/mapping";

// The committed-blob read is configured per test — same pattern as
// CellDiagramPanel.test.tsx, so this needs neither a QueryClientProvider nor
// MSW.
const mockContent = vi.fn();
vi.mock("../api/queries", () => ({
  useSpecFileContent: (...args: unknown[]) => mockContent(...args),
}));

const PDF_FILE: SpecFileEntry = {
  path: "specs/requirements/references/spec.pdf",
  sha: "sha-pdf",
  group: "references",
  size: 20480,
};
const MD_FILE: SpecFileEntry = {
  path: "specs/requirements/references/notes.md",
  sha: "sha-md",
  group: "references",
  size: 128,
};
const TXT_FILE: SpecFileEntry = {
  path: "specs/requirements/references/raw.txt",
  sha: "sha-txt",
  group: "references",
  size: 64,
};

// A byte-valid tiny PDF ("%PDF-1.4" header + trailer), base64-encoded — real
// bytes, not a placeholder string, so the decode path is genuinely exercised.
const TINY_PDF_BASE64 =
  "JVBERi0xLjQKJSVFT0Y=";

let createObjectURLSpy: ReturnType<typeof vi.fn>;
let revokeObjectURLSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockContent.mockReset();
  createObjectURLSpy = vi.fn(() => "blob:mock-url");
  revokeObjectURLSpy = vi.fn();
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: createObjectURLSpy,
    revokeObjectURL: revokeObjectURLSpy,
  });
});

describe("ReferencePreviewDialog", () => {
  it("stays closed and skips the fetch when no file is selected", () => {
    mockContent.mockReturnValue({ data: undefined, isPending: false, isError: false });
    render(<ReferencePreviewDialog projectName="p" file={null} onClose={vi.fn()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a loading state while the content read is pending", () => {
    mockContent.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<ReferencePreviewDialog projectName="p" file={PDF_FILE} onClose={vi.fn()} />);

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("shows an error state with a retry action when the read fails", () => {
    const refetch = vi.fn();
    mockContent.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("network blip"),
      refetch,
    });
    render(<ReferencePreviewDialog projectName="p" file={MD_FILE} onClose={vi.fn()} />);

    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    expect(screen.getByText(/network blip/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders a markdown reference through the console markdown renderer", () => {
    mockContent.mockReturnValue({
      data: { path: MD_FILE.path, content: "# Heading\n\nBody text.", sha: MD_FILE.sha },
      isPending: false,
      isError: false,
    });
    render(<ReferencePreviewDialog projectName="p" file={MD_FILE} onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
    expect(screen.getByText("Body text.")).toBeInTheDocument();
  });

  it("renders a plain-text reference as scrollable preformatted text", () => {
    mockContent.mockReturnValue({
      data: { path: TXT_FILE.path, content: "line one\nline two", sha: TXT_FILE.sha },
      isPending: false,
      isError: false,
    });
    render(<ReferencePreviewDialog projectName="p" file={TXT_FILE} onClose={vi.fn()} />);

    const pre = screen.getByText((_, el) => el?.tagName === "PRE" && el.textContent === "line one\nline two");
    expect(pre).toBeInTheDocument();
  });

  it("decodes a base64 PDF read into a blob: object URL and renders an <object> pointing at it", () => {
    mockContent.mockReturnValue({
      data: { path: PDF_FILE.path, content: TINY_PDF_BASE64, sha: PDF_FILE.sha, encoding: "base64" },
      isPending: false,
      isError: false,
    });
    render(<ReferencePreviewDialog projectName="p" file={PDF_FILE} onClose={vi.fn()} />);

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    // NEVER the raw API URL — the object tag's src must be the decoded blob:
    // URL, since an <object>/<iframe> request carries no auth header.
    const object = document.querySelector("object[type='application/pdf']");
    expect(object).not.toBeNull();
    expect(object?.getAttribute("data")).toBe("blob:mock-url");
  });

  it("revokes the object URL on close/unmount so the blob doesn't leak", () => {
    mockContent.mockReturnValue({
      data: { path: PDF_FILE.path, content: TINY_PDF_BASE64, sha: PDF_FILE.sha, encoding: "base64" },
      isPending: false,
      isError: false,
    });
    const { unmount } = render(
      <ReferencePreviewDialog projectName="p" file={PDF_FILE} onClose={vi.fn()} />,
    );
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);

    unmount();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:mock-url");
  });

  it("calls onClose from the Close action", () => {
    const onClose = vi.fn();
    mockContent.mockReturnValue({
      data: { path: MD_FILE.path, content: "hi", sha: MD_FILE.sha },
      isPending: false,
      isError: false,
    });
    render(<ReferencePreviewDialog projectName="p" file={MD_FILE} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
