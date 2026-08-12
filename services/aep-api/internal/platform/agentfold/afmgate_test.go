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
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// validAfm is byte-identical to VALID in
// packages/agent-stream/test/agent-afm-gate.test.ts.
const validAfm = `---
spec_version: "0.4.0"
name: "lunch-agent"
description: "Helps a teammate order lunch."
max_iterations: 12
model:
  provider: "anthropic"
  name: "${env:MODEL_NAME}"
  url: "${env:MODEL_ENDPOINT}"
  authentication:
    type: "api-key"
    api_key: "${env:MODEL_API_KEY}"
interfaces:
  - type: webchat
x-aep:
  tools:
    openapi:
      - component: "lunch-api"
        baseUrl: "${env:LUNCH_API_URL}"
        allow: [addItem]
---

# Role

You help teammates order lunch.

# Instructions

- Confirm before adding anything.
`

// liveAfmFixture locates a real agent.afm.md the platform's own design flow
// produced. Reading the live file (instead of a copy pasted into this test)
// means a future edit to that document exercises this gate automatically —
// the whole point being that this gate must never reject the platform's own
// output.
func liveAfmFixture(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	// thisFile: services/aep-api/internal/platform/agentfold/afmgate_test.go
	repoRoot := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "..", "..")
	path := filepath.Join(repoRoot, "playground", ".projects", "lunch-design", "specs", "design",
		"components", "lunch-chat-agent", "agent.afm.md")
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading live fixture %s: %v", path, err)
	}
	return string(content)
}

// TestValidateAgentAfm_LiveFixture guards the class of bug a struct-plus-
// KnownFields decode produced: it hard-rejected x-aep.memory, x-aep.identity
// and interfaces[].exposure, which the platform's own AFM generator emits
// (see the file this reads). The fixture is read from disk at test time
// (os.ReadFile), not embedded, so the file's content is invisible to the Go
// build cache's input hash — a fixture edit does NOT invalidate a cached
// PASS. Always run this test (and this package) with `go test -count=1` to
// force re-execution; see afmgate_test.go's TestValidateAgentAfm_LiveFixture
// for why a plain `go test` can report a stale result.
func TestValidateAgentAfm_LiveFixture(t *testing.T) {
	live := liveAfmFixture(t)

	if problem := validateAgentAfm(live, "lunch-chat-agent"); problem != nil {
		t.Fatalf("want the live fixture accepted — it exercises x-aep.memory, x-aep.identity "+
			"and interfaces[].exposure, all real optional zod fields — got %q", problem.message)
	}
}

func TestValidateAgentAfm(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(string) string
		dirName string
		wantErr string // substring; "" means valid
	}{
		{"valid", func(s string) string { return s }, "lunch-agent", ""},
		{"missing provider", func(s string) string {
			return strings.Replace(s, "  provider: \"anthropic\"\n", "", 1)
		}, "lunch-agent", "provider"},
		{"literal credential", func(s string) string {
			return strings.Replace(s, "\"${env:MODEL_API_KEY}\"", "\"sk-ant-real\"", 1)
		}, "lunch-agent", "${env:...}"},
		{"unsupported interface", func(s string) string {
			return strings.Replace(s, "type: webchat", "type: webhook", 1)
		}, "lunch-agent", "webchat"},
		{"name mismatch", func(s string) string { return s }, "other-agent", "directory name"},
		{"no role section", func(s string) string {
			return strings.Replace(s, "# Role", "# Purpose", 1)
		}, "lunch-agent", "# Role"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			problem := validateAgentAfm(tc.mutate(validAfm), tc.dirName)
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
