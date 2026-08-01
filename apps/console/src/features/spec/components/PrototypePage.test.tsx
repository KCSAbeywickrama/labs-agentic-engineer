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
import { PrototypePage } from "./PrototypePage";

// Router replaced so the back-link renders as a plain anchor — no
// RouterProvider needed (mirrors ValidationPage.test.tsx / WireframePanel.test.tsx).
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

// The heavy lazy canvas is irrelevant here — record what model/initialScreen it receives.
vi.mock("@aep/ui-excalidraw-view", () => ({
  PrototypeView: (p: { model: { screens: unknown[] }; initialScreen?: string }) => (
    <div data-testid="prototype" data-initial={p.initialScreen ?? ""} />
  ),
}));

const mockFiles = vi.fn();
vi.mock("../api/queries", () => ({
  useSpecFiles: (...args: unknown[]) => mockFiles(...args),
}));

const mockDerivedPrototype = vi.fn();
vi.mock("../api/useDerivedDesign", () => ({
  useDerivedPrototype: (...args: unknown[]) => mockDerivedPrototype(...args),
}));

const FILES = [
  { path: "specs/design/components/shop/wireframes.dsl", sha: "abc", group: "designs" as const },
];
const MODEL = {
  screens: [{ name: "Login", width: 1280, height: 800, sceneJson: "{}", hotspots: [] }],
};

beforeEach(() => {
  mockFiles.mockReset();
  mockDerivedPrototype.mockReset();
});

describe("PrototypePage", () => {
  it("resolves the component's wireframe and renders the prototype with the deep-linked screen", () => {
    mockFiles.mockReturnValue({ data: FILES, isPending: false, isError: false });
    mockDerivedPrototype.mockReturnValue({ model: MODEL, isPending: false, isError: false });
    render(
      <PrototypePage projectName="p" component="shop" screen="Login" onScreenChange={vi.fn()} />,
    );
    expect(screen.getByTestId("prototype")).toHaveAttribute("data-initial", "Login");
  });

  it("explains when the component has no wireframes", () => {
    mockFiles.mockReturnValue({ data: [], isPending: false, isError: false });
    mockDerivedPrototype.mockReturnValue({ model: null, isPending: false, isError: false });
    render(<PrototypePage projectName="p" component="shop" onScreenChange={vi.fn()} />);
    expect(screen.getByText(/no wireframes/i)).toBeInTheDocument();
  });

  it("shows a spinner while the spec files are loading", () => {
    mockFiles.mockReturnValue({ data: undefined, isPending: true, isError: false });
    mockDerivedPrototype.mockReturnValue({ model: null, isPending: false, isError: false });
    render(<PrototypePage projectName="p" component="shop" onScreenChange={vi.fn()} />);
    expect(screen.getByLabelText(/loading/i)).toBeInTheDocument();
  });

  it("shows an error alert when the spec files fail to load", () => {
    mockFiles.mockReturnValue({ data: undefined, isPending: false, isError: true });
    mockDerivedPrototype.mockReturnValue({ model: null, isPending: false, isError: false });
    render(<PrototypePage projectName="p" component="shop" onScreenChange={vi.fn()} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows a spinner while the prototype model is deriving", () => {
    mockFiles.mockReturnValue({ data: FILES, isPending: false, isError: false });
    mockDerivedPrototype.mockReturnValue({ model: null, isPending: true, isError: false });
    render(<PrototypePage projectName="p" component="shop" onScreenChange={vi.fn()} />);
    expect(screen.getByLabelText(/loading/i)).toBeInTheDocument();
  });

  it("explains when the wireframe could not be rendered as a prototype", () => {
    mockFiles.mockReturnValue({ data: FILES, isPending: false, isError: false });
    mockDerivedPrototype.mockReturnValue({ model: null, isPending: false, isError: false });
    render(<PrototypePage projectName="p" component="shop" onScreenChange={vi.fn()} />);
    expect(screen.getByText(/could not be rendered/i)).toBeInTheDocument();
  });
});
