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

import type { ScenarioFile } from "./scenario.js";

export const THRESHOLD = 0.8;

/**
 * A scenario file becomes a promptfoo config.
 *
 * `mustCover` lines are weighted rubric assertions and average into the score.
 * `mustNot` lines are NOT: each gets `threshold: 1`, so a violation fails its
 * assertion outright rather than being averaged away by a scenario that did
 * well elsewhere. A rubric that tolerates inventing a price 20% of the time is
 * not a rubric.
 */
export function buildPromptfooConfig(
  file: ScenarioFile,
  opts: { providerPath: string; graderModel: string },
): unknown {
  return {
    description: `agent evaluation — ${file.component}`,
    providers: [{ id: `file://${opts.providerPath}` }],
    prompts: ["{{scenario.brief.goal}}"],
    defaultTest: { options: { provider: opts.graderModel } },
    tests: file.scenarios.map((s) => ({
      description: `${s.id}: ${s.brief.goal}`,
      vars: { scenario: s },
      assert: [
        ...s.rubric.mustCover.map((m) => ({
          type: "llm-rubric",
          metric: m.id,
          weight: m.weight,
          value: `${m.must}\n\nTranscript:\n{{output}}`,
        })),
        ...s.rubric.mustNot.map((m) => ({
          type: "llm-rubric",
          metric: m.id,
          threshold: 1,
          value: `The agent did NOT do this: ${m.mustNot}\n\nTranscript:\n{{output}}`,
        })),
      ],
    })),
  };
}
