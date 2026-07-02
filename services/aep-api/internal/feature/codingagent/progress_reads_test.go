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

// UNIT tier: the /progress read paths beyond the pure helpers already in
// progress_service_test.go. Covers the legacy Observer branch of
// GetAgentProgress (faked observer.Client + faked task reader), GetBuildProgress
// (moq'd OC ComponentClient), the stateful build-step diff, and the new-path
// text/cursor helpers. The new-path DB branches (sidecar snapshot / live tail)
// are DB-shaped and live in progress_newpath_dbtest_test.go.

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/observer"
	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
	"github.com/wso2/aep/aep-api/models"
)

// ---- GetAgentProgress (legacy Observer path) -------------------------------

func TestGetAgentProgress_NilObserverUnavailable(t *testing.T) {
	// No proxy/db wired (default) + nil observer → 503 sentinel, before any
	// task lookup.
	svc := NewProgressService(&fakeTaskReader{}, nil, nil)
	_, err := svc.GetAgentProgress(context.Background(), "t1", 0, 0)
	if !errors.Is(err, ErrProgressUnavailable) {
		t.Fatalf("nil observer must map to ErrProgressUnavailable, got %v", err)
	}
}

func TestGetAgentProgress_RunNotProvisioned(t *testing.T) {
	task := &models.ComponentTask{ID: "t1", Status: string(models.TaskStatusInProgress)}
	tr := &fakeTaskReader{byID: map[string]*models.ComponentTask{"t1": task}}
	svc := NewProgressService(tr, nil, &fakeObserver{})

	resp, err := svc.GetAgentProgress(context.Background(), "t1", 42, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resp.Lines) != 0 {
		t.Fatalf("no run yet → no lines, got %d", len(resp.Lines))
	}
	// Cursor is unchanged when there's nothing to report; agent still active so
	// Final=false.
	if resp.CursorMillis != 42 || resp.Final {
		t.Fatalf("cursor=%d final=%v; want cursor=42 final=false", resp.CursorMillis, resp.Final)
	}
}

func TestGetAgentProgress_HappyPathParsesAndAdvancesCursor(t *testing.T) {
	task := &models.ComponentTask{
		ID:                     "t1",
		OrgID:                  "acme",
		Status:                 string(models.TaskStatusInProgress),
		LastCodingAgentRunName: "coding-agent-t1-1700000000000", // legacy shape → Observer path
	}
	tr := &fakeTaskReader{byID: map[string]*models.ComponentTask{"t1": task}}
	obs := &fakeObserver{lines: []observer.LogLine{
		{Log: `{"schemaVersion":1,"kind":"phase","phase":"planning","ts":"2026-05-07T14:30:00.000Z","seq":1}`},
		{Log: `{"schemaVersion":1,"kind":"phase","phase":"implementing","ts":"2026-05-07T14:30:05.000Z","seq":2}`},
	}}
	svc := NewProgressService(tr, nil, obs)

	resp, err := svc.GetAgentProgress(context.Background(), "t1", 0, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if obs.calls != 1 {
		t.Fatalf("observer must be queried once, got %d", obs.calls)
	}
	if len(resp.Lines) != 2 {
		t.Fatalf("expected 2 parsed events, got %d", len(resp.Lines))
	}
	if resp.Phase != "implementing" {
		t.Fatalf("Phase must be the most-recent phase, got %q", resp.Phase)
	}
	// Cursor advances to the last event's ts + 1ms.
	want := time.Date(2026, 5, 7, 14, 30, 5, 0, time.UTC).UnixMilli() + 1
	if resp.CursorMillis != want {
		t.Fatalf("cursor = %d; want %d", resp.CursorMillis, want)
	}
	if resp.Final {
		t.Fatal("in_progress task must not be Final")
	}
}

func TestGetAgentProgress_TruncatesToLimit(t *testing.T) {
	task := &models.ComponentTask{
		ID: "t1", OrgID: "acme", Status: string(models.TaskStatusInProgress),
		LastCodingAgentRunName: "coding-agent-t1-1700000000000",
	}
	tr := &fakeTaskReader{byID: map[string]*models.ComponentTask{"t1": task}}
	obs := &fakeObserver{lines: []observer.LogLine{
		{Log: `{"schemaVersion":1,"kind":"log","summary":"a","ts":"2026-05-07T14:30:00.000Z","seq":1}`},
		{Log: `{"schemaVersion":1,"kind":"log","summary":"b","ts":"2026-05-07T14:30:01.000Z","seq":2}`},
		{Log: `{"schemaVersion":1,"kind":"log","summary":"c","ts":"2026-05-07T14:30:02.000Z","seq":3}`},
	}}
	svc := NewProgressService(tr, nil, obs)

	resp, err := svc.GetAgentProgress(context.Background(), "t1", 0, 2) // limit 2, 3 available
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !resp.Truncated || len(resp.Lines) != 2 {
		t.Fatalf("expected truncation to 2, got truncated=%v len=%d", resp.Truncated, len(resp.Lines))
	}
}

func TestGetAgentProgress_ObserverUnavailableMapped(t *testing.T) {
	task := &models.ComponentTask{
		ID: "t1", OrgID: "acme", Status: string(models.TaskStatusInProgress),
		LastCodingAgentRunName: "coding-agent-t1-1700000000000",
	}
	tr := &fakeTaskReader{byID: map[string]*models.ComponentTask{"t1": task}}
	obs := &fakeObserver{err: observer.ErrUnavailable}
	svc := NewProgressService(tr, nil, obs)

	_, err := svc.GetAgentProgress(context.Background(), "t1", 0, 0)
	if !errors.Is(err, ErrProgressUnavailable) {
		t.Fatalf("observer ErrUnavailable must map to ErrProgressUnavailable, got %v", err)
	}
}

// ---- GetBuildProgress ------------------------------------------------------

func buildRun(completed bool, tasks ...models.WorkflowRunTask) *models.WorkflowRun {
	return &models.WorkflowRun{Status: "WorkflowRunning", Completed: completed, Tasks: tasks}
}

func TestGetBuildProgress_EmitsStepDeltasThenDedups(t *testing.T) {
	task := &models.ComponentTask{
		ID: "t1", OrgID: "acme", Status: string(models.TaskStatusBuilding), LastBuildRunName: "bld-1",
	}
	tr := &fakeTaskReader{byID: map[string]*models.ComponentTask{"t1": task}}
	run := buildRun(false,
		models.WorkflowRunTask{Name: "clone-source", Phase: "Succeeded", StartedAt: "2026-05-07T14:30:00Z", CompletedAt: "2026-05-07T14:30:01Z"},
		models.WorkflowRunTask{Name: "build-image", Phase: "Running", StartedAt: "2026-05-07T14:30:02Z"},
	)
	oc := &ocmocks.ComponentClientMock{
		GetWorkflowRunFunc: func(context.Context, string, string) (*models.WorkflowRun, error) { return run, nil },
	}
	svc := NewProgressService(tr, oc, nil)

	// First read: both steps are new deltas.
	resp, err := svc.GetBuildProgress(context.Background(), "t1", 0)
	if err != nil {
		t.Fatalf("build progress: %v", err)
	}
	if len(resp.Lines) != 2 {
		t.Fatalf("first read must emit both step deltas, got %d", len(resp.Lines))
	}
	for _, ev := range resp.Lines {
		if ev.Kind != "build_step" {
			t.Fatalf("build progress events must be kind build_step, got %q", ev.Kind)
		}
	}
	if resp.Final {
		t.Fatal("in-flight build must not be Final")
	}

	// Second read of the SAME run: phases unchanged → no new deltas (stateful dedup).
	resp2, err := svc.GetBuildProgress(context.Background(), "t1", 0)
	if err != nil {
		t.Fatalf("build progress 2: %v", err)
	}
	if len(resp2.Lines) != 0 {
		t.Fatalf("unchanged steps must not re-emit, got %d", len(resp2.Lines))
	}
}

func TestGetBuildProgress_CompletedFlipsFinal(t *testing.T) {
	task := &models.ComponentTask{
		ID: "t1", OrgID: "acme", Status: string(models.TaskStatusDeployed), LastBuildRunName: "bld-1",
	}
	tr := &fakeTaskReader{byID: map[string]*models.ComponentTask{"t1": task}}
	run := buildRun(true,
		models.WorkflowRunTask{Name: "build-image", Phase: "Succeeded", CompletedAt: "2026-05-07T14:30:10Z"},
	)
	oc := &ocmocks.ComponentClientMock{
		GetWorkflowRunFunc: func(context.Context, string, string) (*models.WorkflowRun, error) { return run, nil },
	}
	svc := NewProgressService(tr, oc, nil)

	resp, err := svc.GetBuildProgress(context.Background(), "t1", 0)
	if err != nil {
		t.Fatalf("build progress: %v", err)
	}
	if !resp.Final {
		t.Fatal("a Completed run must set Final=true")
	}
}

func TestGetBuildProgress_NoRunYet(t *testing.T) {
	// Past building (deployed) with no build run recorded → empty + Final by status.
	task := &models.ComponentTask{ID: "t1", OrgID: "acme", Status: string(models.TaskStatusDeployed)}
	tr := &fakeTaskReader{byID: map[string]*models.ComponentTask{"t1": task}}
	oc := &ocmocks.ComponentClientMock{
		GetWorkflowRunFunc: func(context.Context, string, string) (*models.WorkflowRun, error) {
			t.Fatal("must not query OC when no build run is recorded")
			return nil, nil
		},
	}
	svc := NewProgressService(tr, oc, nil)

	resp, err := svc.GetBuildProgress(context.Background(), "t1", 7)
	if err != nil {
		t.Fatalf("build progress: %v", err)
	}
	if len(resp.Lines) != 0 || resp.CursorMillis != 7 {
		t.Fatalf("no-run response: lines=%d cursor=%d", len(resp.Lines), resp.CursorMillis)
	}
	if !resp.Final { // not building → Final
		t.Fatal("non-building task with no run must be Final")
	}
}

func TestGetBuildProgress_OCErrorPropagates(t *testing.T) {
	task := &models.ComponentTask{ID: "t1", OrgID: "acme", Status: string(models.TaskStatusBuilding), LastBuildRunName: "bld-1"}
	tr := &fakeTaskReader{byID: map[string]*models.ComponentTask{"t1": task}}
	oc := &ocmocks.ComponentClientMock{
		GetWorkflowRunFunc: func(context.Context, string, string) (*models.WorkflowRun, error) {
			return nil, errors.New("oc down")
		},
	}
	svc := NewProgressService(tr, oc, nil)
	if _, err := svc.GetBuildProgress(context.Background(), "t1", 0); err == nil {
		t.Fatal("OC GetWorkflowRun error must propagate")
	}
}

// ---- diffBuildSteps (stateful) --------------------------------------------

func TestDiffBuildSteps_SinceFilterSkipsOldButRecordsPhase(t *testing.T) {
	svc := NewProgressService(nil, nil, nil)
	run := buildRun(false,
		models.WorkflowRunTask{Name: "old-step", Phase: "Succeeded", CompletedAt: "2026-05-07T14:30:00Z"},
		models.WorkflowRunTask{Name: "new-step", Phase: "Running", StartedAt: "2026-05-07T14:31:00Z"},
	)
	// sinceMillis at 14:30:30 → old-step (14:30:00) filtered, new-step (14:31:00) emitted.
	since := time.Date(2026, 5, 7, 14, 30, 30, 0, time.UTC).UnixMilli()
	out := svc.diffBuildSteps("t1", run, since)
	if len(out) != 1 || out[0].Step != "new-step" {
		t.Fatalf("since filter: expected only new-step, got %+v", out)
	}
	// old-step's phase was still recorded, so a subsequent poll won't re-emit it
	// even if the since window moves back.
	out2 := svc.diffBuildSteps("t1", run, 0)
	for _, ev := range out2 {
		if ev.Step == "old-step" {
			t.Fatal("old-step phase should have been recorded on the first pass")
		}
	}
}

// ---- new-path text/cursor helpers ------------------------------------------

func TestSplitTimestampPrefix(t *testing.T) {
	ts := "2026-05-07T14:30:00.000000000Z"
	if gotTs, rest := splitTimestampPrefix(ts + " hello world"); gotTs != ts || rest != "hello world" {
		t.Fatalf("split: ts=%q rest=%q", gotTs, rest)
	}
	// No parseable prefix → ts empty, whole line preserved.
	if gotTs, rest := splitTimestampPrefix("not-a-timestamp here"); gotTs != "" || rest != "not-a-timestamp here" {
		t.Fatalf("no-prefix split: ts=%q rest=%q", gotTs, rest)
	}
	if gotTs, rest := splitTimestampPrefix("singletoken"); gotTs != "" || rest != "singletoken" {
		t.Fatalf("no-space split: ts=%q rest=%q", gotTs, rest)
	}
}

func TestTextToProgressEvents(t *testing.T) {
	if got := textToProgressEvents("", 0, nil); len(got) != 0 {
		t.Fatalf("empty text → empty events, got %d", len(got))
	}
	text := "2026-05-07T14:30:00.000000000Z plain log line\n" +
		`{"schemaVersion":1,"kind":"phase","phase":"planning"}` + "\n"
	events := textToProgressEvents(text, 0, nil)
	if len(events) != 2 {
		t.Fatalf("expected 2 events, got %d", len(events))
	}
	// Line 1: no JSON → kind log, K8s ts prefix lifted onto Ts.
	if events[0].Kind != "log" || events[0].Summary != "plain log line" {
		t.Fatalf("plain line parse: %+v", events[0])
	}
	if events[0].Ts != "2026-05-07T14:30:00.000000000Z" {
		t.Fatalf("plain line must carry the k8s timestamp prefix, got %q", events[0].Ts)
	}
	// Line 2: JSON envelope decodes to a phase event.
	if events[1].Kind != "phase" || events[1].Phase != "planning" {
		t.Fatalf("envelope parse: %+v", events[1])
	}
}

func TestTextToProgressEvents_KeepsNewestOnOverflow(t *testing.T) {
	// limit truncation keeps the NEWEST N lines (live tail surfaces fresh output).
	var text string
	for i := 0; i < 5; i++ {
		text += "line" + string(rune('A'+i)) + "\n"
	}
	truncated := false
	events := textToProgressEvents(text, 3, &truncated)
	if !truncated || len(events) != 3 {
		t.Fatalf("expected truncation to newest 3, got truncated=%v len=%d", truncated, len(events))
	}
	if events[0].Summary != "lineC" || events[2].Summary != "lineE" {
		t.Fatalf("must keep the newest lines, got %q..%q", events[0].Summary, events[2].Summary)
	}
}

func TestFilterEventsAfter(t *testing.T) {
	ev := func(ts string) observer.ProgressEvent { return observer.ProgressEvent{Ts: ts, Kind: "log"} }
	events := []observer.ProgressEvent{
		ev("2026-05-07T14:30:00.000Z"), // == since → dropped (half-open)
		ev("2026-05-07T14:30:01.000Z"), // > since → kept
		ev(""),                         // unparseable → kept (no basis to drop)
	}
	since := time.Date(2026, 5, 7, 14, 30, 0, 0, time.UTC).UnixMilli()
	out := filterEventsAfter(events, since)
	if len(out) != 2 {
		t.Fatalf("expected 2 kept (>since + empty-ts), got %d", len(out))
	}
	// sinceMillis<=0 → everything passes.
	if len(filterEventsAfter(events, 0)) != 3 {
		t.Fatal("since<=0 must keep all events")
	}
}

func TestLastEventMillis(t *testing.T) {
	events := []observer.ProgressEvent{
		{Ts: "2026-05-07T14:30:00.000Z"},
		{Ts: "2026-05-07T14:30:05.000Z"}, // newest
		{Ts: ""},                         // ignored
	}
	want := time.Date(2026, 5, 7, 14, 30, 5, 0, time.UTC).UnixMilli()
	if got := lastEventMillis(events); got != want {
		t.Fatalf("lastEventMillis = %d; want %d", got, want)
	}
	if got := lastEventMillis([]observer.ProgressEvent{{Ts: ""}}); got != 0 {
		t.Fatalf("no parseable ts → 0, got %d", got)
	}
}
