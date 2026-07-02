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

package gitrepo_test

import (
	"errors"
	"net/http"
	"testing"

	githubclient "github.com/wso2/aep/aep-api/internal/clients/github"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/internal/platform/gittest"
	"github.com/wso2/aep/aep-api/models"
)

// newBoardSvcOnStub wires a REAL repoBoardService and REAL GraphQL v2 client at
// the stub's /graphql endpoint. Driving the real client through this seam is
// what exercises WithGraphQLEndpoint (and its envelope parsing / error mapping).
func newBoardSvcOnStub(t *testing.T, stub *gittest.Stub, row *models.GitRepository) gitrepo.RepoBoardService {
	t.Helper()
	repo := newFakeRepoRepo()
	if row != nil {
		repo.preload(row)
	}
	v2 := githubclient.NewClient(githubclient.WithGraphQLEndpoint(stub.URL + "/graphql"))
	return gitrepo.NewRepoBoardService(repo, v2, fakeResolver{})
}

const boardJSON = `{"data":{"node":{
	"url":"https://github.com/orgs/acme/projects/1",
	"items":{"nodes":[
		{"id":"item1",
		 "fieldValues":{"nodes":[{"name":"In Progress","field":{"name":"Status"}}]},
		 "content":{"title":"Task A","url":"https://github.com/acme/widgets/issues/1","body":"body text",
			"assignees":{"nodes":[{"login":"alice"}]},
			"labels":{"nodes":[{"name":"aep","color":"0075ca"}]}}},
		{"id":"draftItem","fieldValues":{"nodes":[]},"content":{}}
	]}
}}}`

func TestGetBoard_ParsesItemsAndSkipsDrafts(t *testing.T) {
	t.Parallel()
	stub := gittest.NewStub(t)
	stub.On(http.MethodPost, "/graphql", http.StatusOK, boardJSON)
	svc := newBoardSvcOnStub(t, stub, &models.GitRepository{OrgID: "org1", ProjectID: "proj1", GithubProjectID: "PVT_board"})

	board, err := svc.GetBoard(testContext(), "org1", "proj1")
	if err != nil {
		t.Fatalf("GetBoard: %v", err)
	}
	if board.URL != "https://github.com/orgs/acme/projects/1" {
		t.Fatalf("board URL = %q", board.URL)
	}
	// The draft item (empty content title) is skipped — exactly one real item.
	if len(board.Items) != 1 {
		t.Fatalf("items = %d, want 1 (draft skipped)", len(board.Items))
	}
	it := board.Items[0]
	if it.ID != "item1" || it.Title != "Task A" || it.URL != "https://github.com/acme/widgets/issues/1" ||
		it.Body != "body text" || it.Assignee != "alice" || it.Status != "In Progress" {
		t.Fatalf("item = %+v", it)
	}
	if len(it.Labels) != 1 || it.Labels[0].Name != "aep" || it.Labels[0].Color != "0075ca" {
		t.Fatalf("labels = %+v, want [{aep 0075ca}]", it.Labels)
	}
}

func TestGetBoard_EmptyProjectIDReturnsEmptyNoHTTP(t *testing.T) {
	t.Parallel()
	stub := gittest.NewStub(t)
	svc := newBoardSvcOnStub(t, stub, &models.GitRepository{OrgID: "org1", ProjectID: "proj1", GithubProjectID: ""})

	board, err := svc.GetBoard(testContext(), "org1", "proj1")
	if err != nil {
		t.Fatalf("GetBoard: %v", err)
	}
	if board == nil || len(board.Items) != 0 || board.URL != "" {
		t.Fatalf("board = %+v, want empty", board)
	}
	if n := len(stub.Requests()); n != 0 {
		t.Fatalf("GraphQL called %d times for a board-less repo, want 0", n)
	}
}

func TestGetBoard_RepoNotFound(t *testing.T) {
	t.Parallel()
	svc := newBoardSvcOnStub(t, gittest.NewStub(t), nil)
	if _, err := svc.GetBoard(testContext(), "org1", "proj1"); !errors.Is(err, gitrepo.ErrRepoNotFound) {
		t.Fatalf("err = %v, want ErrRepoNotFound", err)
	}
}

func TestGetBoard_HTTPErrorMapped(t *testing.T) {
	t.Parallel()
	stub := gittest.NewStub(t)
	stub.On(http.MethodPost, "/graphql", http.StatusUnauthorized, `{"message":"Bad credentials"}`)
	svc := newBoardSvcOnStub(t, stub, &models.GitRepository{OrgID: "org1", ProjectID: "proj1", GithubProjectID: "PVT_board"})

	_, err := svc.GetBoard(testContext(), "org1", "proj1")
	if err == nil || !contains401(err.Error()) {
		t.Fatalf("err = %v, want a 401 graphql error", err)
	}
}

func TestGetBoard_GraphQLLevelErrorMapped(t *testing.T) {
	t.Parallel()
	stub := gittest.NewStub(t)
	// 200 OK but with a GraphQL errors array — the client surfaces the message.
	stub.On(http.MethodPost, "/graphql", http.StatusOK, `{"errors":[{"message":"boom"}]}`)
	svc := newBoardSvcOnStub(t, stub, &models.GitRepository{OrgID: "org1", ProjectID: "proj1", GithubProjectID: "PVT_board"})

	_, err := svc.GetBoard(testContext(), "org1", "proj1")
	if err == nil || !containsSub(err.Error(), "graphql error: boom") {
		t.Fatalf("err = %v, want it to carry 'graphql error: boom'", err)
	}
}

const fieldsItemsJSON = `{"data":{"node":{
	"fields":{"nodes":[{"id":"FIELD_status","name":"Status","options":[{"id":"OPT_done","name":"Done"},{"id":"OPT_todo","name":"Todo"}]}]},
	"items":{"nodes":[{"id":"item1","content":{"url":"https://github.com/acme/widgets/issues/1"}}]}
}}}`

func TestMoveIssueToStatus_SendsMutationWithResolvedIDs(t *testing.T) {
	t.Parallel()
	stub := gittest.NewStub(t)
	stub.On(http.MethodPost, "/graphql", http.StatusOK, fieldsItemsJSON)
	svc := newBoardSvcOnStub(t, stub, &models.GitRepository{OrgID: "org1", ProjectID: "proj1", GithubProjectID: "PVT_board"})

	err := svc.MoveIssueToStatus(testContext(), "org1", "proj1", "https://github.com/acme/widgets/issues/1", "Done")
	if err != nil {
		t.Fatalf("MoveIssueToStatus: %v", err)
	}
	reqs := requestsMatching(stub.Requests(), http.MethodPost, "/graphql")
	if len(reqs) != 2 {
		t.Fatalf("graphql requests = %d, want 2 (query + mutation)", len(reqs))
	}
	// The mutation (second request) carries the IDs resolved from the query.
	var mut struct {
		Variables struct {
			ProjectID string `json:"projectId"`
			ItemID    string `json:"itemId"`
			FieldID   string `json:"fieldId"`
			OptionID  string `json:"optionId"`
		} `json:"variables"`
	}
	decodeBody(t, reqs[1].Body, &mut)
	if mut.Variables.ProjectID != "PVT_board" || mut.Variables.ItemID != "item1" ||
		mut.Variables.FieldID != "FIELD_status" || mut.Variables.OptionID != "OPT_done" {
		t.Fatalf("mutation variables = %+v, want {PVT_board item1 FIELD_status OPT_done}", mut.Variables)
	}
}

func TestMoveIssueToStatus_UnknownStatusIsNoOp(t *testing.T) {
	t.Parallel()
	stub := gittest.NewStub(t)
	stub.On(http.MethodPost, "/graphql", http.StatusOK, fieldsItemsJSON)
	svc := newBoardSvcOnStub(t, stub, &models.GitRepository{OrgID: "org1", ProjectID: "proj1", GithubProjectID: "PVT_board"})

	// "Blocked" is not among the Status options → no mutation is sent.
	if err := svc.MoveIssueToStatus(testContext(), "org1", "proj1", "https://github.com/acme/widgets/issues/1", "Blocked"); err != nil {
		t.Fatalf("MoveIssueToStatus: %v", err)
	}
	if reqs := requestsMatching(stub.Requests(), http.MethodPost, "/graphql"); len(reqs) != 1 {
		t.Fatalf("graphql requests = %d, want 1 (query only, no mutation)", len(reqs))
	}
}

func contains401(s string) bool { return containsSub(s, "401") }
func containsSub(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && stringIndex(s, sub) >= 0)
}
func stringIndex(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
