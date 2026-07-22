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
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { CellDiagramPanel } from "./CellDiagramPanel";
import { DESIGN_CELL_PATH } from "../api/designTree";
import type { CollabSpec } from "../collab/useCollabSpec";

// The heavy lazy renderer is irrelevant here — record what source it receives.
vi.mock("@aep/ui-cell-diagram-view", () => ({
  CellDiagramView: ({ source }: { source?: string }) => (
    <div data-testid="cell-view" data-source={source ?? ""} />
  ),
}));

// The committed/derived DSL is configured per test.
const mockDerived = vi.fn();
vi.mock("../api/useDerivedDesign", () => ({
  useDerivedCellDiagram: (...args: unknown[]) => mockDerived(...args),
}));

const DERIVED_DSL = "title Committed\ncomponent api service\n";
const LIVE_DSL = "title Live\ncomponent api service\nsouth email-provider\n";

function makeCollab(ytext: Y.Text | null): CollabSpec {
  return {
    peers: [{ kind: "agent", name: "agent" }],
    getFileText: (path: string) => (path === DESIGN_CELL_PATH ? ytext : null),
  } as unknown as CollabSpec;
}

function renderPanel(collab: CollabSpec, preferLiveCell = false) {
  return render(
    <CellDiagramPanel
      projectName="p"
      files={[]}
      collab={collab}
      preferLiveCell={preferLiveCell}
    />,
  );
}

function liveText(content: string): Y.Text {
  const doc = new Y.Doc();
  const ytext = doc.getMap<Y.Text>("files").set(DESIGN_CELL_PATH, new Y.Text());
  ytext.insert(0, content);
  return ytext;
}

beforeEach(() => {
  mockDerived.mockReset();
});

describe("CellDiagramPanel source precedence", () => {
  it("renders the derived (committed) DSL between turns", () => {
    mockDerived.mockReturnValue({ dsl: DERIVED_DSL, isPending: false, isError: false });
    renderPanel(makeCollab(liveText(LIVE_DSL)));

    expect(screen.getByTestId("cell-view").dataset.source).toBe(DERIVED_DSL);
    expect(screen.queryByText("Designing…")).not.toBeInTheDocument();
  });

  it("renders the live stream when the derived DSL is not yet resolved", () => {
    mockDerived.mockReturnValue({ dsl: null, isPending: false, isError: false });
    renderPanel(makeCollab(liveText(LIVE_DSL)));

    expect(screen.getByTestId("cell-view").dataset.source).toBe(LIVE_DSL);
    expect(screen.getByText("Designing…")).toBeInTheDocument();
  });

  it("prefers the live stream over a stale derived DSL after a rewrite (preferLiveCell)", () => {
    mockDerived.mockReturnValue({ dsl: DERIVED_DSL, isPending: false, isError: false });
    renderPanel(makeCollab(liveText(LIVE_DSL)), true);

    expect(screen.getByTestId("cell-view").dataset.source).toBe(LIVE_DSL);
    expect(screen.getByText("Designing…")).toBeInTheDocument();
  });

  it("holds the derived DSL through the removeFile→addFile gap (preferLiveCell, empty live)", () => {
    mockDerived.mockReturnValue({ dsl: DERIVED_DSL, isPending: false, isError: false });
    renderPanel(makeCollab(null), true);

    expect(screen.getByTestId("cell-view").dataset.source).toBe(DERIVED_DSL);
  });
});
