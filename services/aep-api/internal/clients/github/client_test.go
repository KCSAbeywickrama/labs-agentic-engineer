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

package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/credentials"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
)

// stubCred is a fixed-token credential for driving the real client against an
// httptest fake (mirrors the stubCred in feature tests).
type stubCred struct{}

func (stubCred) Token(context.Context) (string, time.Time, error) { return "tok", time.Time{}, nil }
func (stubCred) Identity() credentials.Identity {
	return credentials.Identity{Name: "Bot", Email: "bot@aep.dev", Login: "bot"}
}
func (stubCred) RepoOwner() string                            { return "acme" }
func (stubCred) WebhookStrategy() credentials.WebhookStrategy { return credentials.WebhookPlatform }

// capture records the one request an httptest fake receives.
type capture struct {
	method      string
	escapedPath string
	body        string
}

// newFake starts an httptest server that records the request and replies with
// status+respBody, and returns the real client pointed at it plus the capture.
func newFake(t *testing.T, status int, respBody string) (*Client, *capture) {
	t.Helper()
	cap := &capture{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		cap.method = r.Method
		cap.escapedPath = r.URL.EscapedPath()
		cap.body = string(b)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, respBody)
	}))
	t.Cleanup(srv.Close)
	c, ok := NewClient(WithAPIBase(srv.URL)).(*Client)
	if !ok {
		t.Fatalf("NewClient did not return *Client")
	}
	return c, cap
}

func TestAddIssueLabels(t *testing.T) {
	c, cap := newFake(t, http.StatusOK, `[]`)
	if err := c.AddIssueLabels(context.Background(), "acme", "repo", stubCred{}, 42, []string{"aep:status/pending", "aep:attention"}); err != nil {
		t.Fatalf("AddIssueLabels: %v", err)
	}
	if cap.method != http.MethodPost {
		t.Errorf("method = %s; want POST", cap.method)
	}
	if cap.escapedPath != "/repos/acme/repo/issues/42/labels" {
		t.Errorf("path = %s", cap.escapedPath)
	}
	var got map[string][]string
	if err := json.Unmarshal([]byte(cap.body), &got); err != nil {
		t.Fatalf("body not json: %v (%s)", err, cap.body)
	}
	if len(got["labels"]) != 2 || got["labels"][0] != "aep:status/pending" {
		t.Errorf("labels payload = %v", got["labels"])
	}
}

func TestAddIssueLabelsError(t *testing.T) {
	c, _ := newFake(t, http.StatusForbidden, `{"message":"no"}`)
	if err := c.AddIssueLabels(context.Background(), "acme", "repo", stubCred{}, 1, []string{"x"}); err == nil {
		t.Fatalf("expected error on 403")
	}
}

// TestRemoveIssueLabel checks the label name is path-escaped ('/' → %2F) and
// that 404 (label already absent) is success.
func TestRemoveIssueLabel(t *testing.T) {
	c, cap := newFake(t, http.StatusOK, `[]`)
	if err := c.RemoveIssueLabel(context.Background(), "acme", "repo", stubCred{}, 7, "aep:status/pending"); err != nil {
		t.Fatalf("RemoveIssueLabel: %v", err)
	}
	if cap.method != http.MethodDelete {
		t.Errorf("method = %s; want DELETE", cap.method)
	}
	if cap.escapedPath != "/repos/acme/repo/issues/7/labels/aep:status%2Fpending" {
		t.Errorf("path not escaped correctly: %s", cap.escapedPath)
	}

	c404, _ := newFake(t, http.StatusNotFound, `{"message":"Label does not exist"}`)
	if err := c404.RemoveIssueLabel(context.Background(), "acme", "repo", stubCred{}, 7, "aep:execute"); err != nil {
		t.Fatalf("404 should be treated as success (label already absent): %v", err)
	}

	c500, _ := newFake(t, http.StatusInternalServerError, `{"message":"boom"}`)
	if err := c500.RemoveIssueLabel(context.Background(), "acme", "repo", stubCred{}, 7, "aep:execute"); err == nil {
		t.Fatalf("expected error on 500")
	}
}

func TestSetIssueLabels(t *testing.T) {
	c, cap := newFake(t, http.StatusOK, `[]`)
	if err := c.SetIssueLabels(context.Background(), "acme", "repo", stubCred{}, 3, []string{"aep:task"}); err != nil {
		t.Fatalf("SetIssueLabels: %v", err)
	}
	if cap.method != http.MethodPut {
		t.Errorf("method = %s; want PUT", cap.method)
	}
	if cap.escapedPath != "/repos/acme/repo/issues/3/labels" {
		t.Errorf("path = %s", cap.escapedPath)
	}

	// nil labels must serialize as an explicit empty array (clear), not null.
	cNil, capNil := newFake(t, http.StatusOK, `[]`)
	if err := cNil.SetIssueLabels(context.Background(), "acme", "repo", stubCred{}, 3, nil); err != nil {
		t.Fatalf("SetIssueLabels(nil): %v", err)
	}
	if capNil.body != `{"labels":[]}` {
		t.Errorf("nil labels body = %s; want an explicit empty array", capNil.body)
	}
}

func TestCompareRefs(t *testing.T) {
	resp := `{
		"status":"ahead","ahead_by":2,"behind_by":0,"total_commits":2,
		"files":[
			{"filename":"specs/design/components/svc/design.md","status":"modified","additions":5,"deletions":1,"changes":6,"patch":"@@ -1 +1 @@"},
			{"filename":"specs/req.md","status":"added","additions":10,"deletions":0,"changes":10}
		]
	}`
	c, cap := newFake(t, http.StatusOK, resp)
	got, err := c.CompareRefs(context.Background(), "acme", "repo", stubCred{}, "design-v4", "design-v5")
	if err != nil {
		t.Fatalf("CompareRefs: %v", err)
	}
	if cap.method != http.MethodGet {
		t.Errorf("method = %s; want GET", cap.method)
	}
	if cap.escapedPath != "/repos/acme/repo/compare/design-v4...design-v5" {
		t.Errorf("path = %s", cap.escapedPath)
	}
	if got.Status != "ahead" || got.AheadBy != 2 || got.TotalCommits != 2 {
		t.Errorf("summary: %+v", got)
	}
	if len(got.Files) != 2 {
		t.Fatalf("files = %d; want 2", len(got.Files))
	}
	if got.Files[0].Filename != "specs/design/components/svc/design.md" || got.Files[0].Status != "modified" || got.Files[0].Patch != "@@ -1 +1 @@" {
		t.Errorf("file[0]: %+v", got.Files[0])
	}
	if got.Files[1].Status != "added" || got.Files[1].Additions != 10 {
		t.Errorf("file[1]: %+v", got.Files[1])
	}
}

// TestCompareRefsTruncation confirms the Truncated flag is set when GitHub
// returns a full page of files (the 300-file cap) and clear otherwise.
func TestCompareRefsTruncation(t *testing.T) {
	makeResp := func(n int) string {
		files := make([]string, n)
		for i := range files {
			files[i] = fmt.Sprintf(`{"filename":"f%d","status":"modified","additions":1,"deletions":0,"changes":1}`, i)
		}
		return `{"status":"ahead","ahead_by":1,"behind_by":0,"total_commits":1,"files":[` + strings.Join(files, ",") + `]}`
	}

	// A full page (cap) → Truncated.
	cFull, _ := newFake(t, http.StatusOK, makeResp(compareFilesCap))
	full, err := cFull.CompareRefs(context.Background(), "acme", "repo", stubCred{}, "a", "b")
	if err != nil {
		t.Fatalf("CompareRefs(full): %v", err)
	}
	if !full.Truncated {
		t.Fatalf("a %d-file response should be Truncated", compareFilesCap)
	}
	if len(full.Files) != compareFilesCap {
		t.Fatalf("files = %d; want %d", len(full.Files), compareFilesCap)
	}

	// A short page → not truncated.
	cShort, _ := newFake(t, http.StatusOK, makeResp(3))
	short, err := cShort.CompareRefs(context.Background(), "acme", "repo", stubCred{}, "a", "b")
	if err != nil {
		t.Fatalf("CompareRefs(short): %v", err)
	}
	if short.Truncated {
		t.Fatalf("a 3-file response should not be Truncated")
	}
}

func TestCompareRefsError(t *testing.T) {
	c, _ := newFake(t, http.StatusNotFound, `{"message":"Not Found"}`)
	_, err := c.CompareRefs(context.Background(), "acme", "repo", stubCred{}, "a", "b")
	if !gitrepo.IsHTTPStatus(err, http.StatusNotFound) {
		t.Fatalf("expected HTTPStatusError 404, got %v", err)
	}
}

func TestUpdateWebhookEvents(t *testing.T) {
	c, cap := newFake(t, http.StatusOK, `{"id":99}`)
	if err := c.UpdateWebhookEvents(context.Background(), "acme", "repo", stubCred{}, 99, []string{"pull_request", "push", "issues"}); err != nil {
		t.Fatalf("UpdateWebhookEvents: %v", err)
	}
	if cap.method != http.MethodPatch {
		t.Errorf("method = %s; want PATCH", cap.method)
	}
	if cap.escapedPath != "/repos/acme/repo/hooks/99" {
		t.Errorf("path = %s", cap.escapedPath)
	}
	var got map[string][]string
	if err := json.Unmarshal([]byte(cap.body), &got); err != nil {
		t.Fatalf("body not json: %v", err)
	}
	found := false
	for _, e := range got["events"] {
		if e == "issues" {
			found = true
		}
	}
	if !found {
		t.Errorf("events payload missing 'issues': %v", got["events"])
	}
}
