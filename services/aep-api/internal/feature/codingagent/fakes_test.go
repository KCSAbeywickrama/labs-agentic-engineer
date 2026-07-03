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

// Shared test doubles for the codingagent feature. These fake the SEAMS the
// feature owns as ports (contracts.TaskTransitions, BuildOps, taskReader,
// observer.Client, DispatchService) plus a wire-level cluster-gateway-proxy
// backed by httptest. Out-of-process clients that already have moq mocks
// (openchoreo.ComponentClient) are used directly from clients/openchoreo/mocks
// in the tests, not re-faked here.
//
// The clustergatewayproxy.Client is a CONCRETE type (Config{BaseURL}) — there
// is no interface to moq — so it is faked at the wire via httptest and the real
// client points at the test server. That exercises the real request-building,
// path derivation, and 409/404 handling in client.go.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/wso2/aep/aep-api/internal/clients/clustergatewayproxy"
	"github.com/wso2/aep/aep-api/internal/clients/observer"
	"github.com/wso2/aep/aep-api/internal/contracts"
	"github.com/wso2/aep/aep-api/models"
)

// ---------------------------------------------------------------------------
// fakeProjector — contracts.TaskTransitions (the task projector's write seam).
// ---------------------------------------------------------------------------

type projectorCall struct {
	method  string // "MarkBuilding" | "ApplyBuildResult"
	taskID  string
	sha     string
	runName string
	event   contracts.TaskEvent
	errMsg  string
}

type fakeProjector struct {
	mu              sync.Mutex
	calls           []projectorCall
	markBuildingErr error
	applyErr        error
}

func (f *fakeProjector) MarkBuilding(_ context.Context, taskID, sha, runName string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, projectorCall{method: "MarkBuilding", taskID: taskID, sha: sha, runName: runName})
	return f.markBuildingErr
}

func (f *fakeProjector) ApplyBuildResult(_ context.Context, taskID string, event contracts.TaskEvent, errMsg string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, projectorCall{method: "ApplyBuildResult", taskID: taskID, event: event, errMsg: errMsg})
	return f.applyErr
}

// applyEventsFor returns the ordered ApplyBuildResult events recorded for taskID.
func (f *fakeProjector) applyEventsFor(taskID string) []contracts.TaskEvent {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []contracts.TaskEvent
	for _, c := range f.calls {
		if c.method == "ApplyBuildResult" && c.taskID == taskID {
			out = append(out, c.event)
		}
	}
	return out
}

func (f *fakeProjector) snapshot() []projectorCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]projectorCall(nil), f.calls...)
}

// ---------------------------------------------------------------------------
// fakeBuildOps — codingagent.BuildOps (the build watcher's auth-retry seam).
// ---------------------------------------------------------------------------

type fakeBuildOps struct {
	mu       sync.Mutex
	calls    []string // task IDs passed to RetryAuthFailedBuild
	runName  string
	err      error
	callback func(task *models.ComponentTask) // optional per-call hook
}

func (f *fakeBuildOps) RetryAuthFailedBuild(_ context.Context, task *models.ComponentTask) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, task.ID)
	if f.callback != nil {
		f.callback(task)
	}
	return f.runName, f.err
}

func (f *fakeBuildOps) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

// ---------------------------------------------------------------------------
// fakeTaskReader — the progress service's narrow task-lookup port.
// ---------------------------------------------------------------------------

type fakeTaskReader struct {
	byID map[string]*models.ComponentTask
	err  error
}

func (f *fakeTaskReader) GetTask(_ context.Context, taskID string) (*models.ComponentTask, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.byID[taskID], nil
}

// ---------------------------------------------------------------------------
// fakeObserver — observer.Client (out-of-process log store; no moq exists).
// ---------------------------------------------------------------------------

type fakeObserver struct {
	mu    sync.Mutex
	calls int
	lines []observer.LogLine
	err   error
}

func (f *fakeObserver) GetWorkflowRunLogs(_ context.Context, _, _ string, _ time.Time, _ int) ([]observer.LogLine, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return f.lines, nil
}

// ---------------------------------------------------------------------------
// fakeDispatchService — codingagent.DispatchService (the cascade's target).
// ---------------------------------------------------------------------------

type dispatchCall struct{ orgID, projectID string }

type fakeDispatchService struct {
	mu      sync.Mutex
	calls   []dispatchCall
	results []DispatchResult
	err     error
}

func (f *fakeDispatchService) DispatchTasks(_ context.Context, orgID, projectID string) ([]DispatchResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, dispatchCall{orgID: orgID, projectID: projectID})
	return f.results, f.err
}

func (f *fakeDispatchService) RetryTask(_ context.Context, _ string) (DispatchResult, error) {
	return DispatchResult{}, nil
}

func (f *fakeDispatchService) dispatchCalls() []dispatchCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]dispatchCall(nil), f.calls...)
}

// ---------------------------------------------------------------------------
// wire-level cluster-gateway-proxy fake
// ---------------------------------------------------------------------------

// newProxyClient stands up an httptest server serving the given handler and
// returns a real clustergatewayproxy.Client pointed at it. The client prepends
// "/cloud-dp-cgw" to every k8s path, so handlers match on that full prefix.
func newProxyClient(t testing.TB, h http.Handler) *clustergatewayproxy.Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return clustergatewayproxy.New(clustergatewayproxy.Config{BaseURL: srv.URL})
}

// captureProxy records every request (method, path, JSON body) in order and
// answers each 201 so the dispatcher's apply chain runs to completion. Requests
// are kept as a list — the ExternalSecret applies all POST to the SAME list
// path, so a last-write-wins map would lose the anthropic body under the github
// one.
type capturedReq struct {
	method string
	path   string // k8s path with the /cloud-dp-cgw prefix stripped
	body   []byte
}

type captureProxy struct {
	mu   sync.Mutex
	reqs []capturedReq
}

func newCaptureProxy() *captureProxy {
	return &captureProxy{}
}

func (c *captureProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	const prefix = "/cloud-dp-cgw"
	path := r.URL.Path
	if len(path) >= len(prefix) && path[:len(prefix)] == prefix {
		path = path[len(prefix):]
	}
	c.mu.Lock()
	c.reqs = append(c.reqs, capturedReq{method: r.Method, path: path, body: readAll(r)})
	c.mu.Unlock()
	// 201 Created is a clean success for every apply the dispatcher issues.
	w.WriteHeader(http.StatusCreated)
}

// bodiesFor returns every recorded body for a (method, path) pair, in order.
func (c *captureProxy) bodiesFor(method, path string) [][]byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out [][]byte
	for _, req := range c.reqs {
		if req.method == method && req.path == path {
			out = append(out, req.body)
		}
	}
	return out
}

// requestOrder returns the "<METHOD> <path>" of each request, in order.
func (c *captureProxy) requestOrder() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]string, 0, len(c.reqs))
	for _, req := range c.reqs {
		out = append(out, req.method+" "+req.path)
	}
	return out
}

func readAll(r *http.Request) []byte {
	if r.Body == nil {
		return nil
	}
	defer r.Body.Close()
	buf := make([]byte, 0, 1024)
	tmp := make([]byte, 1024)
	for {
		n, err := r.Body.Read(tmp)
		buf = append(buf, tmp[:n]...)
		if err != nil {
			break
		}
	}
	return buf
}

// ---------------------------------------------------------------------------
// DB seeding helpers (dbtest tier)
// ---------------------------------------------------------------------------

// seedTask inserts a ComponentTask with the supplied fields (ID/OrgID/etc.) and
// returns it. Callers set the fields load-bearing for the query under test; the
// rest default. Fatal on error so tests read cleanly.
func seedTask(t testing.TB, db *gorm.DB, task models.ComponentTask) models.ComponentTask {
	t.Helper()
	if task.ProjectID == "" {
		task.ProjectID = "demo"
	}
	if task.OrgID == "" {
		task.OrgID = "acme"
	}
	if task.ComponentName == "" {
		task.ComponentName = "api"
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatalf("seed task %s: %v", task.ID, err)
	}
	return task
}

// loadTask re-reads a task row by id for post-condition assertions.
func loadTask(t testing.TB, db *gorm.DB, id string) models.ComponentTask {
	t.Helper()
	var row models.ComponentTask
	if err := db.Where("id = ?", id).First(&row).Error; err != nil {
		t.Fatalf("load task %s: %v", id, err)
	}
	return row
}
