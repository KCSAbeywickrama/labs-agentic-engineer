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

import {
  decidingStep,
  featureScenarios,
  isReportParseError,
  parseAcceptanceReport,
  parseFeatureFile,
  type ReportScenario,
} from "@aep/ui-acceptance-view";

// PROVISIONAL — client-side until backend B4 groups validation by feature.
//
// Today's validation report is per scenario: the runner's report.json, and
// the acceptance files it was judged against, read at one commit
// (get-validation-report). The Builds card shows it grouped by feature, so
// this is the one place that grouping is worked out: a scenario belongs to the
// feature its story tag names (`@story-F2.4`, on the scenario, its rule or its
// feature, as Gherkin tags inherit), else to the feature file's own `F<n>`
// title. When B4 serves the grouping, `groupByFeature` becomes a read of it
// and nothing that renders the groups changes.

/** passed | failed | blocked | unjudgeable as the report says; `pending` before the report exists. */
export type ScenarioOutcome = string;

export interface ScenarioResult {
  name: string;
  /** The story it proves ("F2.4"); null when it carries no story tag. */
  story: string | null;
  outcome: ScenarioOutcome;
  /** A failed scenario's deciding step: what it expected, and what it got instead. */
  expected: string | null;
  got: string | null;
  /** The scenario's steps as the run recorded them, as log lines. */
  excerpt: string[];
}

export interface FeatureResults {
  /** "F2", or the feature's title when nothing names an ID. */
  id: string;
  name: string;
  scenarios: ScenarioResult[];
  passed: number;
  /** Scenarios judged so far (not pending). */
  judged: number;
}

interface CriteriaFile {
  path: string;
  content: string;
}

const STORY_TAG = /^@story-(.+)$/;
const FEATURE_OF_STORY = /^(F\d+)\./;
const FEATURE_TITLE = /^(F\d+)\s+(.+)$/;

function storyOf(tags: readonly string[][]): string | null {
  for (const list of tags) {
    for (const tag of list) {
      const m = STORY_TAG.exec(tag);
      if (m) return m[1] ?? null;
    }
  }
  return null;
}

function excerptOf(scenario: ReportScenario): string[] {
  const decider = decidingStep(scenario);
  const shown = decider ? scenario.steps.slice(0, scenario.steps.indexOf(decider) + 1) : scenario.steps;
  return shown.flatMap((step) => [
    `${step.keyword} ${step.text}`,
    ...(step.command !== undefined ? [`  $ ${step.command}${step.exit !== undefined ? `  (exit ${step.exit})` : ""}`] : []),
    ...(step.observed !== undefined ? [`  observed: ${step.observed}`] : []),
  ]);
}

function resultOf(name: string, story: string | null, reported: ReportScenario | undefined): ScenarioResult {
  if (!reported) return { name, story, outcome: "pending", expected: null, got: null, excerpt: [] };
  const failed = reported.outcome === "failed";
  const decider = failed ? decidingStep(reported) : undefined;
  return {
    name,
    story,
    outcome: reported.outcome,
    expected: decider ? decider.text : null,
    got: decider ? (decider.observed ?? (decider.exit !== undefined ? `exit ${decider.exit}` : null)) : null,
    excerpt: excerptOf(reported),
  };
}

/**
 * Every scenario of the criteria, grouped by the feature it proves, in the
 * order the files and scenarios come; each with its outcome from the report,
 * or `pending` while the report does not exist yet (`report` null).
 */
export function groupByFeature(criteria: CriteriaFile[], report: string | null | undefined): FeatureResults[] {
  const parsed = report ? parseAcceptanceReport(report) : null;
  const reported = parsed && !isReportParseError(parsed) ? parsed.scenarios : [];
  const groups = new Map<string, FeatureResults>();

  for (const file of [...criteria].sort((a, b) => a.path.localeCompare(b.path))) {
    const feature = parseFeatureFile(file.path, file.content);
    if (!feature) continue;
    const titled = FEATURE_TITLE.exec(feature.name);
    for (const { rule, scenario } of featureScenarios(feature)) {
      const story = storyOf([[...scenario.tags], [...rule.tags], [...feature.tags]]);
      const id = (story && FEATURE_OF_STORY.exec(story)?.[1]) ?? titled?.[1] ?? feature.name;
      const name = titled?.[2] ?? feature.name;
      const group = groups.get(id) ?? { id, name, scenarios: [], passed: 0, judged: 0 };
      const outcome = reported.find(
        (r) => r.feature === feature.name && r.rule === rule.text && r.scenario === scenario.name,
      );
      const result = resultOf(scenario.name, story, outcome);
      group.scenarios.push(result);
      if (result.outcome !== "pending") group.judged += 1;
      if (result.outcome === "passed") group.passed += 1;
      groups.set(id, group);
    }
  }
  return [...groups.values()];
}

/** A version's validation at a glance: how many passed, of how many, and which failed. */
export interface ValidationOutcome {
  passed: number;
  total: number;
  failing: { featureId: string; featureName: string; story: string | null; name: string }[];
}

export function validationOutcome(groups: FeatureResults[]): ValidationOutcome {
  return {
    passed: groups.reduce((n, g) => n + g.passed, 0),
    total: groups.reduce((n, g) => n + g.scenarios.length, 0),
    failing: groups.flatMap((g) =>
      g.scenarios
        .filter((s) => s.outcome !== "passed" && s.outcome !== "pending")
        .map((s) => ({ featureId: g.id, featureName: g.name, story: s.story, name: s.name })),
    ),
  };
}
