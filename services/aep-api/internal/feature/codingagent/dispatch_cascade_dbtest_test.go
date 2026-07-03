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

// DBTEST tier: DispatchCascadeHook.OnTaskDeployed — the post-deploy cascade. It
// takes a per-project advisory lock on the REAL DB (so it needs Postgres) and
// then delegates to DispatchService.DispatchTasks. The dispatch itself (gating +
// URL resolution + the sibling re-evaluation) lives INSIDE DispatchService and
// is integration-owned; this file pins the hook's own contract: it acquires the
// lock without erroring, delegates with the right (org, project), swallows a
// dispatch error (best-effort — the deploy transition already committed), and
// no-ops on its nil-guards.
//
// SERIALISATION (was a pinned no-op, now fixed): the hook holds a per-project
// `pg_advisory_xact_lock` across the whole guarded cascade (trait sync +
// env-config re-emit + DispatchTasks) by running the lock and the work inside
// one real db.Transaction. The former code took the lock via a bare Exec, which
// under SkipDefaultTransaction (production and dbtest both use it) autocommits
// and releases the XACT lock the instant it returns — BEFORE DispatchTasks ran —
// so it provided no cross-call exclusion at all. TestDispatchCascadeHook_
// OnTaskDeployed_SerialisesConcurrentDeploys proves two concurrent deploys
// against the same project now serialise (max concurrent DispatchTasks == 1).

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts/artifactstest"
	"github.com/wso2/aep/aep-api/internal/feature/component"
	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
)

func TestDispatchCascadeHook_OnTaskDeployed_Delegates(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	dispatch := &fakeDispatchService{results: []DispatchResult{{TaskID: "x", Status: "running"}}}
	hook := NewDispatchCascadeHook(db, dispatch)

	hook.OnTaskDeployed(ctx, "acme", "p1", "api")

	calls := dispatch.dispatchCalls()
	if len(calls) != 1 || calls[0].orgID != "acme" || calls[0].projectID != "p1" {
		t.Fatalf("hook must delegate to DispatchTasks with (acme,p1), got %v", calls)
	}
}

func TestDispatchCascadeHook_OnTaskDeployed_SwallowsDispatchError(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	// The deploy transition already committed by the time the cascade runs, so a
	// DispatchTasks failure must be logged-and-swallowed, never propagated/paniced.
	dispatch := &fakeDispatchService{err: errors.New("dispatch boom")}
	hook := NewDispatchCascadeHook(db, dispatch)

	hook.OnTaskDeployed(ctx, "acme", "p1", "api") // must not panic

	if len(dispatch.dispatchCalls()) != 1 {
		t.Fatal("DispatchTasks must still have been attempted despite the error")
	}
}

// concurrencyProbeDispatch records the peak number of DispatchTasks calls in
// flight at once, so a serialisation test can assert the per-project lock keeps
// two concurrent hooks from overlapping. The sleep widens the overlap window: a
// no-op lock lets both hooks enter DispatchTasks together (peak 2); a held lock
// forces the second to wait for the first's transaction to commit (peak 1).
type concurrencyProbeDispatch struct {
	mu      sync.Mutex
	active  int
	maxSeen int
	calls   int
}

func (f *concurrencyProbeDispatch) DispatchTasks(_ context.Context, _, _ string) ([]DispatchResult, error) {
	f.mu.Lock()
	f.active++
	f.calls++
	if f.active > f.maxSeen {
		f.maxSeen = f.active
	}
	f.mu.Unlock()

	time.Sleep(200 * time.Millisecond)

	f.mu.Lock()
	f.active--
	f.mu.Unlock()
	return nil, nil
}

func (f *concurrencyProbeDispatch) RetryTask(_ context.Context, _ string) (DispatchResult, error) {
	return DispatchResult{}, nil
}

func (f *concurrencyProbeDispatch) peak() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.maxSeen
}

func (f *concurrencyProbeDispatch) total() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func TestDispatchCascadeHook_OnTaskDeployed_SerialisesConcurrentDeploys(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	// Two near-simultaneous deploys against the SAME project. The per-project
	// advisory lock, held across the guarded work inside one transaction, must
	// serialise them — a dependent shared between two deps must dispatch exactly
	// once when the second dep lands, not race with the first.
	fake := &concurrencyProbeDispatch{}
	hook := NewDispatchCascadeHook(db, fake)

	var wg sync.WaitGroup
	wg.Add(2)
	for i := 0; i < 2; i++ {
		go func() {
			defer wg.Done()
			hook.OnTaskDeployed(ctx, "acme", "p1", "api")
		}()
	}
	wg.Wait()

	if peak := fake.peak(); peak != 1 {
		t.Fatalf("per-project advisory lock must serialise concurrent deploys: peak concurrent DispatchTasks = %d, want 1", peak)
	}
	if total := fake.total(); total != 2 {
		t.Fatalf("both hooks must eventually dispatch, got %d calls", total)
	}
}

// fakeSPAEmitter satisfies the unexported projectSPARuntimeConfigEmitter port.
type fakeSPAEmitter struct {
	mu    sync.Mutex
	calls []string
}

func (f *fakeSPAEmitter) EmitForProjectSPAs(_ context.Context, orgID, projectID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, orgID+"/"+projectID)
	return nil
}

// TestDispatchCascadeHook_OnTaskDeployed_InvokesTraitSyncAndRuntimeConfig
// closes the cross-feature wiring gap the coverage sweep flagged: production
// wires SetTraitSync + SetRuntimeConfig (internal/app), but no test ever had —
// the tests above exercise only the nil-guard branches. Here the hook drives
// the REAL component.TraitSyncService over a real ArtifactStore (recording
// fake beneath — empty design, so the sync no-ops after its first real read)
// plus a hand-fake emitter, proving the cascade reaches past both nil-guards
// into the real entry points with the right (org, project) and still
// dispatches afterwards.
func TestDispatchCascadeHook_OnTaskDeployed_InvokesTraitSyncAndRuntimeConfig(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	var designReadsMu sync.Mutex
	var designReads []string
	fakeArtifacts := &artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(_ context.Context, orgID, projectID string) (map[string]string, error) {
			designReadsMu.Lock()
			defer designReadsMu.Unlock()
			designReads = append(designReads, orgID+"/"+projectID)
			return map[string]string{}, nil
		},
	}
	// ComponentClient is nil: with an empty design SyncProjectAPITraits
	// returns before any OC call — the assertion is that the REAL entry ran.
	traitSync := component.NewTraitSyncService(nil, artifacts.NewArtifactStore(fakeArtifacts))
	emitter := &fakeSPAEmitter{}
	dispatch := &fakeDispatchService{}

	hook := NewDispatchCascadeHook(db, dispatch)
	hook.SetTraitSync(traitSync)
	hook.SetRuntimeConfig(emitter)

	hook.OnTaskDeployed(ctx, "acme", "p1", "api")

	designReadsMu.Lock()
	gotReads := append([]string(nil), designReads...)
	designReadsMu.Unlock()
	if len(gotReads) != 1 || gotReads[0] != "acme/p1" {
		t.Fatalf("real SyncProjectAPITraits must read the design once with (acme,p1), got %v", gotReads)
	}
	emitter.mu.Lock()
	gotEmits := append([]string(nil), emitter.calls...)
	emitter.mu.Unlock()
	if len(gotEmits) != 1 || gotEmits[0] != "acme/p1" {
		t.Fatalf("EmitForProjectSPAs must be called once with (acme,p1), got %v", gotEmits)
	}
	if calls := dispatch.dispatchCalls(); len(calls) != 1 {
		t.Fatalf("cascade must still dispatch after the re-emits, got %d calls", len(calls))
	}
}
