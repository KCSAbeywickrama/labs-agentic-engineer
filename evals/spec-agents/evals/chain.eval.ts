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

/**
 * The chained run (#357): requirements → design in one conversation, tasks
 * detached — live handoff, halt on fail-band, and a per-section verdict
 * VECTOR (the `verdict` column), never one blended number.
 */

import { evalite } from "evalite";
import { loadScenarios } from "../src/scenario.js";
import { runChainScenario, verdictVector } from "../src/runner.js";
import { cases, chainSectionScorer } from "../src/eval-kit.js";

evalite("chain", {
  data: () => cases(loadScenarios("chains"), (sc) => `chain-${sc.brief.name}`),
  task: ({ sc, runName }) => runChainScenario(sc, runName),
  scorers: [chainSectionScorer("requirements", 0), chainSectionScorer("design", 1), chainSectionScorer("tasks", 2)],
  columns: ({ output }) => [
    { label: "verdict", value: verdictVector(output) },
    { label: "tokens", value: `${output.usage.inputTokens}in/${output.usage.outputTokens}out` },
    { label: "review", value: output.reviewSheetPath ?? "—" },
  ],
});
