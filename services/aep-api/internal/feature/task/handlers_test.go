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

// UNIT tier: the webhook transition handlers' PURE and EARLY-RETURN logic —
// the Closes-#N parser and the payload-guard branches that return before ever
// touching the projector, so no DB is needed. The full projector interplay
// (link → transition, merge → build dispatch) is proven end-to-end against
// real Postgres in task_dbtest_test.go.
package task

import (
	"context"
	"testing"
)

func TestParseClosesIssueRef(t *testing.T) {
	t.Parallel()
	cases := []struct {
		body string
		want int
	}{
		{"Closes #12", 12},
		{"closes #7 and more", 7},
		{"This fixes #3.", 3},
		{"resolves: #42", 42},
		{"Resolved #100\nmore text", 100},
		{"no keyword #5", 0},    // number without a closing keyword
		{"closes PR #5", 0},     // "PR #5" — the keyword isn't adjacent to the ref
		{"unrelated body", 0},   // nothing
		{"fixes org/repo#9", 0}, // cross-repo form intentionally NOT matched
	}
	for _, tc := range cases {
		if got := parseClosesIssueRef(tc.body); got != tc.want {
			t.Errorf("parseClosesIssueRef(%q) = %d, want %d", tc.body, got, tc.want)
		}
	}
}

func TestPullRequestHandlers_EarlyReturnsDoNotTouchProjector(t *testing.T) {
	t.Parallel()
	// A nil projector/db Handler: any branch that reaches the projector would
	// nil-panic, so a passing test proves these branches return BEFORE it.
	h := &Handler{}
	ctx := context.Background()

	// PR number 0 → ignored.
	if err := h.PullRequestOpened(ctx, "pull_request", "opened", []byte(`{"pull_request":{"number":0}}`)); err != nil {
		t.Fatalf("opened, pr#0: %v", err)
	}
	// A PR body with no Closes #N → ignored (unlinkable), returns before projector.
	if err := h.PullRequestOpened(ctx, "pull_request", "opened",
		[]byte(`{"pull_request":{"number":5,"body":"just a PR"}}`)); err != nil {
		t.Fatalf("opened, no closes ref: %v", err)
	}
	// ready_for_review / closed with pr#0 → ignored.
	if err := h.PullRequestReady(ctx, "pull_request", "ready_for_review", []byte(`{"pull_request":{"number":0}}`)); err != nil {
		t.Fatalf("ready, pr#0: %v", err)
	}
	if err := h.PullRequestClosed(ctx, "pull_request", "closed", []byte(`{"pull_request":{"number":0}}`)); err != nil {
		t.Fatalf("closed, pr#0: %v", err)
	}
	// reopened is a documented no-op.
	if err := h.PullRequestReopened(ctx, "pull_request", "reopened", []byte(`{}`)); err != nil {
		t.Fatalf("reopened: %v", err)
	}
}

func TestPullRequestOpened_MalformedPayloadErrors(t *testing.T) {
	t.Parallel()
	h := &Handler{}
	if err := h.PullRequestOpened(context.Background(), "pull_request", "opened", []byte(`{not json`)); err == nil {
		t.Fatal("a malformed pull_request payload must error")
	}
}

func TestPushHandler_OnlyDefaultBranchIsAudited(t *testing.T) {
	t.Parallel()
	h := &Handler{}
	ctx := context.Background()

	// Non-branch ref (a tag) → ignored.
	if err := h.Push(ctx, "push", "", []byte(`{"ref":"refs/tags/v1"}`)); err != nil {
		t.Fatalf("tag push: %v", err)
	}
	// A feature branch (not the repo default) → ignored.
	if err := h.Push(ctx, "push", "",
		[]byte(`{"ref":"refs/heads/feature/x","repository":{"default_branch":"main"}}`)); err != nil {
		t.Fatalf("feature-branch push: %v", err)
	}
	// Default-branch push with a head SHA → audited (no build dispatch here), no error.
	if err := h.Push(ctx, "push", "",
		[]byte(`{"ref":"refs/heads/main","repository":{"default_branch":"main","full_name":"o/r"},"head_commit":{"id":"abc"}}`)); err != nil {
		t.Fatalf("default-branch push: %v", err)
	}
}

func TestIssueComment_IsAuditOnlyNoOp(t *testing.T) {
	t.Parallel()
	if err := (&Handler{}).IssueComment(context.Background(), "issue_comment", "created", []byte(`{}`)); err != nil {
		t.Fatalf("issue_comment must be a no-op, got %v", err)
	}
}
