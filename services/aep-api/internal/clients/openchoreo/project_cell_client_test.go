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
)

// A live pipeline 404 must classify as ErrNotFound: the write-target resolver
// treats it as a configuration fact, not a transient failure to retry.
func TestProjectCellClientGetPipeline_ClassifiesNotFound(t *testing.T) {
	cases := []struct {
		name     string
		status   int
		wantMiss bool
	}{
		{"404 is ErrNotFound", http.StatusNotFound, true},
		{"503 stays transient", http.StatusServiceUnavailable, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, `{"error":"nope"}`, tc.status)
			}))
			defer srv.Close()
			c := &projectCellClient{baseURL: srv.URL, http: srv.Client()}
			_, err := c.getPipeline(context.Background(), "acme", "gone")
			if err == nil {
				t.Fatal("expected an error")
			}
			if got := errors.Is(err, ErrNotFound); got != tc.wantMiss {
				t.Fatalf("errors.Is(ErrNotFound) = %v, want %v (err: %v)", got, tc.wantMiss, err)
			}
		})
	}
}

// A served pipeline must decode into promotion paths and resolve to its root.
// This is the only test that drives getPipeline over a real 200 body.
func TestProjectCellClientGetPipeline_DecodesPromotionPaths(t *testing.T) {
	path := func(src string, targets ...string) map[string]any {
		refs := []map[string]any{}
		for _, n := range targets {
			refs = append(refs, map[string]any{"name": n})
		}
		return map[string]any{
			"sourceEnvironmentRef":  map[string]any{"name": src},
			"targetEnvironmentRefs": refs,
		}
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if want := nsBase("acme") + "/deploymentpipelines/linear"; r.URL.Path != want {
			t.Errorf("path %q, want %q", r.URL.Path, want)
			http.Error(w, "bad path", http.StatusNotFound)
			return
		}
		writeJSON(t, w, http.StatusOK, map[string]any{
			"metadata": map[string]any{"name": "linear"},
			"spec": map[string]any{"promotionPaths": []any{
				path("development", "staging"),
				path("staging", "production"),
			}},
		})
	}))
	defer srv.Close()

	c := &projectCellClient{baseURL: srv.URL, http: srv.Client()}
	p, err := c.getPipeline(context.Background(), "acme", "linear")
	if err != nil {
		t.Fatalf("getPipeline: %v", err)
	}
	got, err := PipelineRoot("linear", p)
	if err != nil || got != "development" {
		t.Fatalf("PipelineRoot = %q, err=%v, want development", got, err)
	}
}
