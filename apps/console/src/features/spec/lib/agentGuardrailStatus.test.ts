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

import { agentGuardrailStatus } from "./agentGuardrailStatus";

describe("agentGuardrailStatus", () => {
  it("groups each environment's outcome under its policy", () => {
    expect(
      agentGuardrailStatus({
        isPending: false,
        deployments: [
          {
            environment: "development",
            guardrails: [
              { policy: "pii-masking-regex", status: "applied" },
              { policy: "regex-guardrail", status: "invalid", reason: "the regex does not compile" },
            ],
          },
          { environment: "staging", guardrails: [{ policy: "pii-masking-regex", status: "failed", reason: "AMP down" }] },
        ],
      }),
    ).toEqual({
      "pii-masking-regex": [
        { environment: "development", status: "applied" },
        { environment: "staging", status: "failed", reason: "AMP down" },
      ],
      "regex-guardrail": [{ environment: "development", status: "invalid", reason: "the regex does not compile" }],
    });
  });

  it("is empty — not unknown — once the deployments are read and none carries guardrails", () => {
    expect(agentGuardrailStatus({ isPending: false, deployments: [{ environment: "development" }] })).toEqual({});
  });

  // Unknown is not "not deployed yet": while the read is in flight the panel
  // must not claim no guardrail has landed.
  it("is unknown while the deployments are still loading", () => {
    expect(agentGuardrailStatus({ isPending: true, deployments: [] })).toBeUndefined();
  });
});
