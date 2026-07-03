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

package task

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

// BoardTask is a single task item on the project board.
type BoardTask struct {
	ID              string              `json:"id"`
	Title           string              `json:"title"`
	URL             string              `json:"url"`
	Description     string              `json:"description,omitempty"`
	Assignee        string              `json:"assignee,omitempty"`
	ComponentTaskID string              `json:"componentTaskId,omitempty"`
	Labels          []gitrepo.LabelInfo `json:"labels,omitempty"`
	LifecycleStatus string              `json:"lifecycleStatus,omitempty"`
	// Status is the ComponentTask execution status (pending, on_hold,
	// in_progress, ready_for_review, merged, building, deployed, rejected,
	// failed, abandoned). Empty when the row has no backing ComponentTask.
	Status string `json:"status,omitempty"`
	// DispatchedAt is the time the task was dispatched for execution.
	// Nil for never-dispatched tasks; the frontend uses it to render
	// "started Xm ago" and to gate the Live progress affordance.
	DispatchedAt *time.Time `json:"dispatchedAt,omitempty"`
	// ExecType mirrors ComponentTask.ExecType ("SYSTEM","WORKER"). Today
	// every task is "WORKER" (coding-agent) and dispatches through the batch
	// /tasks/dispatch path. "SYSTEM" is dormant — no producer sets it and
	// nothing branches on it; it is reserved for the future
	// database-provisioning rewrite that will re-attach behaviour.
	ExecType string `json:"execType,omitempty"`
	// DependsOnComponents mirrors ComponentTask.DependsOnComponents — the
	// list of component names this task is waiting to be deployed before
	// it can dispatch. Populated for every task; the On Hold column
	// reads it to show "Waiting for: …".
	DependsOnComponents []string `json:"dependsOnComponents,omitempty"`
	// ComponentName mirrors ComponentTask.ComponentName so the frontend
	// can resolve dep -> task lookups (e.g. "what is component `todo-api`'s
	// task currently doing while we wait?").
	ComponentName string `json:"componentName,omitempty"`
	// ErrorMessage mirrors ComponentTask.ErrorMessage. For a failed task
	// it's the diagnostic recorded for the failure, shown on the card so
	// the operator can decide whether to retry.
	ErrorMessage string `json:"errorMessage,omitempty"`
}

// ProjectBoard holds tasks grouped by their kanban column.
type ProjectBoard struct {
	URL        string      `json:"url"`
	Todo       []BoardTask `json:"todo"`
	InProgress []BoardTask `json:"inProgress"`
	Done       []BoardTask `json:"done"`
	OnHold     []BoardTask `json:"onHold"`
	Failed     []BoardTask `json:"failed"`
}

// BoardService fetches the kanban board for a project.
type BoardService interface {
	GetBoard(ctx context.Context, orgID, projectID string) (*ProjectBoard, error)
}

type boardService struct {
	repoBoardSvc gitrepo.RepoBoardService
	taskRepo     repositories.TaskRepository
}

func NewBoardService(repoBoardSvc gitrepo.RepoBoardService, taskRepo repositories.TaskRepository) BoardService {
	return &boardService{repoBoardSvc: repoBoardSvc, taskRepo: taskRepo}
}

func (s *boardService) GetBoard(ctx context.Context, orgID, projectID string) (*ProjectBoard, error) {
	board := &ProjectBoard{
		URL:        "",
		Todo:       []BoardTask{},
		InProgress: []BoardTask{},
		Done:       []BoardTask{},
		OnHold:     []BoardTask{},
		Failed:     []BoardTask{},
	}

	if s.repoBoardSvc == nil {
		return board, nil
	}

	result, err := s.repoBoardSvc.GetBoard(ctx, orgID, projectID)
	if err != nil {
		return nil, fmt.Errorf("get board: %w", err)
	}

	// Load DB tasks for enrichment.
	type taskDBMeta struct {
		id                  string
		lifecycleStatus     string
		status              string
		dispatchedAt        *time.Time
		execType            string
		dependsOnComponents []string
		componentName       string
		errorMessage        string
	}
	issueURLToMeta := map[string]taskDBMeta{}
	var allComponentTasks []models.ComponentTask
	// unissuedTasks are tasks with no IssueURL (gh_issue_waiting or gh_issue_failed).
	// They never appear on the GitHub Project board and must be surfaced separately.
	var unissuedTasks []models.ComponentTask
	if s.taskRepo != nil {
		if componentTasks, err := s.taskRepo.ListByProjectID(ctx, orgID, projectID); err == nil {
			allComponentTasks = componentTasks
			for _, ct := range componentTasks {
				if ct.IssueURL != "" {
					issueURLToMeta[ct.IssueURL] = taskDBMeta{
						id:                  ct.ID,
						lifecycleStatus:     ct.LifecycleStatus,
						status:              ct.Status,
						dispatchedAt:        ct.DispatchedAt,
						execType:            ct.ExecType,
						dependsOnComponents: []string(ct.DependsOnComponents),
						componentName:       ct.ComponentName,
						errorMessage:        ct.ErrorMessage,
					}
				} else {
					unissuedTasks = append(unissuedTasks, ct)
				}
			}
		}
	}

	cardURLs := make(map[string]bool, len(result.Items))
	for _, item := range result.Items {
		cardURLs[item.URL] = true
		task := BoardTask{
			ID:              item.ID,
			Title:           item.Title,
			URL:             item.URL,
			Description:     item.Body,
			Assignee:        item.Assignee,
			Labels:          item.Labels,
			LifecycleStatus: string(models.TaskLifecycleGhIssueCreated),
		}
		if meta, ok := issueURLToMeta[item.URL]; ok {
			task.ComponentTaskID = meta.id
			task.LifecycleStatus = meta.lifecycleStatus
			task.Status = meta.status
			task.DispatchedAt = meta.dispatchedAt
			task.ExecType = meta.execType
			task.DependsOnComponents = meta.dependsOnComponents
			task.ComponentName = meta.componentName
			task.ErrorMessage = meta.errorMessage
		}
		// The BFF's ComponentTask.Status is authoritative for kanban routing
		// of `on_hold` (dep-gated) and terminal failure states. Terminal
		// failure states must never be overridden by the GitHub board column
		// (which may not have been updated yet, e.g. when markFailed's
		// MoveIssueToStatus call fails).
		switch task.Status {
		case string(models.TaskStatusOnHold):
			board.OnHold = append(board.OnHold, task)
			continue
		case string(models.TaskStatusFailed),
			string(models.TaskStatusRejected),
			string(models.TaskStatusAbandoned):
			board.Failed = append(board.Failed, task)
			continue
		}
		switch normalizeStatus(item.Status) {
		case "in progress":
			board.InProgress = append(board.InProgress, task)
		case "done":
			board.Done = append(board.Done, task)
		case "on hold":
			board.OnHold = append(board.OnHold, task)
		case "failed":
			board.Failed = append(board.Failed, task)
		default:
			board.Todo = append(board.Todo, task)
		}
	}
	board.URL = result.URL

	// DB is the source of truth for task EXISTENCE. An issued task whose GitHub
	// Project CARD is missing — the board hasn't synced yet, or AddIssueToProject
	// failed after CreateIssue — has no matching item above and would otherwise
	// be invisible. Surface every issued task with no covering card straight from
	// the DB, routed by its own ComponentTask.Status; cards keep enriching the
	// tasks they DO cover. When the board is completely empty every issued task
	// is uncovered and renders here — the former whole-board DB fallback, now a
	// natural consequence rather than a special case.
	for i := range allComponentTasks {
		ct := &allComponentTasks[i]
		if ct.IssueURL == "" || cardURLs[ct.IssueURL] {
			continue // unissued (surfaced below) or already shown via its card
		}
		task := dbBoardTask(*ct)
		routeDBTaskByStatus(board, task, ct.Status)
	}

	// Always surface unissued tasks (gh_issue_waiting / gh_issue_failed) even
	// when the primary path is active. These have no IssueURL and are invisible
	// to the GitHub Project board.
	for _, ct := range unissuedTasks {
		task := BoardTask{
			ID:                  ct.ID,
			Title:               ct.Title,
			ComponentTaskID:     ct.ID,
			LifecycleStatus:     ct.LifecycleStatus,
			Status:              ct.Status,
			DispatchedAt:        ct.DispatchedAt,
			ExecType:            ct.ExecType,
			DependsOnComponents: []string(ct.DependsOnComponents),
			ComponentName:       ct.ComponentName,
			ErrorMessage:        ct.ErrorMessage,
		}
		if ct.LifecycleStatus == string(models.TaskLifecycleGhIssueFailed) {
			board.Failed = append(board.Failed, task)
		} else {
			board.Todo = append(board.Todo, task)
		}
	}

	return board, nil
}

func normalizeStatus(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

// dbBoardTask projects a ComponentTask row straight to a BoardTask for the
// DB-sourced paths (uncarded issued tasks + the empty-board case). It surfaces
// gh_issue_created as gh_issue_syncing so the frontend renders a skeleton
// instead of a labelless card while the GitHub Project card is still syncing.
// The syncing value is response-only — never written to DB.
func dbBoardTask(ct models.ComponentTask) BoardTask {
	labels := make([]gitrepo.LabelInfo, 0, len(ct.Labels))
	for _, l := range ct.Labels {
		labels = append(labels, gitrepo.LabelInfo{Name: l})
	}
	lifecycleStatus := ct.LifecycleStatus
	if lifecycleStatus == string(models.TaskLifecycleGhIssueCreated) {
		lifecycleStatus = string(models.TaskLifecycleGhIssueSyncing)
	}
	return BoardTask{
		ID:                  ct.ID,
		Title:               ct.Title,
		URL:                 ct.IssueURL,
		Description:         ct.Body,
		ComponentTaskID:     ct.ID,
		Labels:              labels,
		LifecycleStatus:     lifecycleStatus,
		Status:              ct.Status,
		DispatchedAt:        ct.DispatchedAt,
		ExecType:            ct.ExecType,
		DependsOnComponents: []string(ct.DependsOnComponents),
		ComponentName:       ct.ComponentName,
		ErrorMessage:        ct.ErrorMessage,
	}
}

// routeDBTaskByStatus appends a DB-sourced task to the column derived from its
// ComponentTask.Status. Kept identical to the original whole-board fallback so
// the empty-board projection is unchanged.
func routeDBTaskByStatus(board *ProjectBoard, task BoardTask, status string) {
	switch status {
	case "on_hold":
		board.OnHold = append(board.OnHold, task)
	case "in_progress":
		board.InProgress = append(board.InProgress, task)
	case "ready_for_review", "merged", "building", "deployed":
		board.Done = append(board.Done, task)
	case "failed", "rejected":
		board.Failed = append(board.Failed, task)
	default:
		board.Todo = append(board.Todo, task)
	}
}
