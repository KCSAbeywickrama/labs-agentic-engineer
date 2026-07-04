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
	"context"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
	"github.com/wso2/aep/aep-api/internal/contracts"
	"github.com/wso2/aep/aep-api/models"
)

// ---- classifyBinding unit tests (pure function, no DB, no OC client) -------
//   - Ready=True          → (done=true,  failed=false)
//   - Terminal False      → (done=false, failed=true, reason=<condition reason>)
//   - Nil / pending / progressing → (done=false, failed=false)

func TestClassifyBinding_Nil(t *testing.T) {
	done, failed, reason := classifyBinding(nil)
	if done || failed || reason != "" {
		t.Fatalf("nil binding: want (false,false,\"\"), got (%v,%v,%q)", done, failed, reason)
	}
}

func TestClassifyBinding_NoStatus(t *testing.T) {
	b := &openchoreo.ResourceReleaseBinding{Status: nil}
	done, failed, reason := classifyBinding(b)
	if done || failed || reason != "" {
		t.Fatalf("no-status binding: want (false,false,\"\"), got (%v,%v,%q)", done, failed, reason)
	}
}

func TestClassifyBinding_Ready(t *testing.T) {
	b := &openchoreo.ResourceReleaseBinding{
		Status: &openchoreo.ResourceReleaseBindingStatus{
			Conditions: []openchoreo.OCCondition{{Type: "Ready", Status: "True"}},
		},
	}
	done, failed, _ := classifyBinding(b)
	if !done || failed {
		t.Fatalf("Ready=True: want (true,false), got (%v,%v)", done, failed)
	}
}

func TestClassifyBinding_ReadyFalse_TerminalReason(t *testing.T) {
	// A False condition with a non-progressing reason is terminal → failed, and
	// the condition Reason is surfaced so it can ride ProvisionFailed's errMsg.
	b := &openchoreo.ResourceReleaseBinding{
		Status: &openchoreo.ResourceReleaseBindingStatus{
			Conditions: []openchoreo.OCCondition{
				{Type: "ResourcesReady", Status: "False", Reason: "Failed"},
			},
		},
	}
	done, failed, reason := classifyBinding(b)
	if done || !failed {
		t.Fatalf("terminal-False condition: want (false,true), got (%v,%v)", done, failed)
	}
	if reason != "Failed" {
		t.Fatalf("terminal reason: want %q, got %q", "Failed", reason)
	}
}

func TestClassifyBinding_ReadyFalse_ProgressingReason(t *testing.T) {
	// A False condition with a progressing reason is NOT terminal — still waiting.
	// Includes OpenChoreo's COMPOUND reasons (e.g. "ResourcesProgressing", emitted
	// while a CNPG Postgres is "Setting up primary") — the live-E2E regression: a
	// mid-provision CNPG binding must NOT be misread as failed.
	for _, reason := range []string{
		"Creating", "Initializing", "Progressing", "Pending", "Waiting", "Provisioning", "",
		"ResourcesProgressing", "ResourcesProvisioning", "PrimaryPending", "WaitingForResources",
	} {
		b := &openchoreo.ResourceReleaseBinding{
			Status: &openchoreo.ResourceReleaseBindingStatus{
				Conditions: []openchoreo.OCCondition{
					{Type: "ResourcesReady", Status: "False", Reason: reason},
				},
			},
		}
		done, failed, _ := classifyBinding(b)
		if done || failed {
			t.Fatalf("progressing reason %q: want (false,false), got (%v,%v)", reason, done, failed)
		}
	}
}

func TestClassifyBinding_ReadyUnknown(t *testing.T) {
	b := &openchoreo.ResourceReleaseBinding{
		Status: &openchoreo.ResourceReleaseBindingStatus{
			Conditions: []openchoreo.OCCondition{{Type: "Ready", Status: "Unknown"}},
		},
	}
	done, failed, _ := classifyBinding(b)
	if done || failed {
		t.Fatalf("Ready=Unknown: want (false,false), got (%v,%v)", done, failed)
	}
}

// ---- handleTask unit tests (no DB — the not-ready/apply branches never touch
// w.db, and completion routes through the fake projector) -------------------

// readyBinding returns a ResourceReleaseBinding with Ready=True.
func readyBinding() *openchoreo.ResourceReleaseBinding {
	return &openchoreo.ResourceReleaseBinding{
		Status: &openchoreo.ResourceReleaseBindingStatus{
			Conditions: []openchoreo.OCCondition{{Type: "Ready", Status: "True"}},
		},
	}
}

// bindingRC returns a ResourceClientMock whose GetBinding always yields (b, err).
func bindingRC(b *openchoreo.ResourceReleaseBinding, err error) *ocmocks.ResourceClientMock {
	return &ocmocks.ResourceClientMock{
		GetBindingFunc: func(_ context.Context, _, _ string) (*openchoreo.ResourceReleaseBinding, error) {
			return b, err
		},
	}
}

func newTestWatcher(rc *ocmocks.ResourceClientMock, proj contracts.TaskTransitions) *ResourceWatcher {
	// db is nil intentionally: no handleTask branch touches w.db (completion is
	// the projector's job), so a nil *gorm.DB must not cause a panic.
	return NewResourceWatcher(nil, rc, proj, nil)
}

func provisioningTask() *models.ComponentTask {
	return &models.ComponentTask{
		ID:           "test-task",
		OrgID:        "test-org",
		ProjectID:    "test-project",
		ResourceName: "my-db",
		Type:         models.TaskTypeResourceProvisioning,
		Status:       string(models.TaskStatusBuilding),
		// LastEventAt nil → stale guard skipped.
	}
}

func TestResourceWatcher_HandleTask_NilBinding_LeavesTask(t *testing.T) {
	proj := &fakeProjector{}
	w := newTestWatcher(bindingRC(nil, nil), proj)

	w.handleTask(context.Background(), provisioningTask())

	if calls := proj.snapshot(); len(calls) != 0 {
		t.Fatalf("nil binding must not apply any event, got %v", calls)
	}
}

func TestResourceWatcher_HandleTask_ReadyBinding_AppliesResourceReady(t *testing.T) {
	proj := &fakeProjector{}
	w := newTestWatcher(bindingRC(readyBinding(), nil), proj)

	w.handleTask(context.Background(), provisioningTask())

	ev := proj.applyEventsFor("test-task")
	if len(ev) != 1 || ev[0] != contracts.TaskEventResourceReady {
		t.Fatalf("ready binding: want [resource_ready], got %v", ev)
	}
}

func TestResourceWatcher_HandleTask_TerminalBinding_AppliesProvisionFailedWithReason(t *testing.T) {
	proj := &fakeProjector{}
	failed := &openchoreo.ResourceReleaseBinding{
		Status: &openchoreo.ResourceReleaseBindingStatus{
			Conditions: []openchoreo.OCCondition{
				{Type: "ResourcesReady", Status: "False", Reason: "ImagePullBackOff"},
			},
		},
	}
	w := newTestWatcher(bindingRC(failed, nil), proj)

	w.handleTask(context.Background(), provisioningTask())

	calls := proj.snapshot()
	if len(calls) != 1 {
		t.Fatalf("terminal binding: want 1 apply, got %d (%v)", len(calls), calls)
	}
	if calls[0].event != contracts.TaskEventProvisionFailed {
		t.Fatalf("terminal binding: want provision_failed, got %q", calls[0].event)
	}
	if calls[0].errMsg != "ImagePullBackOff" {
		t.Fatalf("terminal binding: reason must ride errMsg, got %q", calls[0].errMsg)
	}
}

// TestResourceWatcher_HandleTask_ProgressingBinding_LeavesTask is the CNPG
// mid-provision regression at the handleTask layer: a False ResourcesReady with
// a compound "Progressing" reason must apply NO event (left for the next tick),
// not a spurious provision_failed.
func TestResourceWatcher_HandleTask_ProgressingBinding_LeavesTask(t *testing.T) {
	proj := &fakeProjector{}
	progressing := &openchoreo.ResourceReleaseBinding{
		Status: &openchoreo.ResourceReleaseBindingStatus{
			Conditions: []openchoreo.OCCondition{
				{Type: "ResourcesReady", Status: "False", Reason: "ResourcesProgressing"},
			},
		},
	}
	w := newTestWatcher(bindingRC(progressing, nil), proj)

	w.handleTask(context.Background(), provisioningTask())

	if calls := proj.snapshot(); len(calls) != 0 {
		t.Fatalf("mid-provision binding must not apply any event, got %v", calls)
	}
}

func TestResourceWatcher_HandleTask_GetBindingError_LeavesTask(t *testing.T) {
	proj := &fakeProjector{}
	w := newTestWatcher(bindingRC(nil, context.DeadlineExceeded), proj)

	w.handleTask(context.Background(), provisioningTask())

	if calls := proj.snapshot(); len(calls) != 0 {
		t.Fatalf("GetBinding error must not apply any event, got %v", calls)
	}
}

// TestResourceWatcher_HandleTask_StaleTask_Skips proves the bounded-age guard:
// a task whose LastEventAt is older than staleAfter is logged + left — GetBinding
// is never called and no event is applied.
func TestResourceWatcher_HandleTask_StaleTask_Skips(t *testing.T) {
	proj := &fakeProjector{}
	getBindingCalled := 0
	rc := &ocmocks.ResourceClientMock{
		GetBindingFunc: func(_ context.Context, _, _ string) (*openchoreo.ResourceReleaseBinding, error) {
			getBindingCalled++
			return readyBinding(), nil
		},
	}
	w := newTestWatcher(rc, proj)
	w.staleAfter = time.Minute

	task := provisioningTask()
	old := time.Now().Add(-2 * time.Minute)
	task.LastEventAt = &old

	w.handleTask(context.Background(), task)

	if getBindingCalled != 0 {
		t.Fatalf("stale task must not poll GetBinding, got %d calls", getBindingCalled)
	}
	if calls := proj.snapshot(); len(calls) != 0 {
		t.Fatalf("stale task must not apply any event, got %v", calls)
	}
}

// TestResourceWatcher_HandleTask_InvalidTransitionAbsorbed mirrors how the other
// watchers treat a projector error: the ready path fires ApplyBuildResult, and a
// returned error (e.g. ErrInvalidTransition when the task already advanced past
// building on a concurrent re-pick) is logged, not propagated or panicked on.
func TestResourceWatcher_HandleTask_InvalidTransitionAbsorbed(t *testing.T) {
	proj := &fakeProjector{applyErr: contracts.ErrInvalidTransition}
	w := newTestWatcher(bindingRC(readyBinding(), nil), proj)

	// Must not panic; the error is swallowed after logging.
	w.handleTask(context.Background(), provisioningTask())

	if ev := proj.applyEventsFor("test-task"); len(ev) != 1 || ev[0] != contracts.TaskEventResourceReady {
		t.Fatalf("apply must still be attempted once, got %v", ev)
	}
}
