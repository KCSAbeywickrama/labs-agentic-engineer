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
import { SpecFileList } from "./SpecFileList";
import type { SpecFileEntry } from "../api/mapping";

const REQUIREMENT: SpecFileEntry = {
  path: "specs/requirements/prd.md",
  sha: "r1",
  group: "requirements",
};
const PDF_REF: SpecFileEntry = {
  path: "specs/requirements/references/spec.pdf",
  sha: "e1",
  group: "references",
  size: 20480,
};
const MD_REF: SpecFileEntry = {
  path: "specs/requirements/references/notes.md",
  sha: "e2",
  group: "references",
  size: 1536,
};
const TXT_REF: SpecFileEntry = {
  path: "specs/requirements/references/raw.txt",
  sha: "e3",
  group: "references",
  size: 512,
};

function setup(files: SpecFileEntry[]) {
  const onSelect = vi.fn();
  const onPreviewReference = vi.fn();
  render(
    <SpecFileList
      files={files}
      selection={null}
      onSelect={onSelect}
      onAddArtifact={vi.fn()}
      onRegenerateDesign={vi.fn()}
      onPreviewReference={onPreviewReference}
      deriving={false}
      failed={false}
    />,
  );
  return { onSelect, onPreviewReference };
}

describe("SpecFileList — References section (#383 preview)", () => {
  it("shows a human-readable size next to each reference document", () => {
    setup([PDF_REF, MD_REF, TXT_REF]);

    expect(screen.getByText("20 KB")).toBeInTheDocument();
    expect(screen.getByText("2 KB")).toBeInTheDocument();
    expect(screen.getByText("512 B")).toBeInTheDocument();
  });

  it("opens the preview dialog on click instead of routing through file selection", () => {
    const { onSelect, onPreviewReference } = setup([PDF_REF]);

    fireEvent.click(screen.getByText("spec.pdf"));

    expect(onPreviewReference).toHaveBeenCalledWith(PDF_REF);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders the requirements group unaffected — file rows still select via onSelect", () => {
    const { onSelect } = setup([REQUIREMENT, PDF_REF]);

    fireEvent.click(screen.getByText("prd.md"));

    expect(onSelect).toHaveBeenCalledWith({ path: REQUIREMENT.path, kind: "file" });
  });

  it("renders no References section when there are no reference documents", () => {
    setup([REQUIREMENT]);

    expect(screen.queryByText("References")).not.toBeInTheDocument();
  });
});
