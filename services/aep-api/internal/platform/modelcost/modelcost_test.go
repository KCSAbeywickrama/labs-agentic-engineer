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

package modelcost

import "testing"

func sonnetStamper() *Stamper {
	return NewStamper([]ModelRate{{
		ModelID:           "claude-sonnet-5",
		InputPerMTok:      2.00,
		OutputPerMTok:     10.00,
		CacheReadPerMTok:  0.20,
		CacheWritePerMTok: 2.50,
	}})
}

func TestCostStampsAtSeededRates(t *testing.T) {
	s := sonnetStamper()
	// 1M input @ $2 + 1M output @ $10 + 1M cache-read @ $0.20 + 1M cache-write
	// @ $2.50 = $14.70, rounded to cents.
	got := s.Cost(Tokens{
		ModelID:             "claude-sonnet-5",
		InputTokens:         1_000_000,
		OutputTokens:        1_000_000,
		CacheReadTokens:     1_000_000,
		CacheCreationTokens: 1_000_000,
	})
	if got == nil {
		t.Fatal("expected a stamped cost, got nil")
	}
	if *got != 14.70 {
		t.Fatalf("cost = %v, want 14.70", *got)
	}
}

func TestCostRoundsToCents(t *testing.T) {
	s := sonnetStamper()
	// 12,345 input @ $2/MTok = $0.02469 → rounds to $0.02.
	got := s.Cost(Tokens{ModelID: "claude-sonnet-5", InputTokens: 12_345})
	if got == nil || *got != 0.02 {
		t.Fatalf("cost = %v, want 0.02", got)
	}
}

func TestCostNilWhenNoRateForModel(t *testing.T) {
	s := sonnetStamper()
	// A model with no rate row cannot be priced honestly — null, not zero.
	if got := s.Cost(Tokens{ModelID: "claude-opus-4-8", InputTokens: 1_000}); got != nil {
		t.Fatalf("cost = %v, want nil for an unpriced model", *got)
	}
}

func TestCostNilWhenNoModel(t *testing.T) {
	s := sonnetStamper()
	// A mixed-model aggregate (model "") is unpriceable at the row level.
	if got := s.Cost(Tokens{ModelID: "", InputTokens: 1_000}); got != nil {
		t.Fatalf("cost = %v, want nil for an empty model id", *got)
	}
}

func TestCostZeroTokensStampsZero(t *testing.T) {
	s := sonnetStamper()
	// A priced model with no traffic stamps $0 (distinct from an unpriceable
	// null): the model was known, the spend was genuinely nothing.
	got := s.Cost(Tokens{ModelID: "claude-sonnet-5"})
	if got == nil || *got != 0 {
		t.Fatalf("cost = %v, want 0", got)
	}
}

func multiModelStamper() *Stamper {
	return NewStamper([]ModelRate{
		{ModelID: "claude-sonnet-5", InputPerMTok: 2.00, OutputPerMTok: 10.00, CacheReadPerMTok: 0.20, CacheWritePerMTok: 2.50},
		{ModelID: "claude-haiku-4-5", InputPerMTok: 1.00, OutputPerMTok: 5.00, CacheReadPerMTok: 0.10, CacheWritePerMTok: 1.25},
	})
}

func TestSumCostPricesEachSliceAtItsOwnRate(t *testing.T) {
	s := multiModelStamper()
	// sonnet: 1M in + 100k out = $2 + $1 = $3.00; haiku: 1M in = $1.00.
	got := s.SumCost([]Tokens{
		{ModelID: "claude-sonnet-5", InputTokens: 1_000_000, OutputTokens: 100_000},
		{ModelID: "claude-haiku-4-5", InputTokens: 1_000_000},
	})
	if got == nil || *got != 4.00 {
		t.Fatalf("cost = %v, want 4.00", got)
	}
}

func TestSumCostRoundsOnceOverTheSum(t *testing.T) {
	s := multiModelStamper()
	// Each slice alone is $0.004 (rounds to $0.00); the sum is $0.008, which
	// must round to $0.01 — per-slice rounding would report a false zero.
	got := s.SumCost([]Tokens{
		{ModelID: "claude-sonnet-5", InputTokens: 2_000},
		{ModelID: "claude-haiku-4-5", InputTokens: 4_000},
	})
	if got == nil || *got != 0.01 {
		t.Fatalf("cost = %v, want 0.01", got)
	}
}

func TestSumCostNilWhenAnyTokenBearingSliceUnpriceable(t *testing.T) {
	s := multiModelStamper()
	// One slice with no rate row poisons the whole stamp: a partial dollar
	// figure would silently under-report the run's spend.
	got := s.SumCost([]Tokens{
		{ModelID: "claude-sonnet-5", InputTokens: 1_000_000},
		{ModelID: "some-unknown-model", InputTokens: 10},
	})
	if got != nil {
		t.Fatalf("cost = %v, want nil when a contributing slice has no rate", *got)
	}
}

func TestSumCostIgnoresZeroTokenSlices(t *testing.T) {
	s := multiModelStamper()
	// A zero-token slice — even for an unknown model — contributed nothing and
	// must not block pricing the real spend.
	got := s.SumCost([]Tokens{
		{ModelID: "claude-sonnet-5", InputTokens: 1_000_000},
		{ModelID: "some-unknown-model"},
	})
	if got == nil || *got != 2.00 {
		t.Fatalf("cost = %v, want 2.00", got)
	}
}

func TestSumCostNilOnEmptyOrAllZero(t *testing.T) {
	s := multiModelStamper()
	if got := s.SumCost(nil); got != nil {
		t.Fatalf("cost = %v, want nil for no slices", *got)
	}
	if got := s.SumCost([]Tokens{{ModelID: "claude-sonnet-5"}}); got != nil {
		t.Fatalf("cost = %v, want nil for all-zero slices", *got)
	}
}
