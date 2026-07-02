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

// DBTEST tier: JobWatcher — the proxy-path poller. It is the watcher that owns
// the run-name prefix filter (`ca-%%`) that keeps it off legacy dispatches
// (mixed-mode safety), so that filter is proven here over real Postgres. The
// cluster-gateway-proxy is CONCRETE, so it is wire-faked via httptest and driven
// through the real client; the fake records which Jobs were polled + which
// ExternalSecrets were deleted. NS resolution is stubbed via
// WithNamespaceResolver so the proxy interactions stay deterministic (the real
// Organization-table resolve path is exercised in progress_newpath_dbtest).

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"

	"gorm.io/gorm"

	"github.com/wso2/aep/aep-api/internal/clients/clustergatewayproxy"
	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
	"github.com/wso2/aep/aep-api/models"
)

const jobNS = "wc-test-remote-worker"

// jobProxyState is a wire-level cluster-gateway-proxy fake for the read+cleanup
// surface JobWatcher uses: GetJob, GetJobPodName, TailPodLog, DeleteExternalSecret.
type jobProxyState struct {
	mu sync.Mutex

	jobStatus  map[string]clustergatewayproxy.JobStatus // jobName → status
	jobMissing map[string]bool                          // jobName → answer GetJob 404
	podName    string
	logText    string

	jobGets   []string // recorded GetJob names
	esDeletes []string // recorded DeleteExternalSecret names
}

func newJobProxyState() *jobProxyState {
	return &jobProxyState{
		jobStatus:  map[string]clustergatewayproxy.JobStatus{},
		jobMissing: map[string]bool{},
		podName:    "runner-pod-xyz",
		logText:    "2026-05-07T14:30:00.000000000Z hello from the agent\n",
	}
}

func lastSegment(path string) string {
	p := strings.TrimRight(path, "/")
	if i := strings.LastIndexByte(p, '/'); i >= 0 {
		return p[i+1:]
	}
	return p
}

func (s *jobProxyState) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path // query excluded
	s.mu.Lock()
	defer s.mu.Unlock()

	switch {
	// Pod log: .../pods/{pod}/log
	case r.Method == http.MethodGet && strings.HasSuffix(path, "/log"):
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(s.logText))

	// Pod list: .../pods?labelSelector=...
	case r.Method == http.MethodGet && strings.HasSuffix(path, "/pods"):
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"items": []map[string]any{{"metadata": map[string]any{"name": s.podName}}},
		})

	// GetJob: .../jobs/{name}
	case r.Method == http.MethodGet && strings.Contains(path, "/jobs/"):
		name := lastSegment(path)
		s.jobGets = append(s.jobGets, name)
		if s.jobMissing[name] {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		st := s.jobStatus[name]
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{"status": st})

	// DeleteExternalSecret: DELETE .../externalsecrets/{name}
	case r.Method == http.MethodDelete && strings.Contains(path, "/externalsecrets/"):
		s.esDeletes = append(s.esDeletes, lastSegment(path))
		w.WriteHeader(http.StatusOK)

	default:
		w.WriteHeader(http.StatusOK)
	}
}

func (s *jobProxyState) polledJobs() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.jobGets...)
}

func (s *jobProxyState) deletedES() map[string]bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string]bool{}
	for _, n := range s.esDeletes {
		out[n] = true
	}
	return out
}

func newJobWatcher(t testing.TB, db *gorm.DB, state *jobProxyState) *JobWatcher {
	return NewJobWatcher(db, newProxyClient(t, state)).
		WithNamespaceResolver(func(context.Context, *models.ComponentTask) (string, bool) { return jobNS, true })
}

// TestJobWatcher_Tick_PrefixFilterSkipsLegacyAndTerminal proves the ca-%% filter
// AND the active-status filter: only in_progress rows whose run name starts with
// "ca-" are polled. Legacy "coding-agent-…" runs (owned by CodingAgentWatcher)
// and already-terminal rows are left alone — without the filter JobWatcher would
// 404 on their missing Jobs and falsely mark them failed.
func TestJobWatcher_Tick_PrefixFilterSkipsLegacyAndTerminal(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	seedTask(t, db, models.ComponentTask{ID: taskA, Status: string(models.TaskStatusInProgress), LastCodingAgentRunName: "ca-aaaa-01"})
	seedTask(t, db, models.ComponentTask{ID: taskB, Status: string(models.TaskStatusInProgress), LastCodingAgentRunName: "coding-agent-bbbb-99"})
	seedTask(t, db, models.ComponentTask{ID: taskC, Status: string(models.TaskStatusMerged), LastCodingAgentRunName: "ca-cccc-03"})

	state := newJobProxyState()
	// The one selected job is still active → no writes, just proving selection.
	state.jobStatus["ca-aaaa-01"] = clustergatewayproxy.JobStatus{Active: 1}
	w := newJobWatcher(t, db, state)

	w.tick(ctx)

	polled := state.polledJobs()
	if len(polled) != 1 || polled[0] != "ca-aaaa-01" {
		t.Fatalf("only the in_progress ca- job must be polled, got %v", polled)
	}
}

func TestJobWatcher_Tick_FailedJobMarksFailedCapturesAndCleansUp(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	run := "ca-aaaa-01"
	seedTask(t, db, models.ComponentTask{ID: taskA, Status: string(models.TaskStatusInProgress), LastCodingAgentRunName: run})

	state := newJobProxyState()
	state.jobStatus[run] = clustergatewayproxy.JobStatus{
		Failed:     1,
		Conditions: []clustergatewayproxy.JobStatusConditon{{Type: "Failed", Status: "True", Reason: "DeadlineExceeded"}},
	}
	w := newJobWatcher(t, db, state)

	w.tick(ctx)

	// Task marked failed with the condition-derived reason.
	row := loadTask(t, db, taskA)
	if row.Status != string(models.TaskStatusFailed) {
		t.Fatalf("status = %q; want failed", row.Status)
	}
	if row.ErrorMessage != "job_failed:DeadlineExceeded" {
		t.Fatalf("error_message = %q; want job_failed:DeadlineExceeded", row.ErrorMessage)
	}
	// Final log captured into the sidecar table.
	var log models.CodingAgentLog
	if err := db.Where("task_id = ? AND run_name = ?", taskA, run).First(&log).Error; err != nil {
		t.Fatalf("captured log row must exist: %v", err)
	}
	if log.FinalPhase != "Failed" || !strings.Contains(log.LogText, "hello from the agent") {
		t.Fatalf("captured log: phase=%q text=%q", log.FinalPhase, log.LogText)
	}
	// Per-run ExternalSecrets cleaned up (anthropic + github + publisher).
	deleted := state.deletedES()
	for _, want := range []string{run + "-anthropic-es", run + "-github-es", run + "-publisher-es"} {
		if !deleted[want] {
			t.Fatalf("ExternalSecret %q must be cleaned up, deleted=%v", want, deleted)
		}
	}
}

func TestJobWatcher_Tick_JobNotFoundMarksFailed(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	run := "ca-aaaa-01"
	seedTask(t, db, models.ComponentTask{ID: taskA, Status: string(models.TaskStatusInProgress), LastCodingAgentRunName: run})

	state := newJobProxyState()
	state.jobMissing[run] = true // proxy 404 on GetJob
	w := newJobWatcher(t, db, state)

	w.tick(ctx)

	row := loadTask(t, db, taskA)
	if row.Status != string(models.TaskStatusFailed) || row.ErrorMessage != "job_not_found_in_namespace" {
		t.Fatalf("vanished Job must fail the task with job_not_found_in_namespace, got status=%q msg=%q", row.Status, row.ErrorMessage)
	}
	// No log is captured when the Job (and thus the pod) is gone.
	var n int64
	db.Model(&models.CodingAgentLog{}).Where("task_id = ?", taskA).Count(&n)
	if n != 0 {
		t.Fatalf("no sidecar log expected for a vanished Job, got %d", n)
	}
}

func TestJobWatcher_Tick_SucceededDoesNotTransitionButCaptures(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	run := "ca-aaaa-01"
	seedTask(t, db, models.ComponentTask{ID: taskA, Status: string(models.TaskStatusInProgress), LastCodingAgentRunName: run})

	state := newJobProxyState()
	state.jobStatus[run] = clustergatewayproxy.JobStatus{Succeeded: 1}
	w := newJobWatcher(t, db, state)

	w.tick(ctx)

	// Success is webhook-owned — the watcher must NOT move the task forward.
	row := loadTask(t, db, taskA)
	if row.Status != string(models.TaskStatusInProgress) {
		t.Fatalf("succeeded Job must leave the task in_progress (webhook advances it), got %q", row.Status)
	}
	// But it still captures the final log + cleans up secrets.
	var log models.CodingAgentLog
	if err := db.Where("task_id = ? AND run_name = ?", taskA, run).First(&log).Error; err != nil {
		t.Fatalf("captured log row must exist on success too: %v", err)
	}
	if log.FinalPhase != "Succeeded" {
		t.Fatalf("captured phase = %q; want Succeeded", log.FinalPhase)
	}
	if !state.deletedES()[run+"-anthropic-es"] {
		t.Fatal("ExternalSecrets must be cleaned up on success")
	}
}
