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

// DBTEST tier (skips under -short; `make test-db` / the DB lane runs it): the
// SQL-shaped behaviour of the three DB-poller watchers (build / coding-agent /
// on-hold) over a pristine per-test Postgres (dbtest.New). Their row-selection
// SQL — status filter, run-name-set filter, dispatch-deferred filter, and the
// FOR UPDATE SKIP LOCKED claim — cannot be faked; this is exactly the tier for
// it. Each watcher's per-tick function (sweep) is called DIRECTLY (in-package),
// side-stepping the time.Ticker loop in Run. The OC ComponentClient is moq'd
// (out-of-process) and the projector/build-ops are faked at their ports.

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
	"github.com/wso2/aep/aep-api/internal/contracts"
	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
	"github.com/wso2/aep/aep-api/models"
)

// Fixed UUIDs so seeded rows have stable, parseable ids (CodingAgentLog and the
// JobWatcher capture path uuid.Parse the task id).
const (
	taskA = "aaaaaaaa-0000-0000-0000-000000000001"
	taskB = "bbbbbbbb-0000-0000-0000-000000000002"
	taskC = "cccccccc-0000-0000-0000-000000000003"
	taskD = "dddddddd-0000-0000-0000-000000000004"
	taskE = "eeeeeeee-0000-0000-0000-000000000005"
)

func wfSucceeded() *models.WorkflowRun {
	return &models.WorkflowRun{Status: openchoreo.ReasonWorkflowSucceeded, Completed: true}
}
func wfFailed() *models.WorkflowRun {
	return &models.WorkflowRun{Status: openchoreo.ReasonWorkflowFailed, Completed: true}
}
func wfAuthFailure() *models.WorkflowRun {
	return &models.WorkflowRun{
		Status: openchoreo.ReasonWorkflowFailed, Completed: true,
		Tasks: []models.WorkflowRunTask{
			{Name: "checkout-source", Phase: "Failed", Message: "fatal: Authentication failed for 'https://github.com/acme/demo.git/'"},
		},
	}
}

// runsMock builds a moq ComponentClient answering GetWorkflowRun from a runName
// → run map; unmapped run names error (so a wrongly-selected row is loud).
func runsMock(runs map[string]*models.WorkflowRun) *ocmocks.ComponentClientMock {
	return &ocmocks.ComponentClientMock{
		GetWorkflowRunFunc: func(_ context.Context, _ string, runName string) (*models.WorkflowRun, error) {
			if r, ok := runs[runName]; ok {
				return r, nil
			}
			return nil, fmt.Errorf("unexpected GetWorkflowRun(%q)", runName)
		},
	}
}

func polledRunNames(oc *ocmocks.ComponentClientMock) map[string]bool {
	got := map[string]bool{}
	for _, c := range oc.GetWorkflowRunCalls() {
		got[c.RunName] = true
	}
	return got
}

// ============================================================================
// BuildWatcher.sweep
// ============================================================================

func TestBuildWatcher_Sweep_SelectionAndTerminalEvents(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	// Selected: building + run name set.
	seedTask(t, db, models.ComponentTask{ID: taskA, Status: string(models.TaskStatusBuilding), LastBuildRunName: "run-ok"})
	seedTask(t, db, models.ComponentTask{ID: taskB, Status: string(models.TaskStatusBuilding), LastBuildRunName: "run-bad"})
	// NOT selected: building but no run name (WHERE last_build_run_name <> '').
	seedTask(t, db, models.ComponentTask{ID: taskC, Status: string(models.TaskStatusBuilding), LastBuildRunName: ""})
	// NOT selected: has a run name but wrong status.
	seedTask(t, db, models.ComponentTask{ID: taskD, Status: string(models.TaskStatusPending), LastBuildRunName: "run-pending"})

	oc := runsMock(map[string]*models.WorkflowRun{"run-ok": wfSucceeded(), "run-bad": wfFailed()})
	proj := &fakeProjector{}
	w := NewBuildWatcher(db, oc, proj, nil, &fakeBuildOps{}, 3)

	w.sweep(ctx)

	// Only the two building+named rows were polled.
	polled := polledRunNames(oc)
	if !polled["run-ok"] || !polled["run-bad"] {
		t.Fatalf("both building+named rows must be polled, got %v", polled)
	}
	if polled[""] || polled["run-pending"] {
		t.Fatalf("empty-run / non-building rows must NOT be polled, got %v", polled)
	}
	// Terminal events projected per row.
	if ev := proj.applyEventsFor(taskA); len(ev) != 1 || ev[0] != contracts.TaskEventBuildSucceeded {
		t.Fatalf("taskA events = %v; want [build.succeeded]", ev)
	}
	if ev := proj.applyEventsFor(taskB); len(ev) != 1 || ev[0] != contracts.TaskEventBuildFailed {
		t.Fatalf("taskB events = %v; want [build.failed]", ev)
	}
}

func TestBuildWatcher_Sweep_AuthRetryWithinBudget(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	seedTask(t, db, models.ComponentTask{
		ID: taskA, Status: string(models.TaskStatusBuilding),
		LastBuildRunName: "run-auth", LastBuildSHA: "sha-1", BuildAuthRetryCount: 0,
	})
	oc := runsMock(map[string]*models.WorkflowRun{"run-auth": wfAuthFailure()})
	proj := &fakeProjector{}
	buildOps := &fakeBuildOps{runName: "run-auth-2"}
	w := NewBuildWatcher(db, oc, proj, nil, buildOps, 3)

	w.sweep(ctx)

	// Within budget: re-mint fired, no terminal event.
	if buildOps.count() != 1 {
		t.Fatalf("RetryAuthFailedBuild must fire once within budget, got %d", buildOps.count())
	}
	if ev := proj.applyEventsFor(taskA); len(ev) != 0 {
		t.Fatalf("no terminal event while retrying, got %v", ev)
	}
	// Counter incremented + run name advanced atomically in the DB.
	row := loadTask(t, db, taskA)
	if row.BuildAuthRetryCount != 1 {
		t.Fatalf("BuildAuthRetryCount = %d; want 1", row.BuildAuthRetryCount)
	}
	if row.LastBuildRunName != "run-auth-2" {
		t.Fatalf("LastBuildRunName must advance to the retry run, got %q", row.LastBuildRunName)
	}
}

func TestBuildWatcher_Sweep_AuthRetryBudgetExhausted(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	// Already at budget → the next auth failure is terminal.
	seedTask(t, db, models.ComponentTask{
		ID: taskA, Status: string(models.TaskStatusBuilding),
		LastBuildRunName: "run-auth", LastBuildSHA: "sha-1", BuildAuthRetryCount: 3,
	})
	oc := runsMock(map[string]*models.WorkflowRun{"run-auth": wfAuthFailure()})
	proj := &fakeProjector{}
	buildOps := &fakeBuildOps{runName: "should-not-be-used"}
	w := NewBuildWatcher(db, oc, proj, nil, buildOps, 3)

	w.sweep(ctx)

	if buildOps.count() != 0 {
		t.Fatalf("budget exhausted → no more re-mints, got %d", buildOps.count())
	}
	if ev := proj.applyEventsFor(taskA); len(ev) != 1 || ev[0] != contracts.TaskEventBuildAuthRetryExhausted {
		t.Fatalf("taskA events = %v; want [build.auth_retry_exceeded]", ev)
	}
}

// ============================================================================
// CodingAgentWatcher.sweep
// ============================================================================

func TestCodingAgentWatcher_Sweep_SelectionAndFailureOnly(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	// Selected: in_progress + run name set. Note: this watcher does NOT filter
	// by run-name prefix — it selects BOTH the new "ca-…" shape and the legacy
	// "coding-agent-…" shape (the ca-%% prefix filter belongs to JobWatcher,
	// proven in job_watcher_dbtest_test.go). Both are polled here.
	seedTask(t, db, models.ComponentTask{ID: taskA, Status: string(models.TaskStatusInProgress), LastCodingAgentRunName: "ca-aaaa-01"})
	seedTask(t, db, models.ComponentTask{ID: taskB, Status: string(models.TaskStatusInProgress), LastCodingAgentRunName: "coding-agent-bbbb-99"})
	// NOT selected: in_progress but no run name.
	seedTask(t, db, models.ComponentTask{ID: taskC, Status: string(models.TaskStatusInProgress), LastCodingAgentRunName: ""})
	// NOT selected: has a run name but wrong status.
	seedTask(t, db, models.ComponentTask{ID: taskD, Status: string(models.TaskStatusReadyForReview), LastCodingAgentRunName: "ca-dddd-04"})

	oc := runsMock(map[string]*models.WorkflowRun{
		"ca-aaaa-01":           wfFailed(),    // terminal failure → event
		"coding-agent-bbbb-99": wfSucceeded(), // success rides the webhook → non-event
	})
	proj := &fakeProjector{}
	w := NewCodingAgentWatcher(db, oc, proj, nil)

	w.sweep(ctx)

	polled := polledRunNames(oc)
	if !polled["ca-aaaa-01"] || !polled["coding-agent-bbbb-99"] {
		t.Fatalf("both in_progress+named rows (any prefix) must be polled, got %v", polled)
	}
	if polled[""] || polled["ca-dddd-04"] {
		t.Fatalf("empty-run / non-in_progress rows must NOT be polled, got %v", polled)
	}
	// Only the failed run transitions; the succeeded one is a non-event.
	if ev := proj.applyEventsFor(taskA); len(ev) != 1 || ev[0] != contracts.TaskEventCodingAgentFailed {
		t.Fatalf("taskA events = %v; want [coding_agent.failed]", ev)
	}
	if ev := proj.applyEventsFor(taskB); len(ev) != 0 {
		t.Fatalf("succeeded coding-agent run must project no event, got %v", ev)
	}
}

// ============================================================================
// OnHoldWatcher.sweep
// ============================================================================

func TestOnHoldWatcher_Sweep_DeferredFilterAndPerProjectDedup(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	deferred := time.Now().Add(-30 * time.Second)
	// Two on_hold+deferred tasks in the SAME project → dispatched ONCE.
	seedTask(t, db, models.ComponentTask{ID: taskA, OrgID: "acme", ProjectID: "p1", Status: string(models.TaskStatusOnHold), DispatchDeferredAt: &deferred})
	seedTask(t, db, models.ComponentTask{ID: taskB, OrgID: "acme", ProjectID: "p1", Status: string(models.TaskStatusOnHold), DispatchDeferredAt: &deferred})
	// A different project → dispatched separately.
	seedTask(t, db, models.ComponentTask{ID: taskC, OrgID: "acme", ProjectID: "p2", Status: string(models.TaskStatusOnHold), DispatchDeferredAt: &deferred})
	// on_hold but deferred_at NULL → NOT selected (waiting on undeployed deps, not a timing race).
	seedTask(t, db, models.ComponentTask{ID: taskD, OrgID: "globex", ProjectID: "p1", Status: string(models.TaskStatusOnHold), DispatchDeferredAt: nil})
	// deferred set but wrong status → NOT selected.
	seedTask(t, db, models.ComponentTask{ID: taskE, OrgID: "initech", ProjectID: "p1", Status: string(models.TaskStatusPending), DispatchDeferredAt: &deferred})

	var mu sync.Mutex
	calls := map[projectKey]int{}
	dispatch := func(_ context.Context, org, proj string) (int, error) {
		mu.Lock()
		calls[projectKey{orgID: org, projectID: proj}]++
		mu.Unlock()
		return 1, nil
	}
	w := NewOnHoldWatcher(db, dispatch)

	w.sweep(ctx)

	mu.Lock()
	defer mu.Unlock()
	if calls[projectKey{"acme", "p1"}] != 1 {
		t.Fatalf("acme/p1 must be dispatched exactly once (deduped), got %d", calls[projectKey{"acme", "p1"}])
	}
	if calls[projectKey{"acme", "p2"}] != 1 {
		t.Fatalf("acme/p2 must be dispatched once, got %d", calls[projectKey{"acme", "p2"}])
	}
	if _, ok := calls[projectKey{"globex", "p1"}]; ok {
		t.Fatal("null-deferred_at project must NOT be dispatched")
	}
	if _, ok := calls[projectKey{"initech", "p1"}]; ok {
		t.Fatal("non-on_hold project must NOT be dispatched")
	}
}

// ============================================================================
// ResourceWatcher.sweep
// ============================================================================

// bindingsMock builds a moq ResourceClient answering GetBinding from a
// bindingName → binding map; unmapped names return (nil, nil) (the OC 404 shape
// — binding not created yet), so a wrongly-selected row is treated as not-ready.
func bindingsMock(bindings map[string]*openchoreo.ResourceReleaseBinding) *ocmocks.ResourceClientMock {
	return &ocmocks.ResourceClientMock{
		GetBindingFunc: func(_ context.Context, _, name string) (*openchoreo.ResourceReleaseBinding, error) {
			return bindings[name], nil
		},
	}
}

func rrbReady() *openchoreo.ResourceReleaseBinding {
	return &openchoreo.ResourceReleaseBinding{
		Status: &openchoreo.ResourceReleaseBindingStatus{
			Conditions: []openchoreo.OCCondition{{Type: "Ready", Status: "True"}},
		},
	}
}
func rrbTerminalFailed() *openchoreo.ResourceReleaseBinding {
	return &openchoreo.ResourceReleaseBinding{
		Status: &openchoreo.ResourceReleaseBindingStatus{
			Conditions: []openchoreo.OCCondition{{Type: "ResourcesReady", Status: "False", Reason: "Failed"}},
		},
	}
}
func rrbProgressing() *openchoreo.ResourceReleaseBinding {
	return &openchoreo.ResourceReleaseBinding{
		Status: &openchoreo.ResourceReleaseBindingStatus{
			Conditions: []openchoreo.OCCondition{{Type: "ResourcesReady", Status: "False", Reason: "ResourcesProgressing"}},
		},
	}
}

// TestResourceWatcher_Sweep_SelectionAndTerminalEvents proves the row-selection
// SQL (type=resource-provisioning AND status=building) and the completion routing
// through the projector: a ready binding → resource_ready, a terminal-failed
// binding → provision_failed, a mid-provision (CNPG) binding → NO event, and
// rows of the wrong type/status are never polled.
func TestResourceWatcher_Sweep_SelectionAndTerminalEvents(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	// Selected: resource-provisioning + building. seedTask defaults ProjectID=demo,
	// so the binding name is demo-<resource>-development.
	seedTask(t, db, models.ComponentTask{ID: taskA, Type: models.TaskTypeResourceProvisioning, Status: string(models.TaskStatusBuilding), ResourceName: "db-ready"})
	seedTask(t, db, models.ComponentTask{ID: taskB, Type: models.TaskTypeResourceProvisioning, Status: string(models.TaskStatusBuilding), ResourceName: "db-failed"})
	seedTask(t, db, models.ComponentTask{ID: taskC, Type: models.TaskTypeResourceProvisioning, Status: string(models.TaskStatusBuilding), ResourceName: "db-progressing"})
	// NOT selected: resource-provisioning but wrong status.
	seedTask(t, db, models.ComponentTask{ID: taskD, Type: models.TaskTypeResourceProvisioning, Status: string(models.TaskStatusPending), ResourceName: "db-pending"})
	// NOT selected: building but wrong type (a component build task).
	seedTask(t, db, models.ComponentTask{ID: taskE, Status: string(models.TaskStatusBuilding), LastBuildRunName: "run-x"})

	rc := bindingsMock(map[string]*openchoreo.ResourceReleaseBinding{
		"demo-db-ready-development":       rrbReady(),
		"demo-db-failed-development":      rrbTerminalFailed(),
		"demo-db-progressing-development": rrbProgressing(),
		// db-pending's binding is intentionally absent — it must never be polled.
	})
	proj := &fakeProjector{}
	w := NewResourceWatcher(db, rc, proj, nil)

	w.sweep(ctx)

	if ev := proj.applyEventsFor(taskA); len(ev) != 1 || ev[0] != contracts.TaskEventResourceReady {
		t.Fatalf("taskA (ready) events = %v; want [resource_ready]", ev)
	}
	if ev := proj.applyEventsFor(taskB); len(ev) != 1 || ev[0] != contracts.TaskEventProvisionFailed {
		t.Fatalf("taskB (terminal) events = %v; want [provision_failed]", ev)
	}
	if ev := proj.applyEventsFor(taskC); len(ev) != 0 {
		t.Fatalf("taskC (mid-provision) must apply NO event, got %v", ev)
	}
	if ev := proj.applyEventsFor(taskD); len(ev) != 0 {
		t.Fatalf("taskD (pending, wrong status) must not be processed, got %v", ev)
	}
	if ev := proj.applyEventsFor(taskE); len(ev) != 0 {
		t.Fatalf("taskE (wrong type) must not be processed, got %v", ev)
	}
}

// ============================================================================
// FOR UPDATE SKIP LOCKED — the concurrency claim the watchers rely on
// ============================================================================

// TestSkipLocked_SecondClaimSkipsHeldRow proves the SQL clause every watcher's
// batch SELECT uses: a row locked by one transaction is SKIPPED (not blocked
// on) by a second concurrent claim. The query below mirrors BuildWatcher.sweep
// verbatim. If SKIP LOCKED were dropped, the second SELECT would BLOCK on the
// held row instead of returning empty — caught here by the 3s timeout.
//
// HONEST NOTE (surfaced to reviewers, not asserted): each watcher's sweep runs
// this SELECT in its OWN short transaction that COMMITS as soon as the batch is
// scanned — the row lock is released BEFORE per-row processing. So SKIP LOCKED
// de-duplicates the *selection window* across replicas, not the whole tick;
// two replicas can still both process a row whose select windows didn't
// overlap. That double-processing is tolerated because ApplyBuildResult goes
// through the guarded task-state machine (a re-applied terminal transition is a
// no-op). The clause here is genuinely load-bearing for the common case.
func TestSkipLocked_SecondClaimSkipsHeldRow(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	seedTask(t, db, models.ComponentTask{ID: taskA, Status: string(models.TaskStatusBuilding), LastBuildRunName: "run-1"})

	// THE production query (build_watcher.go's const) — not a hand-copied twin,
	// so dropping SKIP LOCKED from the real sweep fails this proof (review B2).
	claimSQL := buildWatcherClaimSQL

	// tx1 claims + holds the row (no commit).
	tx1 := db.WithContext(ctx).Begin()
	if tx1.Error != nil {
		t.Fatalf("begin tx1: %v", tx1.Error)
	}
	defer tx1.Rollback()
	var held []models.ComponentTask
	if err := tx1.Raw(claimSQL, string(models.TaskStatusBuilding)).Scan(&held).Error; err != nil {
		t.Fatalf("tx1 claim: %v", err)
	}
	if len(held) != 1 {
		t.Fatalf("tx1 must claim the single building row, got %d", len(held))
	}

	// tx2 runs the same claim concurrently — it must return FAST with 0 rows.
	type claimResult struct {
		rows int
		err  error
	}
	done := make(chan claimResult, 1)
	go func() {
		tx2 := db.WithContext(ctx).Begin()
		defer tx2.Rollback()
		var got []models.ComponentTask
		err := tx2.Raw(claimSQL, string(models.TaskStatusBuilding)).Scan(&got).Error
		done <- claimResult{rows: len(got), err: err}
	}()

	select {
	case r := <-done:
		if r.err != nil {
			t.Fatalf("tx2 claim: %v", r.err)
		}
		if r.rows != 0 {
			t.Fatalf("tx2 must SKIP the row held by tx1, got %d rows (double-claim!)", r.rows)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("tx2 claim BLOCKED — FOR UPDATE SKIP LOCKED appears to be missing")
	}
}

// TestWatcherClaimQueries_KeepSkipLocked structurally guards ALL THREE
// watchers' production claim queries: each must keep FOR UPDATE SKIP LOCKED
// (the behavioral proof above exercises the build watcher's const against a
// real Postgres; this closes the other two — review finding B2).
func TestWatcherClaimQueries_KeepSkipLocked(t *testing.T) {
	t.Parallel()
	for name, q := range map[string]string{
		"buildWatcherClaimSQL":       buildWatcherClaimSQL,
		"codingAgentWatcherClaimSQL": codingAgentWatcherClaimSQL,
		"onHoldWatcherClaimSQL":      onHoldWatcherClaimSQL,
		"resourceWatcherClaimSQL":    resourceWatcherClaimSQL,
	} {
		if !strings.Contains(q, "FOR UPDATE SKIP LOCKED") {
			t.Errorf("%s lost its FOR UPDATE SKIP LOCKED clause — two replicas would double-claim rows", name)
		}
	}
}
