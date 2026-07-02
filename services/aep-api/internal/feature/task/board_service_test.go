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

// UNIT tier: boardService.GetBoard — the kanban projection that overlays the
// project's ComponentTask DB rows onto the GitHub Project board columns. The
// out-of-process GitHub board is faked (gitrepo.RepoBoardService); the DB rows
// are faked (repositories.TaskRepository). Proves the column-routing rules:
// the BFF's terminal/on_hold statuses OVERRIDE the GitHub column, the DB-only
// fallback when the board hasn't synced, and unissued tasks being surfaced.
package task

import (
	"context"
	"errors"
	"testing"

	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/models"
)

func TestBoard_NilRepoBoardServiceReturnsEmptyBoard(t *testing.T) {
	t.Parallel()
	svc := NewBoardService(nil, nil)
	b, err := svc.GetBoard(context.Background(), "acme", "web")
	if err != nil {
		t.Fatalf("nil board svc: %v", err)
	}
	// All columns present and empty (never nil — the frontend indexes them).
	if b.Todo == nil || b.InProgress == nil || b.Done == nil || b.OnHold == nil || b.Failed == nil {
		t.Fatalf("empty board columns must be non-nil slices: %+v", b)
	}
}

func TestBoard_RepoBoardErrorPropagates(t *testing.T) {
	t.Parallel()
	svc := NewBoardService(&fakeRepoBoardSvc{GetBoardFunc: func(context.Context, string, string) (*gitrepo.ProjectBoardResult, error) {
		return nil, errors.New("github graphql 500")
	}}, nil)
	if _, err := svc.GetBoard(context.Background(), "acme", "web"); err == nil {
		t.Fatal("a RepoBoardService error must propagate")
	}
}

func TestBoard_TerminalAndOnHoldStatusOverrideGitHubColumn(t *testing.T) {
	t.Parallel()
	// GitHub reports all three issues under "in progress"; the BFF's own
	// ComponentTask.Status is authoritative for on_hold + terminal-failure
	// routing and must win over the (possibly stale) board column.
	board := &fakeRepoBoardSvc{GetBoardFunc: func(context.Context, string, string) (*gitrepo.ProjectBoardResult, error) {
		return &gitrepo.ProjectBoardResult{
			URL: "https://gh/board",
			Items: []gitrepo.BoardItem{
				{ID: "i1", URL: "https://gh/1", Status: "In Progress"},
				{ID: "i2", URL: "https://gh/2", Status: "In Progress"},
				{ID: "i3", URL: "https://gh/3", Status: "In Progress"},
			},
		}, nil
	}}
	repo := &fakeTaskRepo{ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) {
		return []models.ComponentTask{
			{ID: "t1", IssueURL: "https://gh/1", Status: string(models.TaskStatusOnHold)},
			{ID: "t2", IssueURL: "https://gh/2", Status: string(models.TaskStatusFailed)},
			{ID: "t3", IssueURL: "https://gh/3", Status: string(models.TaskStatusInProgress)},
		}, nil
	}}
	b, err := NewBoardService(board, repo).GetBoard(context.Background(), "acme", "web")
	if err != nil {
		t.Fatalf("get board: %v", err)
	}
	if len(b.OnHold) != 1 || b.OnHold[0].ComponentTaskID != "t1" {
		t.Fatalf("on_hold override failed: %+v", b.OnHold)
	}
	if len(b.Failed) != 1 || b.Failed[0].ComponentTaskID != "t2" {
		t.Fatalf("terminal-failure override failed: %+v", b.Failed)
	}
	// t3 (in_progress) has no override → follows the GitHub column ("In Progress").
	if len(b.InProgress) != 1 || b.InProgress[0].ComponentTaskID != "t3" {
		t.Fatalf("non-terminal task should follow the GitHub column: %+v", b.InProgress)
	}
	if b.URL != "https://gh/board" {
		t.Fatalf("board URL not surfaced: %q", b.URL)
	}
}

func TestBoard_GitHubColumnRoutingWhenNoBackingTask(t *testing.T) {
	t.Parallel()
	// Items with no matching ComponentTask row route purely by the GitHub column
	// via normalizeStatus (trim + lowercase).
	board := &fakeRepoBoardSvc{GetBoardFunc: func(context.Context, string, string) (*gitrepo.ProjectBoardResult, error) {
		return &gitrepo.ProjectBoardResult{Items: []gitrepo.BoardItem{
			{ID: "i1", URL: "https://gh/1", Status: " Done "},
			{ID: "i2", URL: "https://gh/2", Status: "backlog"}, // unknown → Todo
		}}, nil
	}}
	repo := &fakeTaskRepo{ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) {
		return nil, nil
	}}
	b, err := NewBoardService(board, repo).GetBoard(context.Background(), "acme", "web")
	if err != nil {
		t.Fatalf("get board: %v", err)
	}
	if len(b.Done) != 1 || len(b.Todo) != 1 {
		t.Fatalf("column routing: done=%d todo=%d", len(b.Done), len(b.Todo))
	}
}

func TestBoard_FallbackToDBWhenBoardHasNoItems(t *testing.T) {
	t.Parallel()
	// GitHub Project hasn't synced (0 items) but DB has tasks → render from DB,
	// grouped by ComponentTask.Status, with gh_issue_created upgraded to syncing.
	board := &fakeRepoBoardSvc{GetBoardFunc: func(context.Context, string, string) (*gitrepo.ProjectBoardResult, error) {
		return &gitrepo.ProjectBoardResult{}, nil // no items
	}}
	repo := &fakeTaskRepo{ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) {
		return []models.ComponentTask{
			{ID: "t1", IssueURL: "https://gh/1", Status: "deployed", LifecycleStatus: string(models.TaskLifecycleGhIssueCreated)},
			{ID: "t2", IssueURL: "https://gh/2", Status: "failed"},
			{ID: "t3", IssueURL: "https://gh/3", Status: "in_progress"},
		}, nil
	}}
	b, err := NewBoardService(board, repo).GetBoard(context.Background(), "acme", "web")
	if err != nil {
		t.Fatalf("get board: %v", err)
	}
	if len(b.Done) != 1 || len(b.Failed) != 1 || len(b.InProgress) != 1 {
		t.Fatalf("DB fallback grouping: done=%d failed=%d inProgress=%d", len(b.Done), len(b.Failed), len(b.InProgress))
	}
	// The response-only syncing override is applied in the fallback path.
	if b.Done[0].LifecycleStatus != string(models.TaskLifecycleGhIssueSyncing) {
		t.Fatalf("gh_issue_created should surface as syncing in the DB fallback, got %q", b.Done[0].LifecycleStatus)
	}
}

func TestBoard_PartialSyncTaskWithNoCardIsStillVisible(t *testing.T) {
	t.Parallel()
	// The GitHub Project synced ONE card, but the DB holds two ISSUED tasks: the
	// second's issue was created yet its AddIssueToProject never landed, so it
	// has an IssueURL but no card. DB is the source of truth for existence — the
	// uncarded task must still appear, or a partial card sync silently hides a
	// live task from the board (the observed root cause).
	board := &fakeRepoBoardSvc{GetBoardFunc: func(context.Context, string, string) (*gitrepo.ProjectBoardResult, error) {
		return &gitrepo.ProjectBoardResult{
			URL: "https://gh/board",
			Items: []gitrepo.BoardItem{
				{ID: "i1", URL: "https://gh/1", Status: "In Progress"},
			},
		}, nil
	}}
	repo := &fakeTaskRepo{ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) {
		return []models.ComponentTask{
			{ID: "carded", IssueURL: "https://gh/1", Status: "in_progress"},
			{ID: "uncarded", IssueURL: "https://gh/2", Status: "pending", LifecycleStatus: string(models.TaskLifecycleGhIssueCreated)},
		}, nil
	}}
	b, err := NewBoardService(board, repo).GetBoard(context.Background(), "acme", "web")
	if err != nil {
		t.Fatalf("get board: %v", err)
	}
	// The carded task follows its GitHub column and is NOT duplicated.
	if len(b.InProgress) != 1 || b.InProgress[0].ComponentTaskID != "carded" {
		t.Fatalf("carded task should be the only In Progress item: %+v", b.InProgress)
	}
	// The uncarded issued task is surfaced from DB, routed by its status → Todo,
	// and marked syncing since its card hasn't landed yet.
	if len(b.Todo) != 1 || b.Todo[0].ComponentTaskID != "uncarded" {
		t.Fatalf("uncarded issued task must still be visible in Todo: %+v", b.Todo)
	}
	if b.Todo[0].LifecycleStatus != string(models.TaskLifecycleGhIssueSyncing) {
		t.Fatalf("uncarded task should surface as syncing, got %q", b.Todo[0].LifecycleStatus)
	}
}

func TestBoard_UnissuedTasksAreSurfaced(t *testing.T) {
	t.Parallel()
	// Tasks with no IssueURL never appear on the GitHub board; the projector must
	// surface them anyway — gh_issue_failed → Failed, otherwise → Todo.
	board := &fakeRepoBoardSvc{GetBoardFunc: func(context.Context, string, string) (*gitrepo.ProjectBoardResult, error) {
		return &gitrepo.ProjectBoardResult{Items: []gitrepo.BoardItem{
			{ID: "i1", URL: "https://gh/1", Status: "Todo"},
		}}, nil
	}}
	repo := &fakeTaskRepo{ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) {
		return []models.ComponentTask{
			{ID: "issued", IssueURL: "https://gh/1", Status: "pending"},
			{ID: "waiting", IssueURL: "", LifecycleStatus: string(models.TaskLifecycleGhIssueWaiting)},
			{ID: "failed", IssueURL: "", LifecycleStatus: string(models.TaskLifecycleGhIssueFailed)},
		}, nil
	}}
	b, err := NewBoardService(board, repo).GetBoard(context.Background(), "acme", "web")
	if err != nil {
		t.Fatalf("get board: %v", err)
	}
	// The issued task + the gh_issue_waiting unissued task both land in Todo.
	if len(b.Todo) != 2 {
		t.Fatalf("todo should hold the issued task + the waiting unissued task, got %+v", b.Todo)
	}
	if len(b.Failed) != 1 || b.Failed[0].ID != "failed" {
		t.Fatalf("gh_issue_failed unissued task must surface in Failed: %+v", b.Failed)
	}
}
