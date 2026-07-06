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

package gittest

// Stub is a route-registry httptest fake for the plain JSON GitHub endpoints —
// repo create/adopt, issues, webhook registration — where a git-backed fake
// would be over-engineering (git-object traffic no longer exists: repo content
// runs on the gitfs Workspace engine against a gittest.Remote origin). It is
// the reusable, exported form of the stubGitHub pattern proven in orgcreds'
// credential_service_test.go.
//
// Register a fixed status+body per "METHOD /path" with On(); an unregistered
// path 404s (so a caller's own not-found handling is exercised). Every request
// — registered or not — is recorded for assertion via Requests(). Routing is on
// r.URL.Path; query strings are ignored for matching but captured in the record.

import (
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// RecordedRequest is a captured inbound request. Body holds the raw request
// body bytes (already read); Header is a clone taken at receive time.
type RecordedRequest struct {
	Method string
	Path   string
	Query  string
	Body   string
	Header http.Header
}

// Stub wraps an httptest.Server. Embed exposes .URL and .Close.
type Stub struct {
	*httptest.Server
	mu       sync.Mutex
	routes   map[string]http.HandlerFunc
	requests []RecordedRequest
}

// NewStub starts a route-registry server and registers Close on t.Cleanup.
func NewStub(t *testing.T) *Stub {
	t.Helper()
	s := &Stub{routes: map[string]http.HandlerFunc{}}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		s.mu.Lock()
		s.requests = append(s.requests, RecordedRequest{
			Method: r.Method,
			Path:   r.URL.Path,
			Query:  r.URL.RawQuery,
			Body:   string(body),
			Header: r.Header.Clone(),
		})
		h := s.routes[r.Method+" "+r.URL.Path]
		s.mu.Unlock()
		if h == nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"message":"Not Found"}`)
			return
		}
		h(w, r)
	}))
	t.Cleanup(s.Close)
	return s
}

// On registers a fixed status+body for an exact method+path. A later On for the
// same route replaces the earlier one.
func (s *Stub) On(method, path string, status int, body string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.routes[method+" "+path] = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}
}

// Requests returns a copy of every request received so far, in arrival order.
func (s *Stub) Requests() []RecordedRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]RecordedRequest, len(s.requests))
	copy(out, s.requests)
	return out
}
