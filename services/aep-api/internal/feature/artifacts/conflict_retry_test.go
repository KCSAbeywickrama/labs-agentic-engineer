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

package artifacts

// The CAS + tag-collision retry policies, at two levels:
//   - full-flow: real save over the Git Data API fake, using BeforeUpdateRef to
//     inject a deterministic external branch advance mid-save;
//   - unit: retryOnCASConflict / retryOnTagCollision / the leaky bucket /
//     isCASConflict driven directly, for the branches the full flow can't reach.

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
)

func TestSaveRequirements_CASConflict_RetriesAndSucceeds(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "v0\n"})
	ctx := context.Background()

	var updateRefCalls int32
	var once sync.Once
	r.gd.BeforeUpdateRef = func() {
		atomic.AddInt32(&updateRefCalls, 1)
		// Exactly once, right before the ref moves, an external writer advances
		// main to a divergent commit — so the client's first UpdateRef is a real
		// non-fast-forward (422 → ErrRefNotFastForward) and the CAS loop retries.
		once.Do(func() {
			r.remote.Seed(t, map[string]string{"external.md": "external edit\n"}, "external push")
		})
	}

	r.writeWT("specs/requirements/requirements.md", "my edit\n")
	res, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{})
	if err != nil {
		t.Fatalf("SaveRequirements: %v", err)
	}
	if res.Status != "approved" || res.Tag != "v1" {
		t.Fatalf("result = %+v, want approved/v1", res)
	}
	if n := atomic.LoadInt32(&updateRefCalls); n != 2 {
		t.Errorf("UpdateRef attempts = %d, want 2 (first non-FF, retry succeeds)", n)
	}
	// Our edit landed AND the external change survives: the retry re-fetched a
	// fresh base_tree over the advanced main rather than clobbering it.
	if got := r.remote.FileAt(t, "main", "specs/requirements/requirements.md"); got != "my edit\n" {
		t.Errorf("requirements.md = %q, want my edit", got)
	}
	if got := r.remote.FileAt(t, "main", "external.md"); got != "external edit\n" {
		t.Errorf("external.md = %q, want external edit (base_tree refresh must preserve it)", got)
	}
}

func TestSaveRequirements_CASBudgetExhausted(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "v0\n"})
	ctx := context.Background()

	// Drain this project's leaky bucket so the first retry can't claim a token.
	// The bucket key is unique per test (derived from t.Name), so draining it
	// pollutes no other test.
	key := r.org + ":" + r.proj
	for i := 0; i < bucketCapacity; i++ {
		globalRetrier.claim(key)
	}

	// Advance main on every UpdateRef so the client can never fast-forward.
	r.gd.BeforeUpdateRef = func() {
		r.remote.Seed(t, map[string]string{"ext.md": "push\n"}, "external push")
	}

	r.writeWT("specs/requirements/requirements.md", "my edit\n")
	_, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{})
	if !errors.Is(err, ErrConflictBudgetExhausted) {
		t.Fatalf("err = %v, want wrapped ErrConflictBudgetExhausted", err)
	}
}

func TestSaveRequirements_TagCollision_RecomputesToNextName(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "v0\n"})
	ctx := context.Background()

	// v1 is already claimed on the remote. The tag step recomputes the next name
	// from a fresh tag list on each attempt, so it skips the taken v1 and lands
	// v2 without clobbering v1.
	r.remote.Tag(t, "v1", "external v1")

	r.writeWT("specs/requirements/requirements.md", "my edit\n")
	res, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{})
	if err != nil {
		t.Fatalf("SaveRequirements: %v", err)
	}
	if res.Tag != "v2" || res.Version != 2 {
		t.Fatalf("result tag = %+v, want v2/2 (skip the taken v1)", res)
	}
	tags := r.remote.Tags(t)
	if len(tags) != 2 || tags[0] != "v1" || tags[1] != "v2" {
		t.Errorf("remote tags = %v, want [v1 v2] (v1 preserved)", tags)
	}
}

// TestSaveRequirements_TagCollision_Real422ThroughRealClient forces a true
// external-pusher collision in the microsecond window between the save's
// fresh tag-list fetch and its CreateTagRef, via the harness's
// BeforeCreateTagRef hook. The REAL clients/github CreateTagRef receives a
// genuine 422 and must translate it to ErrTagAlreadyExists for
// retryOnTagCollision to recompute (v2) instead of failing the save — the
// ONLY test proving that 422→sentinel mapping (review finding: a mutation
// swallowing the 422 survived every other test).
func TestSaveRequirements_TagCollision_Real422ThroughRealClient(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "v0\n"})
	ctx := context.Background()

	fired := false
	r.gd.BeforeCreateTagRef = func() {
		if fired {
			return // only sabotage the first attempt
		}
		fired = true
		r.remote.Tag(t, "v1", "external claim in the race window")
	}

	r.writeWT("specs/requirements/requirements.md", "my edit\n")
	res, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{})
	if err != nil {
		t.Fatalf("SaveRequirements: %v", err)
	}
	if !fired {
		t.Fatal("BeforeCreateTagRef hook never fired — collision was not injected")
	}
	if res.Tag != "v2" || res.Version != 2 {
		t.Fatalf("result = %+v, want v2/2 (retry after the real 422 recomputes past the claimed v1)", res)
	}
	if tags := r.remote.Tags(t); len(tags) != 2 || tags[0] != "v1" || tags[1] != "v2" {
		t.Errorf("remote tags = %v, want [v1 v2] (external v1 preserved)", tags)
	}
}

// ----- unit-level retry mechanics -----

// NOTE: within one save flow the retryOnTagCollision LOOP normally never
// re-attempts a taken name — createAnnotatedTagViaAPI recomputes the tag from
// a fresh fetch immediately before CreateTagRef. The real-client collision
// path is proven by TestSaveRequirements_TagCollision_Real422ThroughRealClient
// above (BeforeCreateTagRef hook); these unit tests pin the loop policy
// (backoff schedule, give-up) directly.

func TestRetryOnTagCollision_RetriesThenSucceeds(t *testing.T) {
	t.Parallel()
	calls := 0
	err := retryOnTagCollision(context.Background(), func() error {
		calls++
		if calls == 1 {
			return fmt.Errorf("create tag ref: %w", gitrepo.ErrTagAlreadyExists)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("err = %v, want nil after retry", err)
	}
	if calls != 2 {
		t.Errorf("fn calls = %d, want 2", calls)
	}
}

func TestRetryOnTagCollision_GivesUpAfterSchedule(t *testing.T) {
	t.Parallel()
	calls := 0
	err := retryOnTagCollision(context.Background(), func() error {
		calls++
		return gitrepo.ErrTagAlreadyExists
	})
	if !errors.Is(err, gitrepo.ErrTagAlreadyExists) {
		t.Fatalf("err = %v, want ErrTagAlreadyExists", err)
	}
	if want := len(tagRetryAttempts) + 1; calls != want {
		t.Errorf("fn calls = %d, want %d (initial + schedule)", calls, want)
	}
}

func TestRetryOnCASConflict_RetriesThenSucceeds(t *testing.T) {
	t.Parallel()
	key := "unit-cas-ok:" + t.Name()
	calls := 0
	err := retryOnCASConflict(context.Background(), key, func() error {
		calls++
		if calls == 1 {
			return fmt.Errorf("update ref: %w", gitrepo.ErrRefNotFastForward)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("err = %v, want nil after retry", err)
	}
	if calls != 2 {
		t.Errorf("fn calls = %d, want 2", calls)
	}
}

func TestRetryOnCASConflict_NonConflictReturnsImmediately(t *testing.T) {
	t.Parallel()
	key := "unit-cas-nc:" + t.Name()
	boom := errors.New("some other failure")
	calls := 0
	err := retryOnCASConflict(context.Background(), key, func() error {
		calls++
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v, want boom", err)
	}
	if calls != 1 {
		t.Errorf("fn calls = %d, want 1 (a non-CAS error must not retry)", calls)
	}
}

func TestLeakyBucket_ClaimCapacityThenEmpty(t *testing.T) {
	t.Parallel()
	// A fresh retrier (not the global) so the tight loop sees no time-based
	// refill (elapsed < bucketRefillEv) and no cross-test pollution.
	cr := &conflictRetrier{buckets: map[string]*bucketState{}}
	key := "k"
	for i := 0; i < bucketCapacity; i++ {
		if !cr.claim(key) {
			t.Fatalf("claim #%d should succeed within capacity", i+1)
		}
	}
	if cr.claim(key) {
		t.Error("claim past capacity should fail")
	}
}

func TestIsCASConflict(t *testing.T) {
	t.Parallel()
	if !isCASConflict(fmt.Errorf("wrap: %w", gitrepo.ErrRefNotFastForward)) {
		t.Error("wrapped ErrRefNotFastForward should be a CAS conflict")
	}
	if isCASConflict(ErrConflictBudgetExhausted) {
		t.Error("ErrConflictBudgetExhausted must NOT count as a CAS conflict (it terminates retry)")
	}
	if isCASConflict(gitrepo.ErrTagAlreadyExists) {
		t.Error("a tag collision is not a CAS conflict")
	}
	if isCASConflict(nil) {
		t.Error("nil is not a conflict")
	}
}
