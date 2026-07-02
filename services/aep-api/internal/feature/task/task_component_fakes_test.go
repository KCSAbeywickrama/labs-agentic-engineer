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

// Component-tier (package task_test) hand fakes for the out-of-process seams the
// task/board HTTP surface drives. Only the methods a case programs are set; the
// rest panic loudly. (In-package unit fakes live in task_fakes_test.go; these are
// separate because the component tier is an external test package.)
package task_test

import (
	"context"

	"github.com/wso2/aep/aep-api/internal/contracts"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/internal/feature/task"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

// --- repositories.TaskRepository ---------------------------------------------

type compRepo struct {
	GetByIDScopedFunc   func(ctx context.Context, orgID, id string) (*models.ComponentTask, error)
	ListByProjectIDFunc func(ctx context.Context, orgID, projectID string) ([]models.ComponentTask, error)
}

var _ repositories.TaskRepository = (*compRepo)(nil)

func (r *compRepo) GetByIDScoped(ctx context.Context, orgID, id string) (*models.ComponentTask, error) {
	if r.GetByIDScopedFunc == nil {
		panic("compRepo: GetByIDScoped not set")
	}
	return r.GetByIDScopedFunc(ctx, orgID, id)
}
func (r *compRepo) ListByProjectID(ctx context.Context, orgID, projectID string) ([]models.ComponentTask, error) {
	if r.ListByProjectIDFunc == nil {
		panic("compRepo: ListByProjectID not set")
	}
	return r.ListByProjectIDFunc(ctx, orgID, projectID)
}
func (r *compRepo) GetByID(context.Context, string) (*models.ComponentTask, error) {
	panic("compRepo: GetByID not expected")
}
func (r *compRepo) GetByComponentName(context.Context, string, string, string) (*models.ComponentTask, error) {
	panic("compRepo: GetByComponentName not expected")
}
func (r *compRepo) ListNonTerminalByOrgID(context.Context, string) ([]models.ComponentTask, error) {
	panic("compRepo: ListNonTerminalByOrgID not expected")
}
func (r *compRepo) GetBaselineBatch(context.Context, string, string) (string, string, string, error) {
	panic("compRepo: GetBaselineBatch not expected")
}
func (r *compRepo) Create(context.Context, *models.ComponentTask) error {
	panic("compRepo: Create not expected")
}
func (r *compRepo) Update(context.Context, *models.ComponentTask) error {
	panic("compRepo: Update not expected")
}
func (r *compRepo) UpdateBody(context.Context, string, string) error {
	panic("compRepo: UpdateBody not expected")
}
func (r *compRepo) SetBodySyncPending(context.Context, string, bool) error {
	panic("compRepo: SetBodySyncPending not expected")
}
func (r *compRepo) DeleteByProjectID(context.Context, string, string) error {
	panic("compRepo: DeleteByProjectID not expected")
}
func (r *compRepo) DeleteAll(context.Context) error {
	panic("compRepo: DeleteAll not expected")
}

// --- task.TaskDispatcher -----------------------------------------------------

type compDispatcher struct {
	DispatchTasksFunc func(ctx context.Context, orgID, projectID string) ([]contracts.DispatchResult, error)
	RetryTaskFunc     func(ctx context.Context, taskID string) (contracts.DispatchResult, error)
}

var _ task.TaskDispatcher = (*compDispatcher)(nil)

func (d *compDispatcher) DispatchTasks(ctx context.Context, orgID, projectID string) ([]contracts.DispatchResult, error) {
	if d.DispatchTasksFunc == nil {
		panic("compDispatcher: DispatchTasks not set")
	}
	return d.DispatchTasksFunc(ctx, orgID, projectID)
}
func (d *compDispatcher) RetryTask(ctx context.Context, taskID string) (contracts.DispatchResult, error) {
	if d.RetryTaskFunc == nil {
		panic("compDispatcher: RetryTask not set")
	}
	return d.RetryTaskFunc(ctx, taskID)
}

// --- task.ProgressReader -----------------------------------------------------

type compProgress struct {
	GetAgentProgressFunc func(ctx context.Context, taskID string, sinceMillis int64, limit int) (*contracts.ProgressResponse, error)
	GetBuildProgressFunc func(ctx context.Context, taskID string, sinceMillis int64) (*contracts.ProgressResponse, error)
}

var _ task.ProgressReader = (*compProgress)(nil)

func (p *compProgress) GetAgentProgress(ctx context.Context, taskID string, sinceMillis int64, limit int) (*contracts.ProgressResponse, error) {
	if p.GetAgentProgressFunc == nil {
		panic("compProgress: GetAgentProgress not set")
	}
	return p.GetAgentProgressFunc(ctx, taskID, sinceMillis, limit)
}
func (p *compProgress) GetBuildProgress(ctx context.Context, taskID string, sinceMillis int64) (*contracts.ProgressResponse, error) {
	if p.GetBuildProgressFunc == nil {
		panic("compProgress: GetBuildProgress not set")
	}
	return p.GetBuildProgressFunc(ctx, taskID, sinceMillis)
}

// --- gitrepo.RepoBoardService ------------------------------------------------

type compBoard struct {
	GetBoardFunc func(ctx context.Context, orgID, projectID string) (*gitrepo.ProjectBoardResult, error)
}

var _ gitrepo.RepoBoardService = (*compBoard)(nil)

func (b *compBoard) GetBoard(ctx context.Context, orgID, projectID string) (*gitrepo.ProjectBoardResult, error) {
	if b.GetBoardFunc == nil {
		panic("compBoard: GetBoard not set")
	}
	return b.GetBoardFunc(ctx, orgID, projectID)
}
func (b *compBoard) MoveIssueToStatus(context.Context, string, string, string, string) error {
	panic("compBoard: MoveIssueToStatus not expected")
}

// --- gitrepo.IssueService (only ListIssues is consulted by GetTasks) ---------

type compIssues struct {
	ListIssuesFunc func(ctx context.Context, orgID, projectID string, labels []string) ([]gitrepo.IssueInfo, error)
}

var _ gitrepo.IssueService = (*compIssues)(nil)

func (i *compIssues) ListIssues(ctx context.Context, orgID, projectID string, labels []string) ([]gitrepo.IssueInfo, error) {
	if i.ListIssuesFunc == nil {
		panic("compIssues: ListIssues not set")
	}
	return i.ListIssuesFunc(ctx, orgID, projectID, labels)
}
func (i *compIssues) CreateIssue(context.Context, string, string, gitrepo.CreateIssueRequest) (*gitrepo.IssueResult, error) {
	panic("compIssues: CreateIssue not expected")
}
func (i *compIssues) CloseIssue(context.Context, string, string, int, string) error {
	panic("compIssues: CloseIssue not expected")
}
func (i *compIssues) CommentIssue(context.Context, string, string, int, string) error {
	panic("compIssues: CommentIssue not expected")
}
func (i *compIssues) EditIssueBody(context.Context, string, string, int, string) error {
	panic("compIssues: EditIssueBody not expected")
}
