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

package requirements

// DBTEST tier (skips under -short; `make test-db` / the DB lane runs it): the
// REAL RequirementsDirLocker over a pristine per-test Postgres (dbtest.New).
// Postgres advisory locks are exactly what this tier exists for — they cannot be
// faked. Each dbtest.New hands back its OWN database, and advisory locks are
// scoped per-database (keyed by (database, key)), so cross-test contention is
// impossible; the mutual-exclusion tests deliberately share ONE db handle so the
// two contending sessions land in the SAME database.
//
// Semantics under test (requirements_lock.go):
//   - WithTxLock uses pg_try_advisory_xact_lock → NON-blocking: a second writer
//     on the same key gets RequirementsDirLockBusy immediately (not a block).
//   - AcquireSession uses pg_try_advisory_lock on a pinned conn; Release unlocks.
//   - Both flavours share lockKey(org, project), so a session lock and a tx lock
//     contend across the two paths; distinct (org, project) pairs do not.

import (
	"context"
	"errors"
	"testing"

	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
)

func TestLocker_WithTxLock_IsMutuallyExclusiveAndReleases(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t) // one database; both goroutines share it → they contend
	ctx := context.Background()
	locker := NewRequirementsDirLocker(db)

	inside := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)

	// Goroutine A holds the xact lock (inside its transaction) until released.
	go func() {
		done <- locker.WithTxLock(ctx, "acme", "web", func(context.Context) error {
			close(inside)
			<-release
			return nil
		})
	}()

	<-inside // A now holds the lock.

	// B tries the SAME key while A holds it → non-blocking busy; fn must not run.
	errB := locker.WithTxLock(ctx, "acme", "web", func(context.Context) error {
		t.Error("second writer's fn ran while the lock was held")
		return nil
	})
	if !errors.Is(errB, RequirementsDirLockBusy) {
		t.Fatalf("contended WithTxLock: want RequirementsDirLockBusy, got %v", errB)
	}

	close(release) // let A commit → releases the xact lock.
	if err := <-done; err != nil {
		t.Fatalf("holder WithTxLock: %v", err)
	}

	// Lock is free again: a fresh acquire runs its fn.
	ran := false
	if err := locker.WithTxLock(ctx, "acme", "web", func(context.Context) error {
		ran = true
		return nil
	}); err != nil || !ran {
		t.Fatalf("post-release WithTxLock: ran=%v err=%v", ran, err)
	}
}

func TestLocker_AcquireSession_ContentionAndRelease(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	locker := NewRequirementsDirLocker(db)

	// First session lock succeeds.
	lock1, err := locker.AcquireSession(ctx, "acme", "web")
	if err != nil {
		t.Fatalf("first AcquireSession: %v", err)
	}

	// A second acquire on the same key from another session → busy.
	if _, err := locker.AcquireSession(ctx, "acme", "web"); !errors.Is(err, RequirementsDirLockBusy) {
		t.Fatalf("contended AcquireSession: want RequirementsDirLockBusy, got %v", err)
	}

	// Release actually frees it: a subsequent acquire on the same key succeeds.
	lock1.Release(ctx)
	lock2, err := locker.AcquireSession(ctx, "acme", "web")
	if err != nil {
		t.Fatalf("post-release AcquireSession: %v", err)
	}
	lock2.Release(ctx)
}

func TestLocker_DistinctKeysDoNotContend(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	locker := NewRequirementsDirLocker(db)

	// A held lock on (acme, web) must not block a different project or a
	// different org — lockKey isolates each (org, project) pair.
	lockA, err := locker.AcquireSession(ctx, "acme", "web")
	if err != nil {
		t.Fatalf("acquire (acme,web): %v", err)
	}
	defer lockA.Release(ctx)

	lockB, err := locker.AcquireSession(ctx, "acme", "other")
	if err != nil {
		t.Fatalf("different project must not contend, got %v", err)
	}
	lockB.Release(ctx)

	lockC, err := locker.AcquireSession(ctx, "intruder", "web")
	if err != nil {
		t.Fatalf("different org must not contend, got %v", err)
	}
	lockC.Release(ctx)
}

func TestLocker_SessionAndTxLocksContendOnSharedKey(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	locker := NewRequirementsDirLocker(db)

	// A long-lived session lock (chat SSE flavour) must make the short-writer
	// WithTxLock path see the directory as busy — both use the same lockKey, so
	// the two flavours serialise across paths.
	held, err := locker.AcquireSession(ctx, "acme", "web")
	if err != nil {
		t.Fatalf("acquire session lock: %v", err)
	}

	errTx := locker.WithTxLock(ctx, "acme", "web", func(context.Context) error {
		t.Error("tx writer ran while a session lock was held")
		return nil
	})
	if !errors.Is(errTx, RequirementsDirLockBusy) {
		t.Fatalf("tx-vs-session contention: want RequirementsDirLockBusy, got %v", errTx)
	}

	// After releasing the session lock, the tx path acquires cleanly.
	held.Release(ctx)
	ran := false
	if err := locker.WithTxLock(ctx, "acme", "web", func(context.Context) error {
		ran = true
		return nil
	}); err != nil || !ran {
		t.Fatalf("post-release WithTxLock: ran=%v err=%v", ran, err)
	}
}
