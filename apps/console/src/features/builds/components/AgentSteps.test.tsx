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

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { OxygenTheme, OxygenUIThemeProvider } from "@wso2/oxygen-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StampedRunEvent } from "../hooks/useRunProgress";
import { AgentSteps } from "./AgentSteps";

// One agent's steps read as a terminal does: oldest first, the newest at the
// bottom, a pane that follows the tail until its reader scrolls up, and then
// holds still while new steps arrive below.

// jsdom has no ResizeObserver, which the pane uses to follow a row that grows.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);

afterEach(cleanup);

const step = (seq: number): StampedRunEvent =>
  ({
    v: 2,
    seq,
    ts: new Date(Date.UTC(2026, 9, 1, 9, 0, seq)).toISOString(),
    agentId: "lead",
    cycleId: "c1",
    attempt: 1,
    kind: "tool_use",
    tool: "Bash",
    summary: `step ${String(seq)}`,
    toolUseId: `t${String(seq)}`,
  }) as StampedRunEvent;

const stepsTo = (n: number) => Array.from({ length: n }, (_, i) => step(i + 1));

function renderSteps(steps: StampedRunEvent[]) {
  const view = render(
    <OxygenUIThemeProvider theme={OxygenTheme}>
      <AgentSteps steps={steps} />
    </OxygenUIThemeProvider>,
  );
  return {
    rerender: (next: StampedRunEvent[]) =>
      view.rerender(
        <OxygenUIThemeProvider theme={OxygenTheme}>
          <AgentSteps steps={next} />
        </OxygenUIThemeProvider>,
      ),
  };
}

const rows = () => within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");

/** jsdom lays nothing out: give the pane a height and put the reader `fromBottom` pixels above its end. */
function scrollPane(fromBottom: number) {
  const pane = screen.getByRole("list", { name: "Steps" }).parentElement;
  if (!pane) throw new Error("no pane");
  Object.defineProperty(pane, "scrollHeight", { configurable: true, value: 5000 });
  Object.defineProperty(pane, "clientHeight", { configurable: true, value: 380 });
  act(() => {
    pane.scrollTop = 5000 - 380 - fromBottom;
    fireEvent.scroll(pane);
  });
}

describe("an agent's steps", () => {
  it("run oldest first, the newest at the bottom", () => {
    renderSteps(stepsTo(3));
    expect(rows().map((r) => r.textContent)).toEqual([
      expect.stringContaining("$ step 1"),
      expect.stringContaining("$ step 2"),
      expect.stringContaining("$ step 3"),
    ]);
  });

  it("draw the newest 200, and the earlier ones on request above them", () => {
    renderSteps(stepsTo(250));
    expect(rows()).toHaveLength(200);
    expect(rows()[0]).toHaveTextContent("$ step 51");
    fireEvent.click(screen.getByRole("button", { name: "Show 50 earlier steps" }));
    expect(rows()).toHaveLength(250);
    expect(rows()[0]).toHaveTextContent("$ step 1");
  });

  it("offer no way back while the reader follows the newest", () => {
    renderSteps(stepsTo(3));
    scrollPane(0);
    expect(screen.queryByRole("button", { name: /Latest/ })).not.toBeInTheDocument();
  });

  it("hold still while the reader reads back, counting what arrived below, until they jump to the latest", () => {
    const { rerender } = renderSteps(stepsTo(250));
    scrollPane(600);
    expect(screen.getByRole("button", { name: "Latest" })).toBeInTheDocument();

    rerender(stepsTo(253));
    // The window's first row did not slide: what the reader is reading stays where it was.
    expect(rows()[0]).toHaveTextContent("$ step 51");
    expect(rows().at(-1)).toHaveTextContent("$ step 253");
    fireEvent.click(screen.getByRole("button", { name: "Latest · 3 new" }));

    expect(screen.queryByRole("button", { name: /Latest/ })).not.toBeInTheDocument();
    // Following again, the window rejoins the tail.
    expect(rows()[0]).toHaveTextContent("$ step 54");
  });

  it("say so when the agent has none", () => {
    renderSteps([]);
    expect(screen.getByText("No steps from this agent yet.")).toBeInTheDocument();
  });
});
