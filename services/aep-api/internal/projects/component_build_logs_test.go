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

package projects

// UNIT tier for GetBuildLogs: the live read from OpenChoreo, its cursor, and
// the lifecycle answers (not started yet, running, finished, expired). The
// HTTP mapping of each answer lives in component_component_test.go.

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
	"github.com/wso2/aep/aep-api/internal/gen"
)

var logT0 = time.Date(2026, 10, 12, 16, 47, 20, 0, time.UTC)

func lineAt(ns int, log string) openchoreo.WorkflowRunLogLine {
	return openchoreo.WorkflowRunLogLine{Timestamp: logT0.Add(time.Duration(ns)), Log: log}
}

// liveLogs is an OC client whose run is web/svc's, with the given state and
// log; it records the `after` each log read asked from.
func liveLogs(completed bool, lines []openchoreo.WorkflowRunLogLine, after *[]time.Time) *ocmocks.ComponentClientMock {
	return &ocmocks.ComponentClientMock{
		GetWorkflowRunFunc: func(_ context.Context, _, run string) (*gen.WorkflowRun, error) {
			return &gen.WorkflowRun{Name: run, ProjectName: "web", ComponentName: "svc", Completed: completed}, nil
		},
		GetWorkflowRunLogsFunc: func(_ context.Context, _, _ string, a time.Time) ([]openchoreo.WorkflowRunLogLine, error) {
			if after != nil {
				*after = append(*after, a)
			}
			return lines, nil
		},
	}
}

func readLogs(t *testing.T, oc openchoreo.ComponentClient, cursor string) (*gen.BuildLogs, error) {
	t.Helper()
	return NewComponentService(oc, nil, nil, nil, nil, nil).GetBuildLogs(context.Background(), "acme", "web", "svc", "run-1", cursor)
}

func TestGetBuildLogs_FinishedBuildIsCompleteWithANanosecondCursor(t *testing.T) {
	t.Parallel()
	var after []time.Time
	logs, err := readLogs(t, liveLogs(true, []openchoreo.WorkflowRunLogLine{lineAt(1, "clone"), lineAt(2, "build")}, &after), "")
	if err != nil {
		t.Fatalf("GetBuildLogs: %v", err)
	}
	if !logs.Complete || len(logs.Logs) != 2 {
		t.Fatalf("logs = %+v", logs)
	}
	if logs.NextCursor != "2026-10-12T16:47:20.000000002Z" {
		t.Errorf("nextCursor = %q, want the newest line's timestamp at full precision", logs.NextCursor)
	}
	if len(after) != 1 || !after[0].IsZero() {
		t.Errorf("a first read must ask for the whole log, asked after %v", after)
	}
}

// Lines a container writes within one second must survive a poll that lands
// inside that second: the cursor is to the nanosecond, not the second.
func TestGetBuildLogs_TailKeepsLinesFromTheCursorsOwnSecond(t *testing.T) {
	t.Parallel()
	all := []openchoreo.WorkflowRunLogLine{lineAt(1, "a"), lineAt(2, "b"), lineAt(3, "c")}
	var after []time.Time
	logs, err := readLogs(t, liveLogs(false, all, &after), "2026-10-12T16:47:20.000000001Z")
	if err != nil {
		t.Fatalf("GetBuildLogs: %v", err)
	}
	if logs.Complete {
		t.Error("a running build must not be complete")
	}
	if len(logs.Logs) != 2 || logs.Logs[0].Log != "b" || logs.Logs[1].Log != "c" {
		t.Fatalf("logs = %+v, want only the lines after the cursor", logs.Logs)
	}
	// The tail asks OpenChoreo for the log after the cursor.
	if len(after) != 1 || !after[0].Equal(logT0.Add(1)) {
		t.Errorf("read after %v, want the cursor", after)
	}
}

// A poll that finds nothing new leaves nextCursor absent, so the client keeps
// the cursor it has.
func TestGetBuildLogs_NothingNewKeepsTheCursor(t *testing.T) {
	t.Parallel()
	logs, err := readLogs(t, liveLogs(false, []openchoreo.WorkflowRunLogLine{lineAt(1, "a")}, nil), "2026-10-12T16:47:20.000000001Z")
	if err != nil {
		t.Fatalf("GetBuildLogs: %v", err)
	}
	if len(logs.Logs) != 0 || logs.NextCursor != "" {
		t.Fatalf("logs = %+v", logs)
	}
}

// Just created: the WorkflowRun exists but its Argo workflow does not yet.
func TestGetBuildLogs_NotStartedIsAnEmptyIncompleteRead(t *testing.T) {
	t.Parallel()
	oc := liveLogs(false, nil, nil)
	oc.GetWorkflowRunLogsFunc = func(context.Context, string, string, time.Time) ([]openchoreo.WorkflowRunLogLine, error) {
		return nil, fmt.Errorf("%w: WorkflowRun not found", openchoreo.ErrNotFound)
	}
	logs, err := readLogs(t, oc, "")
	if err != nil {
		t.Fatalf("GetBuildLogs: %v", err)
	}
	if logs.Complete || len(logs.Logs) != 0 {
		t.Fatalf("logs = %+v, want an empty read the client polls again", logs)
	}
}

func TestGetBuildLogs_ExpiredBuild(t *testing.T) {
	t.Parallel()
	t.Run("run gone", func(t *testing.T) {
		oc := &ocmocks.ComponentClientMock{
			GetWorkflowRunFunc: func(context.Context, string, string) (*gen.WorkflowRun, error) {
				return nil, fmt.Errorf("%w: WorkflowRun not found", openchoreo.ErrNotFound)
			},
		}
		if _, err := readLogs(t, oc, ""); !errors.Is(err, ErrBuildExpired) {
			t.Fatalf("err = %v, want ErrBuildExpired", err)
		}
	})
	t.Run("deleted between the two reads", func(t *testing.T) {
		oc := liveLogs(true, nil, nil)
		oc.GetWorkflowRunLogsFunc = func(context.Context, string, string, time.Time) ([]openchoreo.WorkflowRunLogLine, error) {
			return nil, fmt.Errorf("%w: WorkflowRun not found", openchoreo.ErrNotFound)
		}
		if _, err := readLogs(t, oc, ""); !errors.Is(err, ErrBuildExpired) {
			t.Fatalf("err = %v, want ErrBuildExpired", err)
		}
	})
}

func TestGetBuildLogs_UnreadableRunIsUnavailableNotComplete(t *testing.T) {
	t.Parallel()
	oc := &ocmocks.ComponentClientMock{
		GetWorkflowRunFunc: func(context.Context, string, string) (*gen.WorkflowRun, error) {
			return nil, fmt.Errorf("%w: cluster down", openchoreo.ErrInternalServerError)
		},
	}
	if _, err := readLogs(t, oc, ""); !errors.Is(err, ErrLogSourceUnavailable) {
		t.Fatalf("err = %v, want ErrLogSourceUnavailable", err)
	}
}

// A line OpenChoreo could not timestamp cannot be ordered against a cursor:
// it is shown once, on the first read, never repeated by the tail.
func TestGetBuildLogs_UntimedLineIsShownOnce(t *testing.T) {
	t.Parallel()
	lines := []openchoreo.WorkflowRunLogLine{{Log: "untimed"}, lineAt(1, "a")}
	first, err := readLogs(t, liveLogs(false, lines, nil), "")
	if err != nil || len(first.Logs) != 2 {
		t.Fatalf("first read = %+v, %v", first, err)
	}
	tail, err := readLogs(t, liveLogs(false, lines, nil), first.NextCursor)
	if err != nil || len(tail.Logs) != 0 {
		t.Fatalf("tail read = %+v, %v; want nothing repeated", tail, err)
	}
}

func TestGetBuildLogs_RejectsABuildOfAnotherComponent(t *testing.T) {
	t.Parallel()
	oc := liveLogs(true, nil, nil)
	oc.GetWorkflowRunFunc = func(_ context.Context, _, run string) (*gen.WorkflowRun, error) {
		return &gen.WorkflowRun{Name: run, ProjectName: "web", ComponentName: "other", Completed: true}, nil
	}
	if _, err := readLogs(t, oc, ""); !errors.Is(err, ErrBuildNotInComponent) {
		t.Fatalf("err = %v, want ErrBuildNotInComponent", err)
	}
	if len(oc.GetWorkflowRunLogsCalls()) != 0 {
		t.Fatal("the log was read before the build was checked")
	}
}

func TestGetBuildLogs_RejectsACursorItDidNotIssue(t *testing.T) {
	t.Parallel()
	if _, err := readLogs(t, liveLogs(true, nil, nil), "1754476800000"); !errors.Is(err, ErrInvalidLogCursor) {
		t.Fatalf("err = %v, want ErrInvalidLogCursor", err)
	}
}
