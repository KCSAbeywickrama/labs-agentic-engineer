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

// THE TREE'S ROWS, MEASURED.
//
// The middle elision is a CSS claim and belongs in the browser lane for the same
// reason the timeline's lanes do: what is elided depends on how wide the column
// turned out, and jsdom has no layout engine to decide it. A jsdom test can
// prove the whole command is still in the DOM — `RunCrew.test.tsx` does — but
// only a real one can prove the reader still SEES the end of it.
//
// The defect this pins: five consecutive rows of one live run all rendered as
// `cd expense-webapp && npm in…`, five different installs a reader could not
// tell apart, because tail truncation eats exactly the half that identifies a
// command.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OxygenTheme, OxygenUIThemeProvider } from "@wso2/oxygen-ui";
import { buildCrew } from "@aep/progress-view";
import { elideMiddle } from "../lib/elide";
import { CrewTree } from "./CrewTree";
import type { StampedRunEvent } from "../hooks/useRunProgress";

const T0 = Date.parse("2026-09-04T09:00:00Z");

let seq = 0;
const ev = (
  seconds: number,
  rest: Partial<StampedRunEvent> & { kind: string; agentId: string },
): StampedRunEvent =>
  ({
    v: 2,
    cycleId: "c1",
    attempt: 1,
    seq: ++seq,
    ts: new Date(T0 + seconds * 1000).toISOString(),
    ...rest,
  }) as StampedRunEvent;

const COMMANDS = [
  "cd expense-webapp && npm install react@19.2.3",
  "cd expense-webapp && npm install vite@7.1.14",
];

/** The tree's real column width on the build page: `theme.spacing(44)`. */
const COLUMN_PX = 352;

function renderTree() {
  const events = [
    ev(0, { kind: "agent_started", agentId: "a1", label: "expense-webapp", depth: 1 }),
    ...COMMANDS.map((summary, i) =>
      ev(1 + i, { kind: "task_started", agentId: "a1", taskId: `bg${String(i)}`, summary }),
    ),
  ];
  const crew = buildCrew(events, T0 + 10_000);
  render(
    <OxygenUIThemeProvider theme={OxygenTheme}>
      <div style={{ width: `${String(COLUMN_PX)}px`, fontFamily: "monospace", fontSize: "13px" }}>
        <CrewTree members={crew.members} selectedId={crew.lead.id} onSelect={() => {}} />
      </div>
    </OxygenUIThemeProvider>,
  );
}

/**
 * One command row and the two halves it draws the command in.
 *
 * The SPLIT is `elideMiddle`, unit-tested on its own; what this file measures is
 * what the browser then does with the halves. Finding them by their exact text
 * is also the check that the row still splits at all — a row that went back to
 * one truncated span has neither.
 */
function commandRow(command: string) {
  const row = screen.getByTitle(command);
  const { head, tail } = elideMiddle(command);
  const spans = [...row.querySelectorAll("span")];
  return {
    row,
    head: spans.find((el) => el.textContent === head),
    tail: spans.find((el) => el.textContent === tail),
  };
}

afterEach(cleanup);

describe("a command in the crew tree", () => {
  it("shows the end of a command the column is too narrow for", () => {
    renderTree();
    for (const command of COMMANDS) {
      const { row, tail } = commandRow(command);
      expect(tail).toBeDefined();
      const box = tail?.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      // Drawn, inside its row, and not clipped: the tail never shrinks, so what
      // tells one npm install from the next is on screen at this width.
      expect(box?.width ?? 0).toBeGreaterThan(0);
      expect(box?.right ?? 0).toBeLessThanOrEqual(Math.ceil(rowBox.right));
      expect(tail?.scrollWidth).toBe(tail?.clientWidth);
    }
  });

  it("is the head that gives way, and it does give way", () => {
    renderTree();
    const { head } = commandRow(COMMANDS[0] ?? "");
    expect(head).toBeDefined();
    // The proof it is eliding at this width rather than merely being allowed
    // to: the head's content is wider than the box drawing it.
    expect(head?.scrollWidth ?? 0).toBeGreaterThan(head?.clientWidth ?? 0);
    expect(getComputedStyle(head as Element).textOverflow).toBe("ellipsis");
  });
});
