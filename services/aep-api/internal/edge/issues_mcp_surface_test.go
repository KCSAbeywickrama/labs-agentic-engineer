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
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/wso2/aep/aep-api/internal/platform/auth"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol/issues"
)

// scopedIssues answers GetIssue with the scope the gate bound, so a test can
// read which org, project and issue a call reached.
type scopedIssues struct {
	sourcecontrol.IssueService
	got *auth.IssuesMCPScope
}

func (s scopedIssues) GetIssue(ctx context.Context, org, project string, n int) (*sourcecontrol.IssueInfo, error) {
	*s.got = auth.IssuesMCPScope{OrgID: org, ProjectID: project, IssueNumber: n}
	return &sourcecontrol.IssueInfo{Number: n, State: "open"}, nil
}

func (s scopedIssues) ListIssueComments(context.Context, string, string, int, int) ([]sourcecontrol.IssueComment, error) {
	return nil, nil
}

// The Issues and issue chats' tools are mounted under ae-studio/ behind the
// pod's credential: a recorded ae-studio-<org> token opens them, with the org
// it is recorded for and the project and issue of the path; a publisher token
// does not.
func TestIssuesMCPSurface_MountedBehindThePodsCredential(t *testing.T) {
	stack := newInternalStack(t)
	var got auth.IssuesMCPScope
	deps := stack.deps
	deps.IssuesMCP = issues.NewUserMCPHandler(scopedIssues{got: &got}, issues.IssueAgentPorts{})
	srv := httptest.NewServer(NewHandler(AppParams{InternalDeps: deps}))
	t.Cleanup(srv.Close)

	post := func(path, bearer, body string) (int, string) {
		t.Helper()
		req, _ := http.NewRequest(http.MethodPost, srv.URL+path, bytes.NewReader([]byte(body)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+bearer)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("POST %s: %v", path, err)
		}
		defer resp.Body.Close()
		var out bytes.Buffer
		_, _ = out.ReadFrom(resp.Body)
		return resp.StatusCode, out.String()
	}
	const list = `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`
	studio := stack.mintStudio("org-acme")

	status, body := post("/internal/v1/ae-studio/projects/expenses/issues/mcp", studio, list)
	if status != http.StatusOK || !json.Valid([]byte(body)) || !bytes.Contains([]byte(body), []byte("create_issue")) {
		t.Fatalf("Issues surface = %d %s", status, body)
	}
	status, body = post("/internal/v1/ae-studio/projects/expenses/issues/7/mcp", studio,
		`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_issue"}}`)
	if status != http.StatusOK {
		t.Fatalf("issue surface = %d %s", status, body)
	}
	if want := (auth.IssuesMCPScope{OrgID: "org-acme", ProjectID: "expenses", IssueNumber: 7}); got != want {
		t.Fatalf("scope = %+v, want %+v", got, want)
	}
	if status, _ := post("/internal/v1/ae-studio/projects/expenses/issues/mcp", stack.mint("org-acme"), list); status != http.StatusUnauthorized {
		t.Fatalf("publisher token on the Issues surface = %d, want 401", status)
	}
	if status, _ := post("/internal/v1/ae-studio/projects/expenses/issues/0/mcp", studio, list); status != http.StatusNotFound {
		t.Fatalf("issue 0 = %d, want 404", status)
	}
}
