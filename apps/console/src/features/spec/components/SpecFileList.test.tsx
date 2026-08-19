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
import { describe, expect, it, vi } from "vitest";

import { SpecFileList } from "./SpecFileList";
import type { SpecFileEntry } from "../api/mapping";

/** The real paths a generated ai-agent project produces. */
function designFiles(...paths: string[]): SpecFileEntry[] {
  return paths.map((path, i) => ({ path, sha: `sha${i}`, group: "designs" }));
}

function renderList(files: SpecFileEntry[]) {
  render(
    <SpecFileList
      files={files}
      selection={null}
      onSelect={vi.fn()}
      onAddArtifact={vi.fn()}
      onRegenerateDesign={vi.fn()}
      deriving={false}
      failed={false}
    />,
  );
}

describe("SpecFileList — artifact labels", () => {
  it("names an ai-agent's agent.afm.md 'Agent Spec' rather than its file name", () => {
    renderList(designFiles("specs/design/components/booking-agent/agent.afm.md"));

    expect(screen.getByText("Agent Spec")).toBeInTheDocument();
    expect(screen.queryByText("agent.afm.md")).not.toBeInTheDocument();
  });

  it("keeps the established labels for the sibling design artifacts", () => {
    renderList(
      designFiles(
        "specs/design/components/hotel-api/openapi.yaml",
        "specs/design/components/hotel-api/design.json",
      ),
    );

    expect(screen.getByText("API Spec")).toBeInTheDocument();
    expect(screen.getByText("Design Overview")).toBeInTheDocument();
  });
});
