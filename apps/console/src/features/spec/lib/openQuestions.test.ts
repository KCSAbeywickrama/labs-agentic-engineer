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

import { describe, expect, it } from "vitest";
import { countBlockingOpenQuestions } from "./openQuestions";

describe("countBlockingOpenQuestions", () => {
  it("counts undeferred numbered entries, multi-line deferrals included", () => {
    const prd = [
      "# PRD",
      "## Open Questions",
      "1. Which Slack workspace? Deferred — does not block design.",
      "2. Personal or team budget?",
      "3. How are teams mapped —",
      "   deferred until phase 2.",
      "## Further Notes",
      "4. not a question — different section",
    ].join("\n");
    expect(countBlockingOpenQuestions(prd)).toBe(1);
  });

  it("is 0 without the section", () => {
    expect(countBlockingOpenQuestions("# PRD\n\n## Phasing\n- Phase 1. Stories: 1.")).toBe(0);
  });
});
