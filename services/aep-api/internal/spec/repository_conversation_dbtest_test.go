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

package spec_test

// DB tier for the project_conversations store (#430): the current-pointer
// partial unique (ux_project_conversations_current), race-safe lazy create,
// and rotation — against a real migrated Postgres (dbtest; skipped under
// -short).

import (
	"context"
	"sync"
	"testing"

	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
	"github.com/wso2/aep/aep-api/internal/spec"
)

func TestConversationRepo_ResolveCreatesOnceAndSticks(t *testing.T) {
	t.Parallel()
	repo := spec.NewConversationRepository(dbtest.New(t))
	ctx := context.Background()

	first, err := repo.ResolveCurrent(ctx, "o1", "p1", "general", "ada")
	if err != nil {
		t.Fatalf("first ResolveCurrent: %v", err)
	}
	if first.ID == "" || !first.Current {
		t.Fatalf("first resolve = %+v, want a current row with an id", first)
	}
	if first.CreatedBy != "ada" {
		t.Fatalf("CreatedBy = %q, want the first resolver", first.CreatedBy)
	}

	// A later resolve — any caller — returns the SAME thread, and the creator
	// stamp does not move.
	again, err := repo.ResolveCurrent(ctx, "o1", "p1", "general", "grace")
	if err != nil {
		t.Fatalf("second ResolveCurrent: %v", err)
	}
	if again.ID != first.ID {
		t.Fatalf("second resolve minted a new thread: %q != %q", again.ID, first.ID)
	}
	if again.CreatedBy != "ada" {
		t.Fatalf("CreatedBy moved to %q on a later resolve", again.CreatedBy)
	}

	// Scope is (org, project, use_case): a different project gets its own.
	other, err := repo.ResolveCurrent(ctx, "o1", "p2", "general", "ada")
	if err != nil {
		t.Fatalf("other-project ResolveCurrent: %v", err)
	}
	if other.ID == first.ID {
		t.Fatalf("projects share a thread: %q", other.ID)
	}
}

// The reason the partial unique exists: two teammates racing the very first
// resolve must converge on ONE thread — the #420 admission pattern.
func TestConversationRepo_RacingResolversConverge(t *testing.T) {
	t.Parallel()
	repo := spec.NewConversationRepository(dbtest.New(t))
	ctx := context.Background()

	const racers = 8
	ids := make([]string, racers)
	var wg sync.WaitGroup
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			row, err := repo.ResolveCurrent(ctx, "o1", "p1", "general", "user")
			if err != nil {
				t.Errorf("racer %d: %v", n, err)
				return
			}
			ids[n] = row.ID
		}(i)
	}
	wg.Wait()
	for i := 1; i < racers; i++ {
		if ids[i] != ids[0] {
			t.Fatalf("racers diverged: ids[%d]=%q != ids[0]=%q", i, ids[i], ids[0])
		}
	}
}

func TestConversationRepo_RotateMovesCurrent(t *testing.T) {
	t.Parallel()
	repo := spec.NewConversationRepository(dbtest.New(t))
	ctx := context.Background()

	old, err := repo.ResolveCurrent(ctx, "o1", "p1", "general", "ada")
	if err != nil {
		t.Fatalf("ResolveCurrent: %v", err)
	}

	fresh, err := repo.Rotate(ctx, "o1", "p1", "general", "grace")
	if err != nil {
		t.Fatalf("Rotate: %v", err)
	}
	if fresh.ID == old.ID {
		t.Fatalf("Rotate returned the old thread")
	}
	if !fresh.Current || fresh.CreatedBy != "grace" {
		t.Fatalf("rotated row = %+v, want current, created by the rotator", fresh)
	}

	// Resolve now answers with the rotated thread; the old row survives
	// non-current (the multi-conversation future's history).
	now, err := repo.ResolveCurrent(ctx, "o1", "p1", "general", "ada")
	if err != nil {
		t.Fatalf("post-rotate ResolveCurrent: %v", err)
	}
	if now.ID != fresh.ID {
		t.Fatalf("resolve after rotate = %q, want %q", now.ID, fresh.ID)
	}

	// IsCurrent is the turn-admission fence (the single-era 409 rule).
	if ok, err := repo.IsCurrent(ctx, "o1", "p1", "general", old.ID); err != nil || ok {
		t.Fatalf("IsCurrent(old) = (%v, %v), want (false, nil)", ok, err)
	}
	if ok, err := repo.IsCurrent(ctx, "o1", "p1", "general", fresh.ID); err != nil || !ok {
		t.Fatalf("IsCurrent(fresh) = (%v, %v), want (true, nil)", ok, err)
	}
}

// Rotating a project that never resolved is a create, not an error — the
// console's New-conversation works on a project whose thread was never opened.
func TestConversationRepo_RotateOnVirginProjectCreates(t *testing.T) {
	t.Parallel()
	repo := spec.NewConversationRepository(dbtest.New(t))
	ctx := context.Background()

	fresh, err := repo.Rotate(ctx, "o1", "p1", "general", "ada")
	if err != nil {
		t.Fatalf("Rotate on virgin project: %v", err)
	}
	if fresh.ID == "" || !fresh.Current {
		t.Fatalf("rotated row = %+v, want a current row", fresh)
	}
	now, err := repo.ResolveCurrent(ctx, "o1", "p1", "general", "grace")
	if err != nil || now.ID != fresh.ID {
		t.Fatalf("resolve after virgin rotate = (%+v, %v), want the rotated row", now, err)
	}
}
