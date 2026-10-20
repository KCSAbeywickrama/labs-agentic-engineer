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
import { OxygenTheme, OxygenUIThemeProvider } from "@wso2/oxygen-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskLogPhase, TaskLogState } from "../hooks/useTaskLog";

// An empty task log says where its connection is, so "attaching" never stands
// in for "attached, nothing yet" or for "this task has no log of its own".

let state: TaskLogState = { lines: [], executions: [], kind: undefined, phase: "connecting" };
vi.mock("../hooks/useTaskLog", () => ({ useTaskLog: () => state }));

import { TaskLog } from "./TaskLog";

afterEach(cleanup);

function renderPhase(phase: TaskLogPhase, kind = "development") {
  state = { lines: [], executions: [], kind, phase };
  render(
    <OxygenUIThemeProvider theme={OxygenTheme}>
      <TaskLog projectName="shop" issueNumber={7} />
    </OxygenUIThemeProvider>,
  );
}

describe("TaskLog", () => {
  it.each<[TaskLogPhase, RegExp]>([
    ["connecting", /Attaching to the task's log/],
    ["live", /Nothing logged for this task yet/],
    ["reconnecting", /Connection lost, reconnecting/],
    ["ended", /No log of its own/],
  ])("an empty log while %s says so", (phase, copy) => {
    renderPhase(phase);
    expect(screen.getByText(copy)).toBeTruthy();
  });

  it.each<[string | undefined, RegExp]>([
    ["provision", /the platform resolves this gate itself/],
    ["validation", /the version's validation has this task's work/],
    [undefined, /Nothing logged for this task\./],
  ])("an ended, empty %s task does not send the reader to the coding agent", (kind, copy) => {
    state = { lines: [], executions: [], kind, phase: "ended" };
    render(
      <OxygenUIThemeProvider theme={OxygenTheme}>
        <TaskLog projectName="shop" issueNumber={7} />
      </OxygenUIThemeProvider>,
    );
    expect(screen.getByText(copy)).toBeTruthy();
    expect(screen.queryByText(/coding agent/)).toBeNull();
  });

  it("shows a provision gate's outcome, not the coding agent's, when it wrote no lines", () => {
    state = {
      lines: [],
      executions: [{ id: "x1", kind: "provision", status: "succeeded", reason: "Platform resource ready.", createdAt: "2026-10-19T07:44:33Z" }],
      kind: "provision",
      phase: "ended",
    };
    render(
      <OxygenUIThemeProvider theme={OxygenTheme}>
        <TaskLog projectName="shop" issueNumber={7} />
      </OxygenUIThemeProvider>,
    );
    expect(screen.getByText(/provision succeeded: Platform resource ready\./)).toBeTruthy();
    expect(screen.queryByText(/No log of its own/)).toBeNull();
  });

  it("does not say it is attaching once it is attached", () => {
    renderPhase("live");
    expect(screen.queryByText(/Attaching/)).toBeNull();
  });
});
