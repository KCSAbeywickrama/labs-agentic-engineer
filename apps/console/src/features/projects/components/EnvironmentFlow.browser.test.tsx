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

// The flow's two LAYOUT promises, measured rather than asserted from the `sx`
// objects that are supposed to keep them:
//
//   1. every card is as tall as the tallest, so the row reads as one band;
//   2. each card's trailing step is pinned to the card's bottom, so the
//      promote rows land on one line across the pipeline however tall each
//      card's component and connection lists make it.
//
// This lives in the BROWSER lane because both are layout computations —
// `alignItems: stretch` on the row and `mt: "auto"` on the pinned step — and
// jsdom has no layout engine. The default suite can only re-read the style
// object, which is the thing under test.

import type { ElementType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OxygenTheme, OxygenUIThemeProvider } from "@wso2/oxygen-ui";
import type { components } from "../../../generated/aep-api";

vi.mock("@tanstack/react-router", () => ({
  createLink: (Component: ElementType) =>
    function MockLink({
      to,
      params,
      ...rest
    }: { to: string; params?: Record<string, unknown> } & Record<string, unknown>) {
      let href = to;
      for (const [key, value] of Object.entries(params ?? {})) {
        href = href.replace(`$${key}`, String(value));
      }
      return <Component component="a" href={href} {...rest} />;
    },
  Link: ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => (
    <a {...rest}>{children}</a>
  ),
}));

import { environmentRows } from "../lib/deploymentLedger";
import { promoteStep } from "../lib/deploymentFlow";
import type { EnvironmentInfo } from "../lib/environments";
import type { DeploymentBoard, DeploymentCard } from "../lib/deploymentRows";
import { EnvironmentFlow } from "./EnvironmentFlow";

type DeployStage = components["schemas"]["DeployStage"];

const envs: EnvironmentInfo[] = [
  { name: "development", displayName: "Development", isProduction: false, validation: "on", position: 0, promotesTo: "staging" },
  { name: "staging", displayName: "Staging", isProduction: false, validation: "off", position: 1, promotesTo: "production" },
  { name: "production", displayName: "Production", isProduction: true, validation: "off", position: 2 },
];

/** Six components in development and none anywhere else — so the entry card
 *  is much the tallest and the later two must be stretched to meet it. That
 *  height difference is the whole point: it is what `mt: "auto"` acts on. */
function lopsidedBoard(): DeploymentBoard {
  const cards: DeploymentCard[] = Array.from({ length: 6 }, (_, i) => ({
    componentName: `svc-${i}`,
    displayName: `Service ${i}`,
    kind: "success" as const,
    deployment: {
      componentName: `svc-${i}`,
      environment: "development",
      status: "Ready",
      createdAt: "2026-09-16T09:00:00Z",
    },
  }));
  return new Map([["development", cards]]);
}

function renderFlow() {
  const deploy: DeployStage = {
    components: { ready: 6, total: 6 },
    status: "deployed",
    validation: "passed",
    version: "v4",
  };
  const rows = environmentRows(lopsidedBoard(), envs, deploy);
  const target = rows[1]!;
  render(
    <OxygenUIThemeProvider theme={OxygenTheme}>
      <div style={{ width: 1400 }}>
        <EnvironmentFlow
          projectName="expense"
          environments={envs}
          rows={rows}
          deploy={deploy}
          version="v4"
          validation={{ verdict: "passed", repairing: false }}
          hold={null}
          componentTypes={new Map()}
          connections={[]}
          promote={promoteStep(deploy, target, [], {}, null, "v4")}
          pending={{ deploy: false, connections: false, validation: false, hold: false }}
          onPromote={vi.fn()}
          onTryOut={vi.fn()}
          onConfigureConnection={vi.fn()}
          onConfigurePromoteTarget={vi.fn()}
        />
      </div>
    </OxygenUIThemeProvider>,
  );
  return envs.map((e) => screen.getByTestId(`environment-card-${e.name}`));
}

afterEach(cleanup);

describe("EnvironmentFlow layout", () => {
  it("gives every card the tallest card's height", () => {
    const cards = renderFlow();
    const heights = cards.map((c) => Math.round(c.getBoundingClientRect().height));
    // The entry card really is the tall one — otherwise this asserts nothing.
    expect(Math.max(...heights)).toBeGreaterThan(400);
    expect(new Set(heights).size).toBe(1);
  });

  // What pinning actually buys, measured: the trailing steps END on one line
  // — the card's bottom edge. It does NOT put the promote BUTTONS on one
  // line, and cannot: the steps are bottom-aligned, so two promote steps of
  // different heights start at different tops. Measured here at 30px between
  // Development's promote (blockers + button + caption) and Staging's
  // (a single note line); with more blocker rows the offset grows with them.
  // Aligning the buttons themselves would need the cards to share grid rows
  // rather than each being its own flex column — a restructure of the flow,
  // not a tweak to this rule. Recorded rather than asserted away.
  it("lands every promote step on the card's bottom edge", () => {
    const cards = renderFlow();
    const promotes = cards
      .map((card) => card.querySelector('[role="listitem"][aria-label*="Promote"]'))
      .filter((el): el is Element => el !== null);
    expect(promotes.length).toBe(2);

    const bottoms = promotes.map((el) => Math.round(el.getBoundingClientRect().bottom));
    expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThanOrEqual(1);

    // …and the tops do not share a line. This is the documented limit of
    // bottom-pinning, asserted so a future change to it is noticed here.
    const tops = promotes.map((el) => Math.round(el.getBoundingClientRect().top));
    expect(Math.max(...tops) - Math.min(...tops)).toBeGreaterThan(1);
  });

  // The rail is drawn INSIDE each step's left column, below that step's mark,
  // and stops at that step's own bottom. `mt: "auto"` then inserts the slack
  // ABOVE the pinned step — space no rail is drawn through. On any card
  // shorter than the tallest, the connector would visibly stop and restart.
  it("draws a continuous rail into the pinned step, with no gap above it", () => {
    const cards = renderFlow();
    for (const card of cards) {
      const steps = Array.from(card.querySelectorAll('[role="listitem"]'));
      if (steps.length < 2) continue;
      const previous = steps[steps.length - 2]!;
      const trailing = steps[steps.length - 1]!;
      // The left column's second child is the rail; the trailing step's first
      // child of its left column is the mark.
      const rail = previous.firstElementChild!.children[1]!;
      const mark = trailing.firstElementChild!.children[0]!;
      const gap =
        mark.getBoundingClientRect().top - rail.getBoundingClientRect().bottom;
      expect(
        Math.round(gap),
        `${card.getAttribute("data-testid")}: rail stops ${Math.round(gap)}px above the next mark`,
      ).toBeLessThanOrEqual(6);
    }
  });
});
