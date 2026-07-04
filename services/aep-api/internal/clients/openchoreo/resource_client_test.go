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
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// newTestResourceClient builds a resourceClient pointed at srv with no auth
// configured (Config zero value beyond BaseURL) — the fake OC server below
// doesn't assert on auth headers, only on method/path/body.
func newTestResourceClient(t *testing.T, srv *httptest.Server) ResourceClient {
	t.Helper()
	return NewResourceClient(Config{BaseURL: srv.URL})
}

func writeJSON(t *testing.T, w http.ResponseWriter, status int, v any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		t.Fatalf("encode fake response: %v", err)
	}
}

// ---- EnsureResourceType -----------------------------------------------------

func TestEnsureResourceType_Create(t *testing.T) {
	var gotPath, gotMethod string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotMethod = r.URL.Path, r.Method
		var rt ResourceType
		_ = json.NewDecoder(r.Body).Decode(&rt)
		if rt.APIVersion != ocResourceAPIVersion || rt.Kind != kindResourceType {
			t.Errorf("unexpected apiVersion/kind: %s/%s", rt.APIVersion, rt.Kind)
		}
		rt.Metadata.Name = "conn-postgres-v1"
		writeJSON(t, w, http.StatusCreated, rt)
	}))
	defer srv.Close()

	c := newTestResourceClient(t, srv)
	in := &ResourceType{Metadata: OCObjectMeta{Name: "conn-postgres-v1"}}
	got, err := c.EnsureResourceType(context.Background(), "wc-abc", in)
	if err != nil {
		t.Fatalf("EnsureResourceType: %v", err)
	}
	if gotMethod != http.MethodPost || gotPath != "/api/v1/namespaces/wc-abc/resourcetypes" {
		t.Errorf("unexpected request: %s %s", gotMethod, gotPath)
	}
	if got.Metadata.Name != "conn-postgres-v1" {
		t.Errorf("unexpected result: %+v", got)
	}
}

func TestEnsureResourceType_ConflictRefetchesExisting(t *testing.T) {
	var posts, gets int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			atomic.AddInt32(&posts, 1)
			writeJSON(t, w, http.StatusConflict, map[string]string{"error": "already exists"})
		case http.MethodGet:
			atomic.AddInt32(&gets, 1)
			writeJSON(t, w, http.StatusOK, ResourceType{Metadata: OCObjectMeta{Name: "conn-postgres-v1"}})
		default:
			t.Fatalf("unexpected method %s", r.Method)
		}
	}))
	defer srv.Close()

	c := newTestResourceClient(t, srv)
	in := &ResourceType{Metadata: OCObjectMeta{Name: "conn-postgres-v1"}}
	got, err := c.EnsureResourceType(context.Background(), "wc-abc", in)
	if err != nil {
		t.Fatalf("EnsureResourceType: %v", err)
	}
	if got.Metadata.Name != "conn-postgres-v1" {
		t.Errorf("unexpected result: %+v", got)
	}
	if posts != 1 || gets != 1 {
		t.Errorf("expected 1 POST + 1 GET, got posts=%d gets=%d", posts, gets)
	}
}

func TestEnsureResourceType_ServerErrorWrapsSentinel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusInternalServerError, map[string]string{"error": "boom"})
	}))
	defer srv.Close()

	c := newTestResourceClient(t, srv)
	_, err := c.EnsureResourceType(context.Background(), "wc-abc", &ResourceType{Metadata: OCObjectMeta{Name: "x"}})
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, ErrInternalServerError) {
		t.Errorf("expected ErrInternalServerError, got %v", err)
	}
}

// ---- ApplyResource -----------------------------------------------------------

func TestApplyResource_Create(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/namespaces/wc-abc/resources" || r.Method != http.MethodPost {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		var res Resource
		_ = json.NewDecoder(r.Body).Decode(&res)
		writeJSON(t, w, http.StatusCreated, res)
	}))
	defer srv.Close()

	c := newTestResourceClient(t, srv)
	in := &Resource{Metadata: OCObjectMeta{Name: "proj-conn1"}}
	got, err := c.ApplyResource(context.Background(), "wc-abc", in)
	if err != nil {
		t.Fatalf("ApplyResource: %v", err)
	}
	if got.Metadata.Name != "proj-conn1" || got.APIVersion != ocResourceAPIVersion || got.Kind != kindResource {
		t.Errorf("unexpected result: %+v", got)
	}
}

func TestApplyResource_ConflictReturnsExisting(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			writeJSON(t, w, http.StatusConflict, map[string]string{"error": "already exists"})
		case http.MethodGet:
			if r.URL.Path != "/api/v1/namespaces/wc-abc/resources/proj-conn1" {
				t.Fatalf("unexpected GET path: %s", r.URL.Path)
			}
			writeJSON(t, w, http.StatusOK, Resource{
				Metadata: OCObjectMeta{Name: "proj-conn1"},
				Status:   &ResourceStatus{LatestRelease: &ResourceLatestRelease{Name: "proj-conn1-rel1"}},
			})
		default:
			t.Fatalf("unexpected method %s", r.Method)
		}
	}))
	defer srv.Close()

	c := newTestResourceClient(t, srv)
	got, err := c.ApplyResource(context.Background(), "wc-abc", &Resource{Metadata: OCObjectMeta{Name: "proj-conn1"}})
	if err != nil {
		t.Fatalf("ApplyResource: %v", err)
	}
	if got.Status == nil || got.Status.LatestRelease == nil || got.Status.LatestRelease.Name != "proj-conn1-rel1" {
		t.Errorf("expected existing resource with latestRelease, got %+v", got)
	}
}

// ---- GetResource --------------------------------------------------------------

func TestGetResource_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/namespaces/wc-abc/resources/proj-conn1" || r.Method != http.MethodGet {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		writeJSON(t, w, http.StatusOK, Resource{
			Metadata: OCObjectMeta{Name: "proj-conn1"},
			Status:   &ResourceStatus{LatestRelease: &ResourceLatestRelease{Name: "rel-1"}},
		})
	}))
	defer srv.Close()

	c := newTestResourceClient(t, srv)
	got, err := c.GetResource(context.Background(), "wc-abc", "proj-conn1")
	if err != nil {
		t.Fatalf("GetResource: %v", err)
	}
	if got.Status.LatestRelease.Name != "rel-1" {
		t.Errorf("unexpected result: %+v", got)
	}
}

func TestGetResource_NotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusNotFound, map[string]string{"error": "not found"})
	}))
	defer srv.Close()

	c := newTestResourceClient(t, srv)
	_, err := c.GetResource(context.Background(), "wc-abc", "missing")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

// ---- EnsureBinding -------------------------------------------------------------

func TestEnsureBinding_Create(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/namespaces/wc-abc/resourcereleasebindings" || r.Method != http.MethodPost {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		var b ResourceReleaseBinding
		_ = json.NewDecoder(r.Body).Decode(&b)
		writeJSON(t, w, http.StatusCreated, b)
	}))
	defer srv.Close()

	c := newTestResourceClient(t, srv)
	in := &ResourceReleaseBinding{
		Metadata: OCObjectMeta{Name: "proj-conn1-dev"},
		Spec:     ResourceReleaseBindingSpec{Environment: "dev", ResourceRelease: "rel-1"},
	}
	got, err := c.EnsureBinding(context.Background(), "wc-abc", in)
	if err != nil {
		t.Fatalf("EnsureBinding: %v", err)
	}
	if got.Metadata.Name != "proj-conn1-dev" || got.APIVersion != ocResourceAPIVersion || got.Kind != kindResourceReleaseBind {
		t.Errorf("unexpected result: %+v", got)
	}
}

func TestEnsureBinding_ConflictPutsReconciledPin(t *testing.T) {
	var lastPutBody ResourceReleaseBinding
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			writeJSON(t, w, http.StatusConflict, map[string]string{"error": "exists"})
		case http.MethodPut:
			if r.URL.Path != "/api/v1/namespaces/wc-abc/resourcereleasebindings/proj-conn1-dev" {
				t.Fatalf("unexpected PUT path: %s", r.URL.Path)
			}
			_ = json.NewDecoder(r.Body).Decode(&lastPutBody)
			writeJSON(t, w, http.StatusOK, lastPutBody)
		default:
			t.Fatalf("unexpected method %s", r.Method)
		}
	}))
	defer srv.Close()

	c := newTestResourceClient(t, srv)
	in := &ResourceReleaseBinding{
		Metadata: OCObjectMeta{Name: "proj-conn1-dev"},
		Spec:     ResourceReleaseBindingSpec{Environment: "dev", ResourceRelease: "rel-2"},
	}
	got, err := c.EnsureBinding(context.Background(), "wc-abc", in)
	if err != nil {
		t.Fatalf("EnsureBinding: %v", err)
	}
	if got.Spec.ResourceRelease != "rel-2" {
		t.Errorf("expected PUT to reconcile the pin to rel-2, got %+v", got.Spec)
	}
}

// ---- GetBinding -----------------------------------------------------------------

func TestGetBinding_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusOK, ResourceReleaseBinding{
			Metadata: OCObjectMeta{Name: "proj-conn1-dev"},
			Status:   &ResourceReleaseBindingStatus{Conditions: []OCCondition{{Type: "Ready", Status: "True"}}},
		})
	}))
	defer srv.Close()

	c := newTestResourceClient(t, srv)
	got, err := c.GetBinding(context.Background(), "wc-abc", "proj-conn1-dev")
	if err != nil {
		t.Fatalf("GetBinding: %v", err)
	}
	if !got.IsReady() {
		t.Errorf("expected binding to be ready, got %+v", got.Status)
	}
}

func TestGetBinding_NotFoundReturnsNilNil(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusNotFound, map[string]string{"error": "not found"})
	}))
	defer srv.Close()

	c := newTestResourceClient(t, srv)
	got, err := c.GetBinding(context.Background(), "wc-abc", "missing")
	if err != nil {
		t.Fatalf("expected nil error on 404, got %v", err)
	}
	if got != nil {
		t.Errorf("expected nil binding on 404, got %+v", got)
	}
}

func TestGetBinding_ServerErrorPropagates(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusInternalServerError, map[string]string{"error": "boom"})
	}))
	defer srv.Close()

	c := newTestResourceClient(t, srv)
	_, err := c.GetBinding(context.Background(), "wc-abc", "x")
	if !errors.Is(err, ErrInternalServerError) {
		t.Fatalf("expected ErrInternalServerError, got %v", err)
	}
}

// ---- DeleteBinding / DeleteResource (404-tolerant) -----------------------------

func TestDeleteBinding_SuccessAnd404Tolerant(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusNotFound} {
		status := status
		t.Run(fmt.Sprintf("status-%d", status), func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodDelete || r.URL.Path != "/api/v1/namespaces/wc-abc/resourcereleasebindings/proj-conn1-dev" {
					t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
				}
				writeJSON(t, w, status, nil)
			}))
			defer srv.Close()

			c := newTestResourceClient(t, srv)
			if err := c.DeleteBinding(context.Background(), "wc-abc", "proj-conn1-dev"); err != nil {
				t.Fatalf("DeleteBinding: %v", err)
			}
		})
	}
}

func TestDeleteBinding_ServerErrorPropagates(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusInternalServerError, map[string]string{"error": "boom"})
	}))
	defer srv.Close()

	c := newTestResourceClient(t, srv)
	err := c.DeleteBinding(context.Background(), "wc-abc", "x")
	if !errors.Is(err, ErrInternalServerError) {
		t.Fatalf("expected ErrInternalServerError, got %v", err)
	}
}

func TestDeleteResource_SuccessAnd404Tolerant(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusNotFound} {
		status := status
		t.Run(fmt.Sprintf("status-%d", status), func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodDelete || r.URL.Path != "/api/v1/namespaces/wc-abc/resources/proj-conn1" {
					t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
				}
				writeJSON(t, w, status, nil)
			}))
			defer srv.Close()

			c := newTestResourceClient(t, srv)
			if err := c.DeleteResource(context.Background(), "wc-abc", "proj-conn1"); err != nil {
				t.Fatalf("DeleteResource: %v", err)
			}
		})
	}
}

// ---- ListClusterResourceTypes ----------------------------------------------------

func TestListClusterResourceTypes_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/clusterresourcetypes" || r.Method != http.MethodGet {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		writeJSON(t, w, http.StatusOK, resourceTypeList{Items: []ResourceType{
			{Metadata: OCObjectMeta{Name: "postgres-cluster-rt"}},
			{Metadata: OCObjectMeta{Name: "redis-cluster-rt"}},
		}})
	}))
	defer srv.Close()

	c := newTestResourceClient(t, srv)
	got, err := c.ListClusterResourceTypes(context.Background())
	if err != nil {
		t.Fatalf("ListClusterResourceTypes: %v", err)
	}
	if len(got) != 2 || got[0].Metadata.Name != "postgres-cluster-rt" {
		t.Errorf("unexpected result: %+v", got)
	}
}

// ---- ListWorkloadEndpoints --------------------------------------------------------

func TestListWorkloadEndpoints_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/namespaces/wc-abc/workloads" || r.Method != http.MethodGet {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		fmt.Fprint(w, `{"items":[
			{
				"metadata":{"name":"wl-orders"},
				"spec":{
					"owner":{"projectName":"orders","componentName":"orders-api"},
					"endpoints":{
						"http":{"type":"HTTP","port":8080,"basePath":"/","visibility":["namespace"]},
						"admin":{"type":"HTTP","port":9090,"basePath":"/admin","visibility":[]}
					}
				}
			}
		]}`)
	}))
	defer srv.Close()

	c := newTestResourceClient(t, srv)
	got, err := c.ListWorkloadEndpoints(context.Background(), "wc-abc")
	if err != nil {
		t.Fatalf("ListWorkloadEndpoints: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 endpoints, got %d: %+v", len(got), got)
	}
	byName := map[string]WorkloadEndpointInfo{}
	for _, e := range got {
		byName[e.Name] = e
	}
	httpEP, ok := byName["http"]
	if !ok {
		t.Fatalf("missing http endpoint in %+v", got)
	}
	if httpEP.Project != "orders" || httpEP.Component != "orders-api" || httpEP.Port != 8080 || !httpEP.NamespaceVisible() {
		t.Errorf("unexpected http endpoint: %+v", httpEP)
	}
	adminEP, ok := byName["admin"]
	if !ok {
		t.Fatalf("missing admin endpoint in %+v", got)
	}
	if adminEP.NamespaceVisible() {
		t.Errorf("admin endpoint should not be namespace-visible: %+v", adminEP)
	}
}

func TestListWorkloadEndpoints_EmptyList(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusOK, workloadList{Items: nil})
	}))
	defer srv.Close()

	c := newTestResourceClient(t, srv)
	got, err := c.ListWorkloadEndpoints(context.Background(), "wc-abc")
	if err != nil {
		t.Fatalf("ListWorkloadEndpoints: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected empty slice, got %+v", got)
	}
}

// ---- WaitForLatestRelease ---------------------------------------------------------

func TestWaitForLatestRelease_ImmediateHit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusOK, Resource{
			Metadata: OCObjectMeta{Name: "proj-conn1"},
			Status:   &ResourceStatus{LatestRelease: &ResourceLatestRelease{Name: "rel-1"}},
		})
	}))
	defer srv.Close()

	c := newTestResourceClient(t, srv)
	got, err := WaitForLatestRelease(context.Background(), c, "wc-abc", "proj-conn1", 10*time.Millisecond, time.Second)
	if err != nil {
		t.Fatalf("WaitForLatestRelease: %v", err)
	}
	if got != "rel-1" {
		t.Errorf("expected rel-1, got %q", got)
	}
}

func TestWaitForLatestRelease_PollThenHit(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		if n < 3 {
			writeJSON(t, w, http.StatusOK, Resource{Metadata: OCObjectMeta{Name: "proj-conn1"}})
			return
		}
		writeJSON(t, w, http.StatusOK, Resource{
			Metadata: OCObjectMeta{Name: "proj-conn1"},
			Status:   &ResourceStatus{LatestRelease: &ResourceLatestRelease{Name: "rel-9"}},
		})
	}))
	defer srv.Close()

	c := newTestResourceClient(t, srv)
	got, err := WaitForLatestRelease(context.Background(), c, "wc-abc", "proj-conn1", 5*time.Millisecond, time.Second)
	if err != nil {
		t.Fatalf("WaitForLatestRelease: %v", err)
	}
	if got != "rel-9" {
		t.Errorf("expected rel-9, got %q", got)
	}
	if calls < 3 {
		t.Errorf("expected at least 3 polls, got %d", calls)
	}
}

func TestWaitForLatestRelease_Timeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusOK, Resource{Metadata: OCObjectMeta{Name: "proj-conn1"}})
	}))
	defer srv.Close()

	c := newTestResourceClient(t, srv)
	_, err := WaitForLatestRelease(context.Background(), c, "wc-abc", "proj-conn1", 5*time.Millisecond, 20*time.Millisecond)
	if err == nil {
		t.Fatal("expected timeout error")
	}
}

// TestWaitForLatestRelease_ContextCanceled exercises the loop's
// `case <-ctx.Done()` branch specifically: the first poll succeeds (no
// latestRelease yet), then the context is canceled well before the poll
// interval elapses, so the wait must return promptly with ctx.Err() rather
// than blocking until the (much longer) timeout.
func TestWaitForLatestRelease_ContextCanceled(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusOK, Resource{Metadata: OCObjectMeta{Name: "proj-conn1"}})
	}))
	defer srv.Close()

	c := newTestResourceClient(t, srv)
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(15*time.Millisecond, cancel)

	start := time.Now()
	_, err := WaitForLatestRelease(ctx, c, "wc-abc", "proj-conn1", 200*time.Millisecond, time.Minute)
	elapsed := time.Since(start)

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
	if elapsed > 150*time.Millisecond {
		t.Errorf("expected prompt return on ctx cancellation, took %s", elapsed)
	}
}

func TestWaitForLatestRelease_GetResourceErrorPropagates(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusInternalServerError, map[string]string{"error": "boom"})
	}))
	defer srv.Close()

	c := newTestResourceClient(t, srv)
	_, err := WaitForLatestRelease(context.Background(), c, "wc-abc", "proj-conn1", 5*time.Millisecond, 50*time.Millisecond)
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, ErrInternalServerError) {
		t.Errorf("expected ErrInternalServerError, got %v", err)
	}
}

// ---- constructor -------------------------------------------------------------------

func TestNewResourceClient_PanicsWithoutBaseURL(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic when BaseURL is empty")
		}
	}()
	NewResourceClient(Config{})
}
