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

package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// scopeEchoHandler answers the scope IssuesMCPGate bound, as JSON.
func scopeEchoHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		scope, ok := IssuesMCPScopeFromContext(r.Context())
		if !ok {
			http.Error(w, "no scope", http.StatusInternalServerError)
			return
		}
		_ = json.NewEncoder(w).Encode(scope)
	})
}

// serveIssues routes path through the gate the way the edge mounts it: the
// Issues surface and an issue's.
func serveIssues(v *StudioClientVerifier, path, header string) *httptest.ResponseRecorder {
	mux := http.NewServeMux()
	gate := IssuesMCPGate(v, scopeEchoHandler())
	mux.Handle("POST /ae-studio/projects/{projectName}/issues/mcp", gate)
	mux.Handle("POST /ae-studio/projects/{projectName}/issues/{issueNumber}/mcp", gate)
	req := httptest.NewRequest(http.MethodPost, path, nil)
	if header != "" {
		req.Header.Set("Authorization", header)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

// A recorded ae-studio client token binds the org it is recorded for; the
// project and the issue are the path's.
func TestIssuesMCPGate_BindsTheOrgAndThePathsScope(t *testing.T) {
	v, sign := newStudioVerifierStack(t, storedStudioClients{"acme": "ae-studio-acme"})
	tok := "Bearer " + sign("ae-studio-acme", "acme")

	var got IssuesMCPScope
	rec := serveIssues(v, "/ae-studio/projects/expenses/issues/mcp", tok)
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &got) != nil {
		t.Fatalf("Issues surface = %d %s", rec.Code, rec.Body)
	}
	if got != (IssuesMCPScope{OrgID: "acme", ProjectID: "expenses"}) {
		t.Fatalf("scope = %+v", got)
	}
	rec = serveIssues(v, "/ae-studio/projects/expenses/issues/7/mcp", tok)
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &got) != nil {
		t.Fatalf("issue surface = %d %s", rec.Code, rec.Body)
	}
	if got != (IssuesMCPScope{OrgID: "acme", ProjectID: "expenses", IssueNumber: 7}) {
		t.Fatalf("scope = %+v", got)
	}
}

// Every credential refusal is the same 401; an issue number that is not a
// positive integer names no surface (404).
func TestIssuesMCPGate_Refusals(t *testing.T) {
	v, sign := newStudioVerifierStack(t, storedStudioClients{"acme": "ae-studio-acme"})
	for name, c := range map[string]struct {
		path, header string
		want         int
	}{
		"no header":                {"/ae-studio/projects/p/issues/mcp", "", http.StatusUnauthorized},
		"not a bearer":             {"/ae-studio/projects/p/issues/mcp", "Basic x", http.StatusUnauthorized},
		"publisher audience":       {"/ae-studio/projects/p/issues/mcp", "Bearer " + sign("aep-publisher-acme", "acme"), http.StatusUnauthorized},
		"client not recorded":      {"/ae-studio/projects/p/issues/mcp", "Bearer " + sign("ae-studio-other", "other"), http.StatusUnauthorized},
		"issue number zero":        {"/ae-studio/projects/p/issues/0/mcp", "Bearer " + sign("ae-studio-acme", "acme"), http.StatusNotFound},
		"issue number not numeric": {"/ae-studio/projects/p/issues/x/mcp", "Bearer " + sign("ae-studio-acme", "acme"), http.StatusNotFound},
	} {
		if rec := serveIssues(v, c.path, c.header); rec.Code != c.want {
			t.Errorf("%s = %d, want %d", name, rec.Code, c.want)
		}
	}
}

// A recorded client that could not be read is no verdict on the caller: 503.
func TestIssuesMCPGate_LookupFailureIs503(t *testing.T) {
	v, sign := newStudioVerifierStack(t, storedStudioClients{"!err": "db down"})
	if rec := serveIssues(v, "/ae-studio/projects/p/issues/mcp", "Bearer "+sign("ae-studio-acme", "acme")); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("lookup failure = %d, want 503", rec.Code)
	}
}

// A nil verifier refuses every call.
func TestIssuesMCPGate_NilVerifierRefuses(t *testing.T) {
	if rec := serveIssues(nil, "/ae-studio/projects/p/issues/mcp", "Bearer x"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("nil verifier = %d, want 401", rec.Code)
	}
}
