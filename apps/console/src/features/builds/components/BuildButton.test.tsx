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

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OxygenTheme, OxygenUIThemeProvider } from "@wso2/oxygen-ui";
import type { ProjectChat, TurnPhase } from "../../agent-chat/chatStore";
import type { ProjectBuild } from "../api/builds";
import { BuildPickerContext } from "../buildPicker";

// The header's Build as the Builds page and the Design card draw it, on the
// one build action every Build reads: a designed feature offers Build v1,
// and a turn in the project's chat holds it until the turn ends.

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
}));

const F1 = { id: "F1", name: "Submit expenses", path: "specs/requirements/features/F1-submit-expenses.md", stage: "Designed", blocking: [], toConfirm: 0, designOutOfDate: false };
vi.mock("../../spec/useSpecWorkspace", () => ({
  useSpecWorkspace: () => ({
    model: { data: { design: { designedFrom: { F1: "basis" } } } },
    workspace: { features: [F1], productWide: [] },
    lines: new Map(),
  }),
}));
vi.mock("../../design/useDesignModel", () => ({ useDesignModel: () => ({ data: { dependencies: [] } }) }));
vi.mock("../../design/useWaitingComments", () => ({ useWaitingComments: () => 0 }));
const builds: ProjectBuild[] = [];
vi.mock("../api/builds", () => ({ useBuilds: () => ({ data: builds }) }));

let turn: TurnPhase = { phase: "idle" };
vi.mock("../../agent-chat/useProjectChat", () => ({
  useProjectChat: (): ProjectChat => ({ status: "ready", error: null, items: [], turn }),
}));

const { BuildButton } = await import("./BuildButton");

function renderButton() {
  render(
    <OxygenUIThemeProvider theme={OxygenTheme}>
      <BuildPickerContext.Provider value={{ open: vi.fn() }}>
        <BuildButton projectName="acme-expenses" />
      </BuildPickerContext.Provider>
    </OxygenUIThemeProvider>,
  );
}

beforeEach(() => {
  turn = { phase: "idle" };
});
afterEach(cleanup);

describe("Build while the agent works", () => {
  it("offers Build v1 once a feature is designed and the chat is idle", () => {
    renderButton();
    expect(screen.getByRole("button", { name: "Build v1" })).toBeInTheDocument();
  });

  it("holds Build while a Design or Address comments turn starts or runs", () => {
    turn = { phase: "starting", instruction: "/design F1" };
    renderButton();
    expect(screen.queryByRole("button", { name: /Build/ })).toBeNull();
    cleanup();

    turn = { phase: "running", turnId: "t1", instruction: "/address-comments" };
    renderButton();
    expect(screen.queryByRole("button", { name: /Build/ })).toBeNull();
  });
});
