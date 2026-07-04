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

// Unit-level retry mechanics: retryOnCASConflict / retryOnTagCollision / the
// leaky bucket / isCASConflict, driven directly. The full-flow proofs (a real
// 422 through the github client, base_tree refresh on retry) live with the save
// and discard tests, which drive these policies over the Git Data API fake.

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
)

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
