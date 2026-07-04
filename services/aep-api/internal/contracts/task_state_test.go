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

package contracts

import (
	"errors"
	"testing"
)

func TestApplyTaskEventHappyPath(t *testing.T) {
	cases := []struct {
		from  TaskStatus
		event TaskEvent
		want  TaskStatus
	}{
		{TaskStatusPending, TaskEventDispatchSuccess, TaskStatusInProgress},
		{TaskStatusInProgress, TaskEventPRReady, TaskStatusReadyForReview},
		{TaskStatusReadyForReview, TaskEventPRMerged, TaskStatusMerged},
		{TaskStatusReadyForReview, TaskEventPRRejected, TaskStatusRejected},
		{TaskStatusInProgress, TaskEventPRRejected, TaskStatusRejected},
		{TaskStatusMerged, TaskEventPushMatched, TaskStatusBuilding},
		{TaskStatusBuilding, TaskEventBuildSucceeded, TaskStatusDeployed},
		{TaskStatusBuilding, TaskEventBuildFailed, TaskStatusFailed},
		{TaskStatusMerged, TaskEventBuildPathMismatch, TaskStatusFailed},
	}
	for _, c := range cases {
		got, err := ApplyTaskEvent(c.from, c.event)
		if err != nil {
			t.Errorf("from=%s event=%s: unexpected error %v", c.from, c.event, err)
		}
		if got != c.want {
			t.Errorf("from=%s event=%s: got %s, want %s", c.from, c.event, got, c.want)
		}
	}
}

func TestApplyTaskEventConfigAndProvisionCompletion(t *testing.T) {
	cases := []struct {
		from  TaskStatus
		event TaskEvent
		want  TaskStatus
	}{
		// Config-collection completion: pending|on_hold → deployed.
		{TaskStatusPending, TaskEventValuesProvisioned, TaskStatusDeployed},
		{TaskStatusOnHold, TaskEventValuesProvisioned, TaskStatusDeployed},
		// Resource-provisioning lifecycle.
		{TaskStatusPending, TaskEventProvisionStarted, TaskStatusBuilding},
		{TaskStatusBuilding, TaskEventResourceReady, TaskStatusDeployed},
		{TaskStatusBuilding, TaskEventProvisionFailed, TaskStatusFailed},
	}
	for _, c := range cases {
		got, err := ApplyTaskEvent(c.from, c.event)
		if err != nil {
			t.Errorf("from=%s event=%s: unexpected error %v", c.from, c.event, err)
		}
		if got != c.want {
			t.Errorf("from=%s event=%s: got %s, want %s", c.from, c.event, got, c.want)
		}
	}
}

func TestApplyTaskEventRejectsCompletionMisfires(t *testing.T) {
	cases := []struct {
		from  TaskStatus
		event TaskEvent
	}{
		// resource_ready and provision_failed are building-only.
		{TaskStatusPending, TaskEventResourceReady},
		{TaskStatusPending, TaskEventProvisionFailed},
		{TaskStatusOnHold, TaskEventResourceReady},
		// provision_started is pending-only.
		{TaskStatusBuilding, TaskEventProvisionStarted},
		{TaskStatusOnHold, TaskEventProvisionStarted},
		// values_provisioned is pending|on_hold-only.
		{TaskStatusBuilding, TaskEventValuesProvisioned},
		{TaskStatusInProgress, TaskEventValuesProvisioned},
	}
	for _, c := range cases {
		_, err := ApplyTaskEvent(c.from, c.event)
		if !errors.Is(err, ErrInvalidTransition) {
			t.Errorf("from=%s event=%s: expected ErrInvalidTransition, got %v", c.from, c.event, err)
		}
	}
}

func TestApplyTaskEventCompletionEventsRejectedFromTerminal(t *testing.T) {
	for _, term := range []TaskStatus{
		TaskStatusDeployed,
		TaskStatusRejected,
		TaskStatusFailed,
		TaskStatusAbandoned,
	} {
		for _, event := range []TaskEvent{
			TaskEventValuesProvisioned,
			TaskEventProvisionStarted,
			TaskEventResourceReady,
			TaskEventProvisionFailed,
		} {
			_, err := ApplyTaskEvent(term, event)
			if !errors.Is(err, ErrInvalidTransition) {
				t.Errorf("terminal %s event %s: expected ErrInvalidTransition, got %v", term, event, err)
			}
		}
	}
}

func TestApplyTaskEventTerminalAbsorbsLateEvents(t *testing.T) {
	for _, term := range []TaskStatus{
		TaskStatusDeployed,
		TaskStatusRejected,
		TaskStatusFailed,
	} {
		_, err := ApplyTaskEvent(term, TaskEventPRMerged)
		if !errors.Is(err, ErrInvalidTransition) {
			t.Errorf("terminal %s: expected ErrInvalidTransition, got %v", term, err)
		}
	}
}

func TestApplyTaskEventRefusesUnknownTransition(t *testing.T) {
	_, err := ApplyTaskEvent(TaskStatusPending, TaskEventBuildSucceeded)
	if !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("expected ErrInvalidTransition, got %v", err)
	}
}
