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

package organization

// UNIT tier: SreModelConnectionService.ApplySeed over the same in-memory
// fakes as sre_model_connection_service_test.go. ApplySeed is authoritative:
// a changed seed hash is probed and, on success, replaces whatever is
// stored; a refusal leaves the stored connection alone; a seen hash (applied
// or refused) is never retried, and a transient failure is not seen.

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
)

func seedMarkerOf(w *sreWorld, org string) string { return string(w.keys[org+"/"+seedAppliedStoreKey]) }

func TestApplySeed_AppliesWhenNothingStored(t *testing.T) {
	ctx := context.Background()
	w := newSreWorld()
	prober := &sreProber{}
	s := newSreService(w, prober, sreOrgConn{})
	seed := Seed{BaseURL: "https://a.example/v1", Model: "gpt-4o-mini", APIKey: sreKey}

	outcome, err := s.ApplySeed(ctx, sreOrg, seed)
	if err != nil {
		t.Fatalf("ApplySeed: %v", err)
	}
	if outcome != SeedApplied {
		t.Fatalf("outcome = %q, want %q", outcome, SeedApplied)
	}
	if len(prober.targets) != 1 {
		t.Fatalf("probe calls = %d, want 1", len(prober.targets))
	}
	if w.row == nil || w.row.Host != "a.example" || w.key(sreOrg) != sreKey {
		t.Fatalf("row/key not stored: row=%+v key=%q", w.row, w.key(sreOrg))
	}
	if got, want := seedMarkerOf(w, sreOrg), seedHash(seed)+":applied"; got != want {
		t.Errorf("marker = %q, want %q", got, want)
	}
}

// TestApplySeed_ChangedSeedReplacesStored is the core authoritative-seed
// behavior: a seed whose hash differs from the last one tried is probed even
// though the org already has a stored connection, and on success REPLACES it
// — a console save is no longer the only thing that can win here; the seed
// always can.
func TestApplySeed_ChangedSeedReplacesStored(t *testing.T) {
	ctx := context.Background()
	w := newSreWorld()
	seedSre(w, "a.example", sreKey) // a connection stored by an earlier seed
	prober := &sreProber{}
	s := newSreService(w, prober, sreOrgConn{})
	seed := Seed{BaseURL: "https://b.example/v1", Model: "gpt-4o", APIKey: sreOtherKey}

	outcome, err := s.ApplySeed(ctx, sreOrg, seed)
	if err != nil {
		t.Fatalf("ApplySeed: %v", err)
	}
	if outcome != SeedApplied {
		t.Fatalf("outcome = %q, want %q", outcome, SeedApplied)
	}
	if len(prober.targets) != 1 {
		t.Errorf("probe calls = %d, want 1 (a changed seed is probed even with a connection already stored)", len(prober.targets))
	}
	if w.row == nil || w.row.Host != "b.example" || w.key(sreOrg) != sreOtherKey {
		t.Errorf("row=%+v key=%q, want the stored connection replaced by the new seed", w.row, w.key(sreOrg))
	}
}

func TestApplySeed_SkipsSameHashAfterApplied(t *testing.T) {
	ctx := context.Background()
	w := newSreWorld()
	prober := &sreProber{}
	s := newSreService(w, prober, sreOrgConn{})
	seed := Seed{BaseURL: "https://a.example/v1", Model: "gpt-4o-mini", APIKey: sreKey}

	if _, err := s.ApplySeed(ctx, sreOrg, seed); err != nil {
		t.Fatalf("first ApplySeed: %v", err)
	}
	prober.targets = nil

	outcome, err := s.ApplySeed(ctx, sreOrg, seed)
	if err != nil {
		t.Fatalf("second ApplySeed: %v", err)
	}
	if outcome != SeedSkippedSeen {
		t.Fatalf("outcome = %q, want %q", outcome, SeedSkippedSeen)
	}
	if len(prober.targets) != 0 {
		t.Errorf("probe called %d times on a seen hash, want 0", len(prober.targets))
	}
	if w.row == nil || w.row.Host != "a.example" {
		t.Errorf("row = %+v, want the already-applied connection left as it was", w.row)
	}
}

// TestApplySeed_RefusedChangedSeedKeepsStored: a changed seed that fails
// validation/probe leaves whatever connection was already stored exactly as
// it was, and is marked refused so it isn't retried on an unchanged seed.
func TestApplySeed_RefusedChangedSeedKeepsStored(t *testing.T) {
	ctx := context.Background()
	w := newSreWorld()
	seedSre(w, "a.example", sreKey)
	prober := &sreProber{err: &ValidationError{Code: "llm_key_rejected", Message: "b.example rejected the key (401)"}}
	s := newSreService(w, prober, sreOrgConn{})
	seed := Seed{BaseURL: "https://b.example/v1", Model: "gpt-4o", APIKey: sreOtherKey}

	outcome, err := s.ApplySeed(ctx, sreOrg, seed)
	if err != nil {
		t.Fatalf("ApplySeed: %v", err)
	}
	if outcome != SeedRefused {
		t.Fatalf("outcome = %q, want %q", outcome, SeedRefused)
	}
	if w.row == nil || w.row.Host != "a.example" || w.key(sreOrg) != sreKey {
		t.Errorf("row=%+v key=%q, want the stored connection left alone on a refusal", w.row, w.key(sreOrg))
	}
	if got, want := seedMarkerOf(w, sreOrg), seedHash(seed)+":refused"; got != want {
		t.Errorf("marker = %q, want %q", got, want)
	}

	prober.targets = nil
	outcome, err = s.ApplySeed(ctx, sreOrg, seed)
	if err != nil {
		t.Fatalf("second ApplySeed: %v", err)
	}
	if outcome != SeedSkippedSeen {
		t.Fatalf("outcome = %q, want %q", outcome, SeedSkippedSeen)
	}
	if len(prober.targets) != 0 {
		t.Errorf("probe called %d times on a seen refusal, want 0", len(prober.targets))
	}
	if w.row.Host != "a.example" {
		t.Errorf("row = %+v, want still the stored connection", w.row)
	}
}

// TestApplySeed_TransientFailureIsRetried: a probe that says nothing about
// the seed itself (the provider erroring, or no answer at all) is returned as
// an error and leaves no marker, so the next pass tries the same seed again
// and applies it once the provider answers.
func TestApplySeed_TransientFailureIsRetried(t *testing.T) {
	for name, probeErr := range map[string]error{
		"upstream 5xx": &UpstreamError{Code: "llm_upstream_error", Message: "b.example returned 502"},
		"unreachable":  &ValidationError{Code: "llm_unreachable", Message: "could not reach b.example: the request timed out"},
	} {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			w := newSreWorld()
			seedSre(w, "a.example", sreKey)
			prober := &sreProber{err: probeErr}
			s := newSreService(w, prober, sreOrgConn{})
			seed := Seed{BaseURL: "https://b.example/v1", Model: "gpt-4o", APIKey: sreOtherKey}

			if _, err := s.ApplySeed(ctx, sreOrg, seed); err == nil {
				t.Fatal("ApplySeed: want an error for a transient failure")
			}
			if got := seedMarkerOf(w, sreOrg); got != "" {
				t.Fatalf("marker = %q, want none so the seed is retried", got)
			}
			if w.row.Host != "a.example" {
				t.Fatalf("row = %+v, want the stored connection left alone", w.row)
			}

			prober.err = nil
			outcome, err := s.ApplySeed(ctx, sreOrg, seed)
			if err != nil || outcome != SeedApplied {
				t.Fatalf("retry: outcome=%q err=%v, want %q", outcome, err, SeedApplied)
			}
			if w.row.Host != "b.example" {
				t.Errorf("row = %+v, want the seed applied on retry", w.row)
			}
		})
	}
}

func TestApplySeed_NeverLogsTheKey(t *testing.T) {
	ctx := context.Background()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
	defer slog.SetDefault(prev)

	s := newSreService(newSreWorld(), &sreProber{}, sreOrgConn{})
	seed := Seed{BaseURL: "https://a.example/v1", Model: "gpt-4o-mini", APIKey: sreKey}
	if _, err := s.ApplySeed(ctx, sreOrg, seed); err != nil {
		t.Fatalf("ApplySeed: %v", err)
	}

	s2 := newSreService(newSreWorld(),
		&sreProber{err: &ValidationError{Code: "llm_key_rejected", Message: "rejected"}}, sreOrgConn{})
	refused := Seed{BaseURL: "https://b.example/v1", Model: "gpt-4o", APIKey: sreOtherKey}
	if _, err := s2.ApplySeed(ctx, "globex", refused); err != nil {
		t.Fatalf("ApplySeed (refused): %v", err)
	}

	logged := buf.String()
	if strings.Contains(logged, sreKey) || strings.Contains(logged, sreOtherKey) {
		t.Errorf("the log carries a seed key: %q", logged)
	}
}
