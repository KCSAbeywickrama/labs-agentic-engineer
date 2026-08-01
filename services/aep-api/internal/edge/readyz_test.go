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

package edge

import (
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/wso2/aep/aep-api/internal/config"
)

type staticReady struct{ ready atomic.Bool }

func (s *staticReady) Ready() bool { return s.ready.Load() }
func (s *staticReady) Set(v bool)  { s.ready.Store(v) }

func TestReadyz_ReflectsWorkspaceGate(t *testing.T) {
	gate := &staticReady{}
	gate.Set(true)
	handler := NewHandler(AppParams{
		Config:         config.Config{TestMode: false},
		WorkspaceReady: gate,
	})
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	assertStatus := func(path string, want int) {
		t.Helper()
		resp, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		defer resp.Body.Close()
		_, _ = io.Copy(io.Discard, resp.Body)
		if resp.StatusCode != want {
			t.Fatalf("GET %s status = %d, want %d", path, resp.StatusCode, want)
		}
	}

	assertStatus("/readyz", http.StatusOK)
	assertStatus("/healthz", http.StatusOK)

	gate.Set(false)
	assertStatus("/readyz", http.StatusServiceUnavailable)
	assertStatus("/healthz", http.StatusOK) // liveness stays up
}

func TestReadyz_NilGateAlwaysOK(t *testing.T) {
	handler := NewHandler(AppParams{Config: config.Config{TestMode: false}})
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	resp, err := http.Get(srv.URL + "/readyz")
	if err != nil {
		t.Fatalf("GET /readyz: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
}
