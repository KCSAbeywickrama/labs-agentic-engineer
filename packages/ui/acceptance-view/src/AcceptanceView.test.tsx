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

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AcceptanceView, type AcceptanceFeatureSource } from "./AcceptanceView.js";

/**
 * The scenario list, apart from the toolbar above it.
 *
 * The outcome words now appear twice on the page — once as a filter segment and
 * once as a row's pill — so an unscoped query for "Blocked" is ambiguous by
 * construction rather than by accident.
 */
const list = () => within(screen.getByRole("region", { name: "Acceptance scenarios" }));

/**
 * A step's text is split into spans so its quoted literals can be emphasised,
 * which defeats getByText on the whole sentence. This matches the one element
 * whose own text is the sentence.
 */
function step(text: string) {
  return (_: string, element: Element | null) =>
    element?.tagName === "SPAN" && element.textContent === text;
}

const BOUGHT: AcceptanceFeatureSource = {
  path: "specs/acceptance/bought-items.feature",
  content: [
    "Feature: Bought items",
    "",
    "  @story-6",
    "  Rule: A bought item is locked from further edits",
    "",
    "    @negative",
    "    Scenario: Editing a bought item is refused",
    '      Given the shared list has a bought item named "Eggs"',
    '      When Dev tries to change the quantity of "Eggs" to "2"',
    '      Then the quantity of "Eggs" is still "1"',
    "",
    "    Scenario: Marking an item bought",
    '      When Priya marks "Eggs" as bought',
    '      Then the list shows "Eggs" as bought',
  ].join("\n"),
};

const ADDING: AcceptanceFeatureSource = {
  path: "specs/acceptance/adding-items.feature",
  content: [
    "Feature: Adding items",
    "",
    "  @story-2",
    "  Rule: An item is added with a name and a quantity",
    "",
    "    Scenario: Adding a new item",
    '      When Priya adds "Milk"',
    '      Then the list shows "Milk"',
  ].join("\n"),
};

function report(scenarios: unknown[]): string {
  return JSON.stringify({
    schemaVersion: 2,
    commit: "4f2ad1088c7e",
    baseUrl: "http://shopping-list.localhost:19080/",
    isolation: "Each scenario created the list it asserts on.",
    scenarios,
  });
}

const BLOCKED = {
  feature: "Bought items",
  featureFile: "specs/acceptance/bought-items.feature",
  rule: "A bought item is locked from further edits",
  scenario: "Editing a bought item is refused",
  outcome: "blocked",
  steps: [
    { text: 'the shared list has a bought item named "Eggs"', keyword: "Given", command: "POST /items", exit: 0 },
    {
      text: 'Dev tries to change the quantity of "Eggs" to "2"',
      keyword: "When",
      command: "agent-browser wait --fn '(() => row.querySelectorAll(\"button\").length === 0)()'",
      exit: 0,
      observed: "the Actions cell is a literal em dash and the row holds zero buttons",
    },
  ],
};

const PASSED = {
  feature: "Bought items",
  featureFile: "specs/acceptance/bought-items.feature",
  rule: "A bought item is locked from further edits",
  scenario: "Marking an item bought",
  outcome: "passed",
  steps: [
    { text: 'Priya marks "Eggs" as bought', keyword: "When", command: "agent-browser click", exit: 0 },
    { text: 'the list shows "Eggs" as bought', keyword: "Then", command: "agent-browser wait", exit: 0 },
  ],
};

describe("the specification alone", () => {
  it("groups by feature, and counts rules, scenarios and refusals", () => {
    render(<AcceptanceView features={[BOUGHT, ADDING]} />);
    expect(screen.getByText("Bought items")).toBeInTheDocument();
    expect(screen.getByText("Adding items")).toBeInTheDocument();
    expect(screen.getByText("1 rule · 2 scenarios · 1 refusal")).toBeInTheDocument();
    expect(screen.getByText("1 rule · 1 scenario")).toBeInTheDocument();
    expect(screen.getByText("2 capabilities · 2 rules · 3 scenarios · 1 refusal")).toBeInTheDocument();
  });

  it("opens nothing by itself, and opens on a click", () => {
    render(<AcceptanceView features={[BOUGHT]} />);
    expect(screen.queryByText(step('Dev tries to change the quantity of "Eggs" to "2"'))).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Editing a bought item is refused"));
    expect(screen.getByText(step('Dev tries to change the quantity of "Eggs" to "2"'))).toBeInTheDocument();
    expect(screen.getByText("Given")).toBeInTheDocument();
  });

  it("carries no outcome chip where there is no run", () => {
    render(<AcceptanceView features={[BOUGHT]} />);
    expect(screen.queryByText("Passed")).not.toBeInTheDocument();
    expect(list().queryByText("No result")).not.toBeInTheDocument();
  });

  // It was an inline glyph with visually-hidden text; the reference design draws
  // tags as pills, and `@negative` is a tag — so it renders as one and becomes
  // filterable, which a glyph never was.
  it("marks a refusal with its own tag, which is also a filter", () => {
    render(<AcceptanceView features={[BOUGHT]} />);
    expect(list().getByText("@negative")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "@negative" })).toBeInTheDocument();
  });
});

describe("joined against a run", () => {
  it("chips each scenario with the report's own word", () => {
    render(<AcceptanceView features={[BOUGHT]} report={report([BLOCKED, PASSED])} />);
    expect(list().getByText("Blocked")).toBeInTheDocument();
    expect(list().getByText("Passed")).toBeInTheDocument();
  });

  it("renders an outcome word it does not know rather than mislabelling it", () => {
    render(
      <AcceptanceView features={[BOUGHT]} report={report([{ ...BLOCKED, outcome: "abandoned" }, PASSED])} />,
    );
    expect(list().getByText("Abandoned")).toBeInTheDocument();
  });

  it("says why a non-passed scenario is not passed without being opened", () => {
    render(<AcceptanceView features={[BOUGHT]} report={report([BLOCKED, PASSED])} />);
    expect(
      screen.getByText("the Actions cell is a literal em dash and the row holds zero buttons"),
    ).toBeInTheDocument();
  });

  it("stops a blocked scenario at the step the run reached", () => {
    render(<AcceptanceView features={[BOUGHT]} report={report([BLOCKED, PASSED])} />);
    fireEvent.click(screen.getByText("Editing a bought item is refused"));
    // The report has two steps; the feature file declares three, and the third
    // is specification the run never got to.
    expect(screen.getByText(step('the quantity of "Eggs" is still "1"'))).toBeInTheDocument();
    expect(screen.getByText("not reached")).toBeInTheDocument();
  });

  it("marks a nonzero exit and leaves a zero one unmarked", () => {
    const failed = {
      ...PASSED,
      outcome: "failed",
      steps: [
        { text: 'Priya marks "Eggs" as bought', keyword: "When", command: "agent-browser click", exit: 0 },
        {
          text: 'the list shows "Eggs" as bought',
          keyword: "Then",
          command: 'agent-browser get count "tbody tr"',
          exit: 1,
          observed: "2 — the list holds two rows",
        },
      ],
    };
    render(<AcceptanceView features={[BOUGHT]} report={report([BLOCKED, failed])} />);
    fireEvent.click(screen.getByText("Marking an item bought"));
    expect(screen.getByText("exit 1")).toBeInTheDocument();
    expect(screen.queryByText("exit 0")).not.toBeInTheDocument();
  });

  it("says No result for a scenario written since the run", () => {
    render(<AcceptanceView features={[BOUGHT, ADDING]} report={report([BLOCKED, PASSED])} />);
    expect(list().getByText("No result")).toBeInTheDocument();
  });

  it("withholds No result while an attempt is still in flight", () => {
    render(
      <AcceptanceView features={[BOUGHT, ADDING]} report={report([BLOCKED, PASSED])} awaitingReport />,
    );
    expect(list().queryByText("No result")).not.toBeInTheDocument();
  });

  it("keeps a scenario the run answered that the specification no longer declares", () => {
    const gone = { ...PASSED, scenario: "Clearing bought items", rule: "All bought items can be cleared" };
    render(<AcceptanceView features={[BOUGHT]} report={report([BLOCKED, PASSED, gone])} />);
    expect(screen.getByText("NOT IN THE CURRENT SPECIFICATION")).toBeInTheDocument();
    expect(screen.getByText("Clearing bought items")).toBeInTheDocument();
  });

  it("shows the run's provenance and keeps the isolation note behind a disclosure", () => {
    render(<AcceptanceView features={[BOUGHT]} report={report([BLOCKED, PASSED])} />);
    expect(screen.getByText(/4f2ad10/)).toBeInTheDocument();
    expect(screen.queryByText("Each scenario created the list it asserts on.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("How the scenarios were kept apart"));
    expect(screen.getByText("Each scenario created the list it asserts on.")).toBeInTheDocument();
  });

  it("drops to the specification with a warning when the report cannot be read", () => {
    render(<AcceptanceView features={[BOUGHT]} report="{ not json" />);
    expect(screen.getByText(/could not be read/)).toBeInTheDocument();
    expect(screen.getByText("Editing a bought item is refused")).toBeInTheDocument();
    expect(list().queryByText("No result")).not.toBeInTheDocument();
  });
});

describe("with nothing to show", () => {
  it("says the criteria have not been written yet", () => {
    render(<AcceptanceView features={[]} />);
    expect(screen.getByText("No acceptance criteria yet")).toBeInTheDocument();
  });
});

describe("the toolbar", () => {
  const search = () => screen.getByRole("textbox", { name: "Filter scenarios" });
  const rows = () => list().getAllByRole("button", { expanded: false }).map((b) => b.textContent ?? "");

  it("narrows on a scenario name", () => {
    render(<AcceptanceView features={[BOUGHT, ADDING]} />);
    fireEvent.change(search(), { target: { value: "marking" } });
    expect(list().getByText("Marking an item bought")).toBeInTheDocument();
    expect(list().queryByText("Adding a new item")).not.toBeInTheDocument();
  });

  // The step text is the point: a reader looking for where "Eggs" is asserted
  // will not remember which scenario name it lives under.
  it("narrows on the text of a step, not just the name", () => {
    render(<AcceptanceView features={[BOUGHT, ADDING]} />);
    // "Eggs" appears in no scenario name, no rule and no tag — only in steps.
    fireEvent.change(search(), { target: { value: "eggs" } });
    expect(list().getByText("Editing a bought item is refused")).toBeInTheDocument();
    expect(list().queryByText("Adding a new item")).not.toBeInTheDocument();
  });

  // The rule is part of the haystack too: it is on screen above the scenario,
  // so a reader who searches for a phrase they can see expects a hit.
  it("narrows on the rule a scenario sits under", () => {
    render(<AcceptanceView features={[BOUGHT, ADDING]} />);
    fireEvent.change(search(), { target: { value: "locked from further edits" } });
    expect(list().getByText("Editing a bought item is refused")).toBeInTheDocument();
    expect(list().queryByText("Adding a new item")).not.toBeInTheDocument();
  });

  it("says how much it is hiding, and shows the total when it is hiding nothing", () => {
    render(<AcceptanceView features={[BOUGHT, ADDING]} />);
    expect(screen.getByText("3 scenarios")).toBeInTheDocument();
    fireEvent.change(search(), { target: { value: "marking" } });
    expect(screen.getByText("1 of 3 scenarios match")).toBeInTheDocument();
  });

  it("clears the query from the field's own button", () => {
    render(<AcceptanceView features={[BOUGHT, ADDING]} />);
    fireEvent.change(search(), { target: { value: "marking" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear the filter" }));
    expect(list().getByText("Adding a new item")).toBeInTheDocument();
  });

  it("narrows on a tag", () => {
    render(<AcceptanceView features={[BOUGHT, ADDING]} />);
    fireEvent.click(screen.getByRole("button", { name: "@negative" }));
    expect(list().getByText("Editing a bought item is refused")).toBeInTheDocument();
    expect(list().queryByText("Marking an item bought")).not.toBeInTheDocument();
  });

  it("resets every filter at once", () => {
    render(<AcceptanceView features={[BOUGHT, ADDING]} />);
    fireEvent.change(search(), { target: { value: "refused" } });
    fireEvent.click(screen.getByRole("button", { name: "@negative" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText("3 scenarios")).toBeInTheDocument();
    expect(list().getByText("Adding a new item")).toBeInTheDocument();
  });

  it("offers a way back when the filters match nothing", () => {
    render(<AcceptanceView features={[BOUGHT, ADDING]} />);
    fireEvent.change(search(), { target: { value: "nothing matches this" } });
    expect(screen.getByText("No matching scenarios")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(list().getByText("Adding a new item")).toBeInTheDocument();
  });

  it("opens and closes every scenario at once", () => {
    render(<AcceptanceView features={[BOUGHT, ADDING]} />);
    const open = () => list().queryAllByRole("button", { expanded: true }).length;
    const shut = () => list().queryAllByRole("button", { expanded: false }).length;

    // Three scenarios, and the two group headers are open from the start.
    expect(open()).toBe(2);
    expect(shut()).toBe(3);

    fireEvent.click(screen.getByRole("button", { name: /Expand all/ }));
    expect(shut()).toBe(0);
    expect(
      screen.getByText(step('Dev tries to change the quantity of "Eggs" to "2"')),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Collapse all/ }));
    expect(shut()).toBe(3);
  });

  // Without a run there is nothing to filter outcomes by, so the control is
  // absent rather than present and inert.
  it("offers no outcome filter where there is no run", () => {
    render(<AcceptanceView features={[BOUGHT, ADDING]} />);
    expect(screen.queryByRole("group", { name: "Filter by outcome" })).not.toBeInTheDocument();
  });

  it("offers only the outcomes the run produced, and narrows on them", () => {
    render(<AcceptanceView features={[BOUGHT, ADDING]} report={report([BLOCKED, PASSED])} />);
    const group = within(screen.getByRole("group", { name: "Filter by outcome" }));
    expect(group.getByRole("button", { name: "Blocked" })).toBeInTheDocument();
    expect(group.queryByRole("button", { name: "Failed" })).not.toBeInTheDocument();

    fireEvent.click(group.getByRole("button", { name: "Blocked" }));
    expect(list().getByText("Editing a bought item is refused")).toBeInTheDocument();
    expect(list().queryByText("Marking an item bought")).not.toBeInTheDocument();
  });
});

