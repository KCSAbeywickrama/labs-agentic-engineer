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

/** Design section, standalone from a captured requirements fixture (#356). */

import { evalite } from "evalite";
import { loadScenarios } from "../src/scenario.js";
import { runDesignScenario } from "../src/runner.js";
import { cases, rubricScorer, sectionColumns, structuralScorer } from "../src/eval-kit.js";

evalite("design-section", {
  data: () => cases(loadScenarios("design"), (sc) => `design-${sc.brief.name}`),
  task: ({ sc, runName }) => runDesignScenario(sc, runName),
  scorers: [structuralScorer, rubricScorer],
  columns: sectionColumns,
});
