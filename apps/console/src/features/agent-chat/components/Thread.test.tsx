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

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OxygenTheme, OxygenUIThemeProvider } from "@wso2/oxygen-ui";
import type { ProjectChat } from "../chatStore";

// The conversation's rows that the prototype adds to: a review's request
// summary in place of the wire text, and the Open prototype note action.

let chat: ProjectChat;
vi.mock("../useProjectChat", () => ({
  useProjectChat: () => chat,
  chatStore: {},
  canSend: () => true,
}));
vi.mock("../../spec/useSpecWorkspace", () => ({ useSpecModel: () => ({ data: { features: [] } }) }));
vi.mock("../useStartInterview", () => ({ useStartInterview: () => ({ start: vi.fn(), ready: true, waiting: false }) }));
const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

// jsdom has no ResizeObserver, which the thread uses to follow its growth.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);

const { Thread } = await import("./Thread");

const ready = (items: ProjectChat["items"]): ProjectChat => ({ status: "ready", error: null, items, turn: { phase: "idle" } });

function renderThread() {
  render(
    <OxygenUIThemeProvider theme={OxygenTheme}>
      <Thread projectName="acme" scope={{ kind: "design" }} />
    </OxygenUIThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
  navigate.mockReset();
});

describe("a prototype review in the conversation", () => {
  it("reads as its summary, not as the /prototype line it went over the wire as", () => {
    const summary = "Feedback on the Acme prototype (1 request)\n1. Pending approvals (Manager, Default) — Reject: Wider";
    chat = ready([{ kind: "user", id: "u1", text: "/prototype expense-web", summary, state: "sent" }]);
    renderThread();
    expect(screen.getByText(/Feedback on the Acme prototype \(1 request\)/)).toHaveTextContent(/Reject: Wider/);
    expect(screen.queryByText("/prototype expense-web")).toBeNull();
  });

  it("reads a plain /prototype line (a reload, or Make prototype) as asking for it", () => {
    chat = ready([{ kind: "user", id: "h0", text: "/prototype expense-web", state: "sent" }]);
    renderThread();
    expect(screen.getByText("Prototype expense-web.")).toBeInTheDocument();
  });

  it("opens the component's review from the note's Open prototype", () => {
    chat = ready([
      { kind: "note", id: "n1", text: "Ready.", actions: [{ kind: "open-prototype", label: "Open prototype", component: "expense-web" }] },
    ]);
    renderThread();
    fireEvent.click(screen.getByRole("button", { name: "Open prototype" }));
    expect(navigate).toHaveBeenCalledWith({
      to: "/projects/$projectName/prototype",
      params: { projectName: "acme" },
      search: { review: "expense-web" },
    });
  });

  it("opens the Prototype tab from a note about several", () => {
    chat = ready([
      { kind: "note", id: "n1", text: "Ready.", actions: [{ kind: "open-prototype", label: "Open prototypes", component: null }] },
    ]);
    renderThread();
    fireEvent.click(screen.getByRole("button", { name: "Open prototypes" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/projects/$projectName/prototype", params: { projectName: "acme" }, search: {} });
  });
});
