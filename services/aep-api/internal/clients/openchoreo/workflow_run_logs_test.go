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

package openchoreo

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// OpenChoreo concatenates the log pod by pod in pod-name order, so the
// generate-workload step's lines can arrive before the clone's. The reader
// hands them back in the order they were written.
func TestGetWorkflowRunLogs_OrdersLinesByTime(t *testing.T) {
	var gotPath, gotSince string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotSince = r.URL.Path, r.URL.Query().Get("sinceSeconds")
		writeJSON(t, w, http.StatusOK, []map[string]any{
			{"timestamp": "2026-10-12T16:50:20.775599808Z", "log": "workload generated"},
			{"timestamp": "2026-10-12T16:47:20.835000001Z", "log": ">> Repository: https://github.com/ae-demo/notes.git"},
			{"timestamp": "2026-10-12T16:47:20.835000002Z", "log": ">> Branch: main"},
		})
	}))
	defer srv.Close()

	got, err := NewComponentClient(Config{BaseURL: srv.URL}).GetWorkflowRunLogs(context.Background(), "acme", "notes-api-abc-1", 30)
	if err != nil {
		t.Fatalf("GetWorkflowRunLogs: %v", err)
	}
	if gotPath != "/api/v1/namespaces/acme/workflowruns/notes-api-abc-1/logs" || gotSince != "30" {
		t.Fatalf("request = %s ?sinceSeconds=%s", gotPath, gotSince)
	}
	want := []string{">> Repository: https://github.com/ae-demo/notes.git", ">> Branch: main", "workload generated"}
	if len(got) != len(want) {
		t.Fatalf("got %d lines, want %d", len(got), len(want))
	}
	for i, w := range want {
		if got[i].Log != w {
			t.Errorf("line %d = %q, want %q", i, got[i].Log, w)
		}
	}
	if got[0].Timestamp.Nanosecond() != 835000001 {
		t.Errorf("timestamp lost its precision: %s", got[0].Timestamp.Format(time.RFC3339Nano))
	}
}

// An empty line the container wrote reaches OpenChoreo as a bare timestamp,
// which it returns untimed with the timestamp as the text (seen live on a
// dockerfile-builder run). Untimed, a tail could never place it; read back as
// an empty line at its time, the tail and a whole read agree.
func TestGetWorkflowRunLogs_ABareTimestampIsAnEmptyLine(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, http.StatusOK, []map[string]any{
			{"timestamp": "2026-10-19T15:21:26.000000001Z", "log": "#7 DONE"},
			{"log": "2026-10-19T15:21:26.944321579Z"},
			{"log": "no timestamp at all"},
		})
	}))
	defer srv.Close()

	got, err := NewComponentClient(Config{BaseURL: srv.URL}).GetWorkflowRunLogs(context.Background(), "acme", "run-1", 0)
	if err != nil {
		t.Fatalf("GetWorkflowRunLogs: %v", err)
	}
	var blank *WorkflowRunLogLine
	for i := range got {
		if got[i].Log == "" {
			blank = &got[i]
		}
	}
	if blank == nil || blank.Timestamp.Format(time.RFC3339Nano) != "2026-10-19T15:21:26.944321579Z" {
		t.Fatalf("bare timestamp not read as an empty line at its time: %+v", got)
	}
	if got[0].Log != "no timestamp at all" || !got[0].Timestamp.IsZero() {
		t.Errorf("a truly untimed line must stay untimed: %+v", got[0])
	}
}

// A run past its TTL is gone from OpenChoreo; the caller tells that apart from
// a failure by the sentinel.
func TestGetWorkflowRunLogs_MissingRunIsNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, http.StatusNotFound, map[string]any{"error": "WorkflowRun not found", "code": "NOT_FOUND"})
	}))
	defer srv.Close()

	_, err := NewComponentClient(Config{BaseURL: srv.URL}).GetWorkflowRunLogs(context.Background(), "acme", "gone-1", 0)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestClusterWorkflowTTL_ReadsOpenChoreosDurationGrammar(t *testing.T) {
	ttl := "1d"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/clusterworkflows/"+BuilderClusterWorkflow {
			t.Fatalf("unexpected request: %s", r.URL.Path)
		}
		spec := map[string]any{"runTemplate": map[string]any{}}
		if ttl != "" {
			spec["ttlAfterCompletion"] = ttl
		}
		writeJSON(t, w, http.StatusOK, map[string]any{"metadata": map[string]any{"name": BuilderClusterWorkflow}, "spec": spec})
	}))
	defer srv.Close()
	c := NewComponentClient(Config{BaseURL: srv.URL})

	for _, tc := range []struct {
		ttl  string
		want time.Duration
	}{
		{"1d", 24 * time.Hour},
		{"10d1h30m", 241*time.Hour + 30*time.Minute},
		{"90m", 90 * time.Minute},
		{"", 0},
	} {
		ttl = tc.ttl
		got, err := c.ClusterWorkflowTTL(context.Background(), BuilderClusterWorkflow)
		if err != nil || got != tc.want {
			t.Errorf("ttl %q: got %v, %v; want %v", tc.ttl, got, err, tc.want)
		}
	}
}
