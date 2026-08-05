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

package codingagent

import (
	"testing"

	"github.com/wso2/aep/aep-api/internal/contracts"
)

func TestUsageFromLogReadsTheResultLine(t *testing.T) {
	log := `2026-07-21T10:00:00.000000000Z {"schemaVersion":1,"ts":"t","seq":1,"kind":"phase","phase":"agent"}
2026-07-21T10:00:01.000000000Z [oneshot] plain bootstrap line
2026-07-21T10:00:02.000000000Z {"schemaVersion":1,"ts":"t","seq":9,"kind":"result","status":"success","usage":{"inputTokens":100,"outputTokens":20,"cacheReadTokens":3000,"cacheCreationTokens":40,"model":"claude-fable-5"}}
`
	u := usageFromLog(log)
	if u == nil {
		t.Fatal("expected usage, got nil")
	}
	if u.InputTokens != 100 || u.OutputTokens != 20 || u.CacheReadTokens != 3000 ||
		u.CacheCreationTokens != 40 || u.Model != "claude-fable-5" {
		t.Fatalf("unexpected usage: %+v", u)
	}
}

func TestUsageFromLogLastResultWins(t *testing.T) {
	log := `{"schemaVersion":1,"ts":"t","seq":1,"kind":"result","status":"failure","usage":{"inputTokens":1,"outputTokens":1,"cacheReadTokens":0,"cacheCreationTokens":0,"model":"claude-fable-5"}}
{"schemaVersion":1,"ts":"t","seq":2,"kind":"result","status":"success","usage":{"inputTokens":7,"outputTokens":3,"cacheReadTokens":0,"cacheCreationTokens":0,"model":"claude-fable-5"}}
`
	u := usageFromLog(log)
	if u == nil || u.InputTokens != 7 {
		t.Fatalf("expected the last result's usage, got %+v", u)
	}
}

func TestUsageFromLogKeepsThePerModelSplit(t *testing.T) {
	log := `{"schemaVersion":1,"ts":"t","seq":1,"kind":"result","status":"success","usage":{"inputTokens":110,"outputTokens":55,"cacheReadTokens":1000,"cacheCreationTokens":200,"model":"","models":[{"inputTokens":100,"outputTokens":50,"cacheReadTokens":1000,"cacheCreationTokens":200,"model":"claude-sonnet-5"},{"inputTokens":10,"outputTokens":5,"cacheReadTokens":0,"cacheCreationTokens":0,"model":"claude-haiku-4-5"}]}}
`
	u := usageFromLog(log)
	if u == nil {
		t.Fatal("expected usage, got nil")
	}
	if u.Model != "" || u.InputTokens != 110 {
		t.Fatalf("unexpected aggregate: %+v", u.TokenUsage)
	}
	want := []contracts.TokenUsage{
		{InputTokens: 100, OutputTokens: 50, CacheReadTokens: 1000, CacheCreationTokens: 200, Model: "claude-sonnet-5"},
		{InputTokens: 10, OutputTokens: 5, Model: "claude-haiku-4-5"},
	}
	if len(u.Models) != len(want) || u.Models[0] != want[0] || u.Models[1] != want[1] {
		t.Fatalf("models = %+v, want %+v", u.Models, want)
	}
	// PricingSlices prefers the split…
	if got := u.PricingSlices(); len(got) != 2 || got[0].Model != "claude-sonnet-5" {
		t.Fatalf("PricingSlices = %+v, want the per-model split", got)
	}
	// …and falls back to the aggregate for pre-split runners.
	legacy := contracts.CapturedUsage{TokenUsage: contracts.TokenUsage{InputTokens: 7, Model: "claude-sonnet-5"}}
	if got := legacy.PricingSlices(); len(got) != 1 || got[0].Model != "claude-sonnet-5" {
		t.Fatalf("PricingSlices(legacy) = %+v, want the aggregate as one slice", got)
	}
}

func TestUsageFromLogAbsentForPreCaptureRunners(t *testing.T) {
	log := `{"schemaVersion":1,"ts":"t","seq":1,"kind":"result","status":"success"}
some stray text mentioning "result" and "usage" but not JSON
`
	if u := usageFromLog(log); u != nil {
		t.Fatalf("expected nil for a usage-less log, got %+v", u)
	}
}
