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

// Shared in-package (UNIT) hand fakes for the task feature. The out-of-process
// GitHub API sits behind gitrepo.IssueService / RepoService / RepoBoardService
// and the agents-service behind agents.Client; those are the seams a task test
// programs per case (bff-component-testing.md §6). Unset function fields panic
// with the method name, matching the moq house style so a test that forgets to
// program a call fails loudly rather than nil-dereferencing.

import (
	"context"
	"io"
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/agents"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

// --- repositories.TaskRepository ---------------------------------------------

type fakeTaskRepo struct {
	GetByIDFunc              func(ctx context.Context, id string) (*models.ComponentTask, error)
	GetByIDScopedFunc        func(ctx context.Context, orgID, id string) (*models.ComponentTask, error)
	GetByComponentNameFunc   func(ctx context.Context, orgID, projectID, componentName string) (*models.ComponentTask, error)
	ListByProjectIDFunc      func(ctx context.Context, orgID, projectID string) ([]models.ComponentTask, error)
	ListNonTerminalByOrgIDFn func(ctx context.Context, orgID string) ([]models.ComponentTask, error)
	GetBaselineBatchFunc     func(ctx context.Context, orgID, projectID string) (string, string, string, error)
	CreateFunc               func(ctx context.Context, task *models.ComponentTask) error
	UpdateFunc               func(ctx context.Context, task *models.ComponentTask) error
	UpdateBodyFunc           func(ctx context.Context, id, body string) error
	SetBodySyncPendingFunc   func(ctx context.Context, id string, pending bool) error
	DeleteByProjectIDFunc    func(ctx context.Context, orgID, projectID string) error
	DeleteAllFunc            func(ctx context.Context) error
}

var _ repositories.TaskRepository = (*fakeTaskRepo)(nil)

func (f *fakeTaskRepo) GetByID(ctx context.Context, id string) (*models.ComponentTask, error) {
	if f.GetByIDFunc == nil {
		panic("fakeTaskRepo: GetByID not set")
	}
	return f.GetByIDFunc(ctx, id)
}
func (f *fakeTaskRepo) GetByIDScoped(ctx context.Context, orgID, id string) (*models.ComponentTask, error) {
	if f.GetByIDScopedFunc == nil {
		panic("fakeTaskRepo: GetByIDScoped not set")
	}
	return f.GetByIDScopedFunc(ctx, orgID, id)
}
func (f *fakeTaskRepo) GetByComponentName(ctx context.Context, orgID, projectID, componentName string) (*models.ComponentTask, error) {
	if f.GetByComponentNameFunc == nil {
		panic("fakeTaskRepo: GetByComponentName not set")
	}
	return f.GetByComponentNameFunc(ctx, orgID, projectID, componentName)
}
func (f *fakeTaskRepo) ListByProjectID(ctx context.Context, orgID, projectID string) ([]models.ComponentTask, error) {
	if f.ListByProjectIDFunc == nil {
		panic("fakeTaskRepo: ListByProjectID not set")
	}
	return f.ListByProjectIDFunc(ctx, orgID, projectID)
}
func (f *fakeTaskRepo) ListNonTerminalByOrgID(ctx context.Context, orgID string) ([]models.ComponentTask, error) {
	if f.ListNonTerminalByOrgIDFn == nil {
		panic("fakeTaskRepo: ListNonTerminalByOrgID not set")
	}
	return f.ListNonTerminalByOrgIDFn(ctx, orgID)
}
func (f *fakeTaskRepo) GetBaselineBatch(ctx context.Context, orgID, projectID string) (string, string, string, error) {
	if f.GetBaselineBatchFunc == nil {
		panic("fakeTaskRepo: GetBaselineBatch not set")
	}
	return f.GetBaselineBatchFunc(ctx, orgID, projectID)
}
func (f *fakeTaskRepo) Create(ctx context.Context, task *models.ComponentTask) error {
	if f.CreateFunc == nil {
		panic("fakeTaskRepo: Create not set")
	}
	return f.CreateFunc(ctx, task)
}
func (f *fakeTaskRepo) Update(ctx context.Context, task *models.ComponentTask) error {
	if f.UpdateFunc == nil {
		panic("fakeTaskRepo: Update not set")
	}
	return f.UpdateFunc(ctx, task)
}
func (f *fakeTaskRepo) UpdateBody(ctx context.Context, id, body string) error {
	if f.UpdateBodyFunc == nil {
		panic("fakeTaskRepo: UpdateBody not set")
	}
	return f.UpdateBodyFunc(ctx, id, body)
}
func (f *fakeTaskRepo) SetBodySyncPending(ctx context.Context, id string, pending bool) error {
	if f.SetBodySyncPendingFunc == nil {
		panic("fakeTaskRepo: SetBodySyncPending not set")
	}
	return f.SetBodySyncPendingFunc(ctx, id, pending)
}
func (f *fakeTaskRepo) DeleteByProjectID(ctx context.Context, orgID, projectID string) error {
	if f.DeleteByProjectIDFunc == nil {
		panic("fakeTaskRepo: DeleteByProjectID not set")
	}
	return f.DeleteByProjectIDFunc(ctx, orgID, projectID)
}
func (f *fakeTaskRepo) DeleteAll(ctx context.Context) error {
	if f.DeleteAllFunc == nil {
		panic("fakeTaskRepo: DeleteAll not set")
	}
	return f.DeleteAllFunc(ctx)
}

// --- gitrepo.IssueService ----------------------------------------------------

type fakeIssueSvc struct {
	CreateIssueFunc   func(ctx context.Context, orgID, projectID string, req gitrepo.CreateIssueRequest) (*gitrepo.IssueResult, error)
	ListIssuesFunc    func(ctx context.Context, orgID, projectID string, labels []string) ([]gitrepo.IssueInfo, error)
	CloseIssueFunc    func(ctx context.Context, orgID, projectID string, number int, comment string) error
	CommentIssueFunc  func(ctx context.Context, orgID, projectID string, number int, body string) error
	EditIssueBodyFunc func(ctx context.Context, orgID, projectID string, number int, body string) error
}

var _ gitrepo.IssueService = (*fakeIssueSvc)(nil)

func (f *fakeIssueSvc) CreateIssue(ctx context.Context, orgID, projectID string, req gitrepo.CreateIssueRequest) (*gitrepo.IssueResult, error) {
	if f.CreateIssueFunc == nil {
		panic("fakeIssueSvc: CreateIssue not set")
	}
	return f.CreateIssueFunc(ctx, orgID, projectID, req)
}
func (f *fakeIssueSvc) ListIssues(ctx context.Context, orgID, projectID string, labels []string) ([]gitrepo.IssueInfo, error) {
	if f.ListIssuesFunc == nil {
		panic("fakeIssueSvc: ListIssues not set")
	}
	return f.ListIssuesFunc(ctx, orgID, projectID, labels)
}
func (f *fakeIssueSvc) CloseIssue(ctx context.Context, orgID, projectID string, number int, comment string) error {
	if f.CloseIssueFunc == nil {
		panic("fakeIssueSvc: CloseIssue not set")
	}
	return f.CloseIssueFunc(ctx, orgID, projectID, number, comment)
}
func (f *fakeIssueSvc) CommentIssue(ctx context.Context, orgID, projectID string, number int, body string) error {
	if f.CommentIssueFunc == nil {
		panic("fakeIssueSvc: CommentIssue not set")
	}
	return f.CommentIssueFunc(ctx, orgID, projectID, number, body)
}
func (f *fakeIssueSvc) EditIssueBody(ctx context.Context, orgID, projectID string, number int, body string) error {
	if f.EditIssueBodyFunc == nil {
		panic("fakeIssueSvc: EditIssueBody not set")
	}
	return f.EditIssueBodyFunc(ctx, orgID, projectID, number, body)
}

// --- gitrepo.RepoBoardService ------------------------------------------------

type fakeRepoBoardSvc struct {
	GetBoardFunc          func(ctx context.Context, orgID, projectID string) (*gitrepo.ProjectBoardResult, error)
	MoveIssueToStatusFunc func(ctx context.Context, orgID, projectID, issueURL, targetStatus string) error
}

var _ gitrepo.RepoBoardService = (*fakeRepoBoardSvc)(nil)

func (f *fakeRepoBoardSvc) GetBoard(ctx context.Context, orgID, projectID string) (*gitrepo.ProjectBoardResult, error) {
	if f.GetBoardFunc == nil {
		panic("fakeRepoBoardSvc: GetBoard not set")
	}
	return f.GetBoardFunc(ctx, orgID, projectID)
}
func (f *fakeRepoBoardSvc) MoveIssueToStatus(ctx context.Context, orgID, projectID, issueURL, targetStatus string) error {
	if f.MoveIssueToStatusFunc == nil {
		panic("fakeRepoBoardSvc: MoveIssueToStatus not set")
	}
	return f.MoveIssueToStatusFunc(ctx, orgID, projectID, issueURL, targetStatus)
}

// --- gitrepo.RepoService (only GetRepo is consulted by the stream) -----------

type fakeRepoSvc struct {
	GetRepoFunc func(ctx context.Context, orgID, projectID string) (*models.GitRepository, error)
}

var _ gitrepo.RepoService = (*fakeRepoSvc)(nil)

func (f *fakeRepoSvc) GetRepo(ctx context.Context, orgID, projectID string) (*models.GitRepository, error) {
	if f.GetRepoFunc == nil {
		panic("fakeRepoSvc: GetRepo not set")
	}
	return f.GetRepoFunc(ctx, orgID, projectID)
}
func (f *fakeRepoSvc) CreateRepo(context.Context, string, string, string) (*models.GitRepository, error) {
	panic("fakeRepoSvc: CreateRepo not expected")
}
func (f *fakeRepoSvc) EnsureBareRepo(context.Context, string, string, string) (*models.GitRepository, error) {
	panic("fakeRepoSvc: EnsureBareRepo not expected")
}
func (f *fakeRepoSvc) SetWebhookID(context.Context, string, string, int64) error {
	panic("fakeRepoSvc: SetWebhookID not expected")
}
func (f *fakeRepoSvc) DeleteRepo(context.Context, string, string) error {
	panic("fakeRepoSvc: DeleteRepo not expected")
}

// --- agents.Client (only the tech-lead streams are used by task) -------------

type fakeAgents struct {
	StreamTechLeadPlanFunc   func(ctx context.Context, orgID string, req agents.TechLeadPlanRequest) (io.ReadCloser, error)
	StreamTechLeadDetailFunc func(ctx context.Context, orgID string, req agents.TechLeadDetailRequest) (io.ReadCloser, error)
}

var _ agents.Client = (*fakeAgents)(nil)

func (f *fakeAgents) StreamTechLeadPlan(ctx context.Context, orgID string, req agents.TechLeadPlanRequest) (io.ReadCloser, error) {
	if f.StreamTechLeadPlanFunc == nil {
		panic("fakeAgents: StreamTechLeadPlan not set")
	}
	return f.StreamTechLeadPlanFunc(ctx, orgID, req)
}
func (f *fakeAgents) StreamTechLeadDetail(ctx context.Context, orgID string, req agents.TechLeadDetailRequest) (io.ReadCloser, error) {
	if f.StreamTechLeadDetailFunc == nil {
		panic("fakeAgents: StreamTechLeadDetail not set")
	}
	return f.StreamTechLeadDetailFunc(ctx, orgID, req)
}
func (f *fakeAgents) StreamDocumentGeneration(context.Context, string, string, agents.DocumentGenerationRequest) (io.ReadCloser, error) {
	panic("fakeAgents: StreamDocumentGeneration not expected")
}
func (f *fakeAgents) StreamArchitect(context.Context, string, agents.ArchitectRequest) (io.ReadCloser, error) {
	panic("fakeAgents: StreamArchitect not expected")
}
func (f *fakeAgents) StreamRequirementsChat(context.Context, string, agents.RequirementsChatRequest) (io.ReadCloser, error) {
	panic("fakeAgents: StreamRequirementsChat not expected")
}
func (f *fakeAgents) RenderDsl(context.Context, string, string) (string, error) {
	panic("fakeAgents: RenderDsl not expected")
}

// --- task.SkillResolver ------------------------------------------------------

type fakeSkillResolver struct {
	ResolveManyFunc func(ctx context.Context, orgID string, names []string) ([]models.Skill, error)
}

var _ SkillResolver = (*fakeSkillResolver)(nil)

func (f *fakeSkillResolver) ResolveMany(ctx context.Context, orgID string, names []string) ([]models.Skill, error) {
	if f.ResolveManyFunc == nil {
		panic("fakeSkillResolver: ResolveMany not set")
	}
	return f.ResolveManyFunc(ctx, orgID, names)
}

// --- fixtures ----------------------------------------------------------------

// goldenTask returns a ComponentTask populated so its JSON field set matches the
// harvested testdata/harvest/golden/get_task.json exactly (sans the Huma $schema
// link the current handler no longer emits). The `omitempty` fields absent from
// the golden (dependsOnComponents, labels, buildAuthRetryCount, dispatchDeferredAt,
// bodySyncPending) are deliberately left zero so they drop from the wire shape.
func goldenTask() *models.ComponentTask {
	now := time.Date(2026, 7, 1, 6, 31, 29, 0, time.UTC)
	dispatched := time.Date(2026, 7, 1, 6, 13, 28, 0, time.UTC)
	batch := "163fb872-3c61-4882-9ef7-9879c3dd0e0a"
	cause := "build.deployed"
	return &models.ComponentTask{
		ID:                     "26de64b5-beb8-445d-9acf-de0811552744",
		ProjectID:              "web",
		OrgID:                  "acme",
		ComponentName:          "hello-api",
		Title:                  "Implement hello-api Go service with greeting endpoint",
		Rationale:              "Provide a single Go service that responds with Hello, World!",
		Body:                   "## Overview\n\nBuild hello-api.",
		BatchID:                &batch,
		SourceDesignVersion:    "v1-1",
		SourceSpecVersion:      "v1",
		Order:                  1,
		Status:                 string(models.TaskStatusDeployed),
		ExecType:               "WORKER",
		IssueURL:               "https://github.com/o/r/issues/1",
		IssueNumber:            1,
		LifecycleStatus:        string(models.TaskLifecycleGhIssueCreated),
		BranchName:             "feature/hello-api-greeting-endpoint",
		PullRequestNumber:      2,
		PullRequestURL:         "https://github.com/o/r/pull/2",
		MergeCommitSHA:         "1a57ed0877582f3ddfb065cb06334632d515dbde",
		LastEventAt:            &now,
		LastBuildRunName:       "hello-world-api-hello-api-1782887236864",
		LastBuildSHA:           "1a57ed0877582f3ddfb065cb06334632d515dbde",
		LastCodingAgentRunName: "ca-26de64b5-2607010613",
		Cause:                  &cause,
		DispatchedAt:           &dispatched,
		CreatedAt:              now,
		UpdatedAt:              now,
	}
}
