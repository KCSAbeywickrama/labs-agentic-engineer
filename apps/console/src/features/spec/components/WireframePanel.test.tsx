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

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { WireframePanel } from "./WireframePanel";
import type { CollabSpec } from "../collab/useCollabSpec";

// The heavy lazy canvas is irrelevant here — record what scene it receives.
vi.mock("@aep/ui-excalidraw-view", () => ({
  ExcalidrawView: ({ scene }: { scene: string }) => (
    <div
      data-testid="excalidraw"
      data-elements={String(JSON.parse(scene).elements?.length ?? 0)}
    />
  ),
}));

// The committed-file query is configured per test.
const mockDerived = vi.fn();
vi.mock("../api/useDerivedDesign", () => ({
  useDerivedWireframe: (...args: unknown[]) => mockDerived(...args),
}));

const DSL_PATH = "specs/design/components/shop-webapp/wireframes.dsl";

function makeCollab(ytext: Y.Text | null, agent = true): CollabSpec {
  return {
    peers: agent ? [{ kind: "agent", name: "agent" }] : [],
    getFileText: (path: string) => (path === DSL_PATH ? ytext : null),
  } as unknown as CollabSpec;
}

function renderPanel(collab: CollabSpec) {
  return render(
    <WireframePanel projectName="p" dslPath={DSL_PATH} files={[]} collab={collab} />,
  );
}

beforeEach(() => {
  mockDerived.mockReset();
});

describe("WireframePanel streaming", () => {
  it("draws the live DSL as it streams into the collab doc, and grows with it", () => {
    // Committed file not there yet (mid-turn fetch fails) — live doc drives.
    mockDerived.mockReturnValue({ scene: null, isPending: false, isError: true });
    const doc = new Y.Doc();
    const ytext = doc.getText(DSL_PATH);
    renderPanel(makeCollab(ytext));

    // Nothing streamed yet + agent in room → waiting state, no error.
    expect(screen.getByText(/waiting for the agent/i)).toBeInTheDocument();

    // First line-flush: one screen header.
    act(() => {
      ytext.insert(0, 'screen Catalog "Shoppers browse products"\n  navbar "Shop"\n');
    });
    expect(screen.getByText("Drawing…")).toBeInTheDocument();
    const first = Number(screen.getByTestId("excalidraw").dataset.elements);
    expect(first).toBeGreaterThan(0);

    // More lines arrive: the scene grows in place.
    act(() => {
      ytext.insert(ytext.length, '  heading "Browse products"\n  button "View cart" primary\n');
    });
    const grown = Number(screen.getByTestId("excalidraw").dataset.elements);
    expect(grown).toBeGreaterThan(first);
  });

  it("holds the last good scene when an intermediate compile fails", () => {
    mockDerived.mockReturnValue({ scene: null, isPending: false, isError: true });
    const doc = new Y.Doc();
    const ytext = doc.getText(DSL_PATH);
    renderPanel(makeCollab(ytext));

    act(() => {
      ytext.insert(0, 'screen Catalog "Shop"\n  heading "Browse"\n');
    });
    const good = Number(screen.getByTestId("excalidraw").dataset.elements);
    expect(good).toBeGreaterThan(0);

    // Replace with an uncompilable body — the drawn screens must not blank.
    act(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, "garbage {{{");
    });
    expect(Number(screen.getByTestId("excalidraw").dataset.elements)).toBe(good);
  });

  it("prefers the committed scene once it resolves (no streaming chip)", () => {
    const committed = JSON.stringify({ elements: [{ type: "rectangle" }] });
    mockDerived.mockReturnValue({ scene: committed, isPending: false, isError: false });
    const doc = new Y.Doc();
    const ytext = doc.getText(DSL_PATH);
    ytext.insert(0, 'screen Old "stale live text"\n');
    renderPanel(makeCollab(ytext, false));

    expect(screen.queryByText("Drawing…")).not.toBeInTheDocument();
    expect(screen.getByTestId("excalidraw").dataset.elements).toBe("1");
  });

  it("shows the plain error only when no agent is in the room", () => {
    mockDerived.mockReturnValue({ scene: null, isPending: false, isError: true });
    renderPanel(makeCollab(null, false));
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
  });
});
