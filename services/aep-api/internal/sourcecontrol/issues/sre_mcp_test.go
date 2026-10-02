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

package issues_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/platform/secrets"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol/issues"
)

// callTool POSTs one tools/call to the SRE MCP handler and returns the text
// block and its isError flag.
func callTool(t *testing.T, h http.Handler, name string, args map[string]any) (string, bool) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0", "id": 1, "method": "tools/call",
		"params": map[string]any{"name": name, "arguments": args},
	})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(string(body))))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body %q", w.Code, w.Body.String())
	}
	var resp struct {
		Result struct {
			Content []struct {
				Text string `json:"text"`
			} `json:"content"`
			IsError bool `json:"isError"`
		} `json:"result"`
		Error *struct{ Message string } `json:"error"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Error != nil || len(resp.Result.Content) != 1 {
		t.Fatalf("not a tool result: %+v", resp)
	}
	return resp.Result.Content[0].Text, resp.Result.IsError
}

func TestSREMCPCreateIssueBindsIncidentContext(t *testing.T) {
	gh := &host{}
	h := issues.NewSREMCPHandler(sourcecontrol.NewIssueService(repo{}, gh, resolver{}), "acme")
	text, isErr := callTool(t, h, "create_issue", map[string]any{
		"project": "shop", "title": "timeout", "body": "rca", "componentName": "checkout",
		"actionStatuses": []any{nil}, "labels": []string{"BUG"},
	})
	if isErr {
		t.Fatalf("create failed: %s", text)
	}
	var result map[string]any
	if err := json.Unmarshal([]byte(text), &result); err != nil {
		t.Fatal(err)
	}
	if result["number"] != float64(42) || result["classification"] != "code-level" {
		t.Fatalf("outcome = %s", text)
	}
	labels := strings.Join(gh.created.Labels, ",")
	if !strings.Contains(labels, "incident") || strings.Count(strings.ToLower(labels), "bug") != 1 {
		t.Fatalf("labels = %v, want the caller's plus incident, bug once", gh.created.Labels)
	}
}

func TestSREMCPCreateIssueRequiresActionStatuses(t *testing.T) {
	h := issues.NewSREMCPHandler(sourcecontrol.NewIssueService(repo{}, &host{}, resolver{}), "acme")
	text, isErr := callTool(t, h, "create_issue", map[string]any{"project": "shop", "title": "timeout", "body": "rca"})
	if !isErr || !strings.Contains(text, "actionStatuses") {
		t.Fatalf("got %q isError=%v", text, isErr)
	}
	text, isErr = callTool(t, h, "create_issue", map[string]any{
		"project": "shop", "title": "timeout", "body": "rca", "actionStatuses": []any{"fixed"},
	})
	if !isErr || !strings.Contains(text, "fixed") {
		t.Fatalf("an unknown status should be refused, got %q isError=%v", text, isErr)
	}
}

// closedDuplicateHost answers the incident lookup with one closed match whose
// closure reason (a human's "duplicate") is not eligible to recur.
type closedDuplicateHost struct{ host }

func (*closedDuplicateHost) ListIssues(context.Context, string, string, secrets.Credential, []string) ([]sourcecontrol.IssueInfo, error) {
	return []sourcecontrol.IssueInfo{{Number: 7, State: "closed", StateReason: "duplicate", Labels: []string{"bug", "incident"}}}, nil
}

func TestSREMCPReportsIneligibleClosedIncidentAsConflict(t *testing.T) {
	h := issues.NewSREMCPHandler(sourcecontrol.NewIssueService(repo{}, &closedDuplicateHost{}, resolver{}), "acme")
	text, isErr := callTool(t, h, "create_issue", map[string]any{
		"project": "shop", "title": "timeout", "body": "rca", "componentName": "checkout", "actionStatuses": []any{},
	})
	if !isErr || !strings.HasPrefix(text, "aep-api 409: ") {
		t.Fatalf("an ineligible closed incident should be a 409 tool error, got %q", text)
	}
}

type planHost struct{ host }

func (*planHost) ListIssues(context.Context, string, string, secrets.Credential, []string) ([]sourcecontrol.IssueInfo, error) {
	return []sourcecontrol.IssueInfo{
		{Number: 1, Title: "Implement checkout", State: "closed", Labels: []string{"aep", "development"}},
		{Number: 2, Title: "checkout times out", State: "open", Labels: []string{"aep", "development", "bug"}},
	}, nil
}

func TestSREMCPSearchMarksPlatformPlans(t *testing.T) {
	h := issues.NewSREMCPHandler(sourcecontrol.NewIssueService(repo{}, &planHost{}, resolver{}), "acme")
	text, isErr := callTool(t, h, "search_related_issues", map[string]any{"project": "shop", "query": "checkout"})
	if isErr {
		t.Fatalf("search failed: %s", text)
	}
	var hits []map[string]any
	if err := json.Unmarshal([]byte(text), &hits); err != nil {
		t.Fatal(err)
	}
	if len(hits) != 2 {
		t.Fatalf("hits = %s", text)
	}
	for _, hit := range hits {
		plan := hit["Number"] == float64(1)
		if (hit["PlatformRecord"] == true) != plan || (hit["ReadAs"] != nil) != plan {
			t.Errorf("issue %v: PlatformRecord=%v ReadAs set=%v, want plan=%v", hit["Number"], hit["PlatformRecord"], hit["ReadAs"] != nil, plan)
		}
		if hit["Title"] == nil {
			t.Errorf("issue %v lost its capitalized wire keys: %v", hit["Number"], hit)
		}
	}
}

func TestSREMCPListsOnlyTheHandoffTools(t *testing.T) {
	h := issues.NewSREMCPHandler(sourcecontrol.NewIssueService(repo{}, &host{}, resolver{}), "acme")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)))
	var resp struct {
		Result struct {
			Tools []struct{ Name string } `json:"tools"`
		} `json:"result"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, tool := range resp.Result.Tools {
		names = append(names, tool.Name)
	}
	if strings.Join(names, ",") != "search_related_issues,create_issue" {
		t.Fatalf("tools = %v", names)
	}
}

func TestSREMCPWithoutIssueServiceIs503(t *testing.T) {
	w := httptest.NewRecorder()
	issues.NewSREMCPHandler(nil, "acme").ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{}`)))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
}
