// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

package agentfold

import (
	"fmt"
	"strings"
	"testing"
)

// guardrailPII is the one-entry block the cases below mutate. The zod gate's
// tests (packages/agent-stream/test/agent-afm-gate.test.ts) run the same cases
// and must reach the same verdicts.
const guardrailPII = "    - policy: pii-masking-regex\n      params: { email: true }\n      why: \"The model never needs contact details.\"\n"

func withGuardrails(entries string) string {
	return strings.Replace(validAfm, "x-aep:\n", "x-aep:\n  guardrails:\n"+entries, 1)
}

func TestValidateAgentAfm_Guardrails(t *testing.T) {
	eleven := ""
	for i := 0; i < 11; i++ {
		eleven += strings.Replace(guardrailPII, "pii-masking-regex", fmt.Sprintf("policy-%d", i), 1)
	}
	tests := []struct {
		name    string
		entries string
		wantErr string // substring; "" means valid
	}{
		{"a policy with use-case params and a reason is accepted", guardrailPII, ""},
		{"a guardrail without a reason is rejected",
			strings.Replace(guardrailPII, "      why: \"The model never needs contact details.\"\n", "", 1), "x-aep.guardrails[0].why"},
		{"an uppercase policy name is rejected",
			strings.Replace(guardrailPII, "pii-masking-regex", "PII", 1), "x-aep.guardrails[0].policy"},
		{"more than ten guardrails are rejected", eleven, "x-aep.guardrails"},
		{"the same policy twice is rejected", guardrailPII + guardrailPII, "must not repeat a policy"},
		{"a top-level jsonPath is rejected",
			strings.Replace(guardrailPII, "{ email: true }", `{ email: true, jsonPath: "$.x" }`, 1), "must not set jsonPath"},
		{"a request jsonPath is rejected",
			strings.Replace(guardrailPII, "{ email: true }", `{ request: { regex: "x", jsonPath: "$.x" } }`, 1), "must not set jsonPath"},
		{"a response streamingJsonPath is rejected",
			strings.Replace(guardrailPII, "{ email: true }", `{ response: { enabled: true, streamingJsonPath: "$.x" } }`, 1), "must not set streamingJsonPath"},
		{"a policy version is rejected",
			strings.Replace(guardrailPII, "{ email: true }", `{ version: "v1.0.4" }`, 1), "must not set version"},
		{"an unknown key on a guardrail is rejected",
			strings.Replace(guardrailPII, "      why:", "      enabled: true\n      why:", 1), "x-aep.guardrails[0]: unknown property enabled"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			problem := validateAgentAfm(withGuardrails(tc.entries), "lunch-agent")
			if tc.wantErr == "" {
				if problem != nil {
					t.Fatalf("want valid, got %q", problem.message)
				}
				return
			}
			if problem == nil {
				t.Fatalf("want error containing %q, got valid", tc.wantErr)
			}
			if !strings.Contains(problem.message, tc.wantErr) {
				t.Errorf("message %q does not contain %q", problem.message, tc.wantErr)
			}
		})
	}
}
