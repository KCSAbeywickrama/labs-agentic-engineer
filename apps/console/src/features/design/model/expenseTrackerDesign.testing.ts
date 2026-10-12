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

// Test data only: the design tests read a real design through this module.
//
// The design is the expense-tracker design the design eval wrote
// (evals/spec-agents/scenarios/fixtures/expense-tracker-design), read as the
// room holds it. That fixture follows what Design writes, and Design writes a
// flow only when one is worth writing, so the fixture may hold none. The tests
// draw a flow all the same, so this module adds one of its own: the console's
// rules for a flow hold whatever the eval's fixture carries.

const ROOT = "../../../../../../evals/spec-agents/scenarios/fixtures/expense-tracker-design/";
const raw = import.meta.glob<string>(
  "../../../../../../evals/spec-agents/scenarios/fixtures/expense-tracker-design/specs/**/*.{md,json,yaml,cell,dsl,feature}",
  { query: "?raw", import: "default", eager: true },
);

const CLAIM_DECISION_FLOW = `# Claim decision

An Employee files a claim, and an Approver decides it from the shared queue.

\`\`\`mermaid
sequenceDiagram
    actor Employee
    actor Approver
    participant expense-webapp
    participant expense-api

    Employee->>expense-webapp: submit claim
    expense-webapp->>expense-api: create claim
    Approver->>expense-webapp: approve claim
    expense-webapp->>expense-api: approve claim
\`\`\`
`;

/** The expense-tracker design's files by repo path, with the flow `flows/claim-decision.md`. */
export const expenseTrackerDesign: Record<string, string> = {
  ...Object.fromEntries(Object.entries(raw).map(([path, content]) => [path.slice(ROOT.length), content])),
  "specs/design/flows/claim-decision.md": CLAIM_DECISION_FLOW,
};
