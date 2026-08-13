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

package delivery

import (
	"context"
	"errors"
	"testing"

	"github.com/wso2/aep/aep-api/internal/contracts"
)

// fakeLedgerUsage answers the one read the rollup makes. It embeds the
// repository interface for the verbs the rollup never calls — nil, so calling
// one panics, which is the point.
type fakeLedgerUsage struct {
	AgentUsageLedgerRepository
	build      map[contracts.UsageScope]contracts.StampedUsage
	validation map[contracts.UsageScope]contracts.StampedUsage
	err        error
}

func (f fakeLedgerUsage) SumUsageByProjectPhase(context.Context, string) (map[contracts.UsageScope]contracts.StampedUsage, map[contracts.UsageScope]contracts.StampedUsage, error) {
	if f.err != nil {
		return nil, nil, f.err
	}
	return f.build, f.validation, nil
}

func usd(v float64) *float64 { return &v }

func stamped(in, out int64, model string, cost *float64) contracts.StampedUsage {
	return contracts.StampedUsage{
		Tokens:  contracts.TokenUsage{InputTokens: in, OutputTokens: out, Model: model},
		CostUsd: cost,
	}
}

// TestPhaseUsageRollup_ReadsTheLedgerAndKeepsLifetimesApart pins what the rollup
// is now: ONE source, handed through with its lifetimes intact.
//
// It used to sum two — the cycle rows and the execution rows — and that is
// exactly what it must not do any more. Both capture surfaces mirror into the
// ledger, so adding the dispatch rows back in would bill every token twice; and
// the dispatch rows are purged when a project is deleted, which is how the spend
// record used to vanish with it.
//
// The per-lifetime split is the ledger's, not this function's (it is a GROUP BY,
// proven against real SQL in the ledger dbtests). What is proven here is that the
// rollup carries it through instead of folding a slug's two lifetimes together.
func TestPhaseUsageRollup_ReadsTheLedgerAndKeepsLifetimesApart(t *testing.T) {
	live := contracts.UsageScope{ProjectID: "shop"}
	retired := contracts.UsageScope{ProjectID: "shop", Retired: true}
	ledger := fakeLedgerUsage{
		build: map[contracts.UsageScope]contracts.StampedUsage{
			live:    stamped(100, 20, "m1", usd(3)),
			retired: stamped(900, 90, "m1", usd(50)),
		},
		validation: map[contracts.UsageScope]contracts.StampedUsage{
			live: stamped(10, 2, "m1", usd(1)),
		},
	}

	build, validation, err := PhaseUsageRollup(ledger)(context.Background(), "org1")
	if err != nil {
		t.Fatalf("rollup: %v", err)
	}
	if got := build[live]; got.Tokens.InputTokens != 100 || got.CostUsd == nil || *got.CostUsd != 3 {
		t.Fatalf("live build = %+v, want the live lifetime's own figures", got)
	}
	if got := build[retired]; got.CostUsd == nil || *got.CostUsd != 50 {
		t.Fatalf("retired build = %+v, want the deleted lifetime's bill intact", got)
	}
	// The two must not have been folded into one entry for the slug.
	if len(build) != 2 {
		t.Fatalf("build scopes = %d, want 2 (one per lifetime): %+v", len(build), build)
	}
	// A phase the retired lifetime never spent in stays absent rather than
	// inheriting the live one's.
	if _, ok := validation[retired]; ok {
		t.Fatalf("validation must not invent a retired entry: %+v", validation)
	}
	if got := validation[live]; got.Tokens.InputTokens != 10 {
		t.Fatalf("live validation = %+v, want the ledger figures intact", got)
	}
}

// A read failure must surface, not silently under-report spend as a partial
// total the console would render as authoritative.
func TestPhaseUsageRollup_PropagatesTheLedgerError(t *testing.T) {
	boom := errors.New("boom")
	build, validation, err := PhaseUsageRollup(fakeLedgerUsage{err: boom})(context.Background(), "org1")
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v, want boom", err)
	}
	if build != nil || validation != nil {
		t.Fatalf("maps must be nil on error, got %v / %v", build, validation)
	}
}
