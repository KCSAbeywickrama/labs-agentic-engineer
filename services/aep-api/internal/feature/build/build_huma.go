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

// Package build is the public build surface (contract: build-project /
// get-project-build). POST validates the whole spec, cuts the single `v<N>`
// version tag, starts the dev workflow asynchronously, and returns the tag —
// the one-button successor to the requirements-save → design-save → devflow
// sequence. GET maps the workflow's live status onto the contract's
// BuildStatus.
package build

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/devflow"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/internal/platform/humakit"
	"github.com/wso2/aep/aep-api/models"
)

// Service backs the two build endpoints.
type Service struct {
	runner WorkflowRunner
	store  RunStore
	repos  RepoLookup
	tagger SpecTagger
	tasks  TaskReader
}

// Deps carries the service's ports.
type Deps struct {
	Runner WorkflowRunner
	Store  RunStore
	Repos  RepoLookup
	Tagger SpecTagger
	Tasks  TaskReader
}

// NewService wires the build service.
func NewService(d Deps) *Service {
	return &Service{runner: d.Runner, store: d.Store, repos: d.Repos, tagger: d.Tagger, tasks: d.Tasks}
}

// --- wire shapes (names drive the generated schema names — keep them exactly
// --- BuildRequest / BuildResponse / BuildStatus / BuildStatusTask) ----------

// BuildRequest is the (empty) build-project body.
type BuildRequest struct{}

// BuildResponse returns the spec version tag the build runs for.
type BuildResponse struct {
	Tag string `json:"tag"`
}

// BuildStatusTask is one task's progress inside a build. IssueNumber links the
// row to its GitHub issue (and the task-log stream) — the identity that
// replaced the old title-join.
type BuildStatusTask struct {
	IssueNumber int64  `json:"issueNumber"`
	Title       string `json:"title"`
	Status      string `json:"status" enum:"started,in_progress,completed,failed"`
}

// BuildStatus is the get-project-build response.
type BuildStatus struct {
	Status         string            `json:"status" enum:"started,in_progress,completed,failed"`
	WorkflowStatus string            `json:"workflow_status"`
	Tasks          []BuildStatusTask `json:"tasks,omitempty"`
}

// BuildTally is one build's frozen task counts (the dev run's own tally,
// written by the workflow — not a live task recount).
type BuildTally struct {
	Total  int64 `json:"total"`
	Done   int64 `json:"done"`
	Failed int64 `json:"failed"`
	Active int64 `json:"active"`
}

// BuildSummary is one entry of list-project-builds: the newest run for a spec
// version tag. Status shares get-project-build's vocabulary; a list read has
// no live workflow query, so "started" never occurs here.
type BuildSummary struct {
	Tag         string     `json:"tag"`
	Status      string     `json:"status" enum:"started,in_progress,completed,failed"`
	Tasks       BuildTally `json:"tasks"`
	StartedAt   time.Time  `json:"startedAt"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
}

// BuildList is the list-project-builds response, newest build first.
type BuildList struct {
	Builds []BuildSummary `json:"builds"`
}

type buildInput struct {
	humakit.OrgScopedInput
	ProjectName string `path:"projectName" doc:"Project name (DNS-label slug)"`
	Body        BuildRequest
}

type buildOutput struct {
	Body BuildResponse
}

type getBuildInput struct {
	humakit.OrgScopedInput
	ProjectName string `path:"projectName" doc:"Project name (DNS-label slug)"`
	Tag         string `path:"tag" doc:"Build tag"`
}

type getBuildOutput struct {
	Body BuildStatus
}

type listBuildsInput struct {
	humakit.OrgScopedInput
	ProjectName string `path:"projectName" doc:"Project name (DNS-label slug)"`
}

type listBuildsOutput struct {
	Body BuildList
}

// RegisterBuild registers the build surface on the code-first Huma API.
func RegisterBuild(api huma.API, svc *Service) {
	huma.Register(api, huma.Operation{
		OperationID: "build-project",
		Method:      http.MethodPost,
		Path:        "/projects/{projectName}/build",
		Summary:     "Trigger a project build",
		Tags:        []string{"Projects"},
		Security:    humakit.SecurityUserJWT,
		// 200, not 202: the tag in the body is the meaningful result (the
		// console REST client drops 202 bodies).
	}, svc.build)

	huma.Register(api, huma.Operation{
		OperationID: "get-project-build",
		Method:      http.MethodGet,
		Path:        "/projects/{projectName}/build/{tag}",
		Summary:     "Get project build status",
		Tags:        []string{"Projects"},
		Security:    humakit.SecurityUserJWT,
	}, svc.get)

	huma.Register(api, huma.Operation{
		OperationID: "list-project-builds",
		Method:      http.MethodGet,
		Path:        "/projects/{projectName}/builds",
		Summary:     "List project builds",
		Description: "One entry per built spec version tag, newest first — each the tag's newest run with its frozen task tally.",
		Tags:        []string{"Projects"},
		Security:    humakit.SecurityUserJWT,
	}, svc.list)
}

// build = validate spec → cut v<N> → start the dev workflow (async) → {tag}.
func (s *Service) build(ctx context.Context, in *buildInput) (*buildOutput, error) {
	// An unstartable workflow must never claim a version tag — probe first.
	if err := s.runner.Ready(); err != nil {
		return nil, huma.Error503ServiceUnavailable("temporal_unavailable")
	}
	// One dev workflow per project at a time.
	if running, lerr := s.store.RunningDevByProject(ctx, in.OrgHandle, in.ProjectName); lerr != nil {
		return nil, huma.Error500InternalServerError("lookup running build")
	} else if running != nil {
		return nil, huma.Error409Conflict("a build is already running for this project")
	}
	repo, err := s.repos.RepoFullName(ctx, in.OrgHandle, in.ProjectName)
	if err != nil {
		return nil, huma.Error404NotFound("project repository not found")
	}

	// The whole-spec hard gate runs INSIDE TagSpec, before the tag is cut —
	// the returned tag always names a validated requirements+design pair. An
	// unchanged spec returns the existing tag; the workflow still (re)runs.
	res, err := s.tagger.TagSpec(ctx, in.OrgHandle, in.ProjectName)
	if err != nil {
		return nil, mapTagError(err)
	}

	workflowID := devflow.DevWorkflowID(in.OrgHandle, in.ProjectName, res.Tag)
	runID, err := s.runner.StartBuild(ctx, workflowID, devflow.DevFlowInput{
		OrgID:     in.OrgHandle,
		ProjectID: in.ProjectName,
		Repo:      repo,
		Tag:       res.Tag,
		Gates:     devflow.GateConfig{}, // all gates auto
	})
	if err != nil {
		if errors.Is(err, ErrTemporalUnavailable) {
			return nil, huma.Error503ServiceUnavailable("temporal_unavailable")
		}
		return nil, huma.Error500InternalServerError("start build workflow: " + err.Error())
	}

	// Record the run row NOW so a status GET issued right after this response
	// never races the workflow's own RecordWorkflowRun activity (both upsert
	// the same (workflowID, runID) row). Best-effort: the activity re-records.
	if err := s.store.Record(ctx, &models.DevflowRun{
		WorkflowID: workflowID,
		RunID:      runID,
		Kind:       models.WorkflowKindDev,
		OrgID:      in.OrgHandle,
		ProjectID:  in.ProjectName,
		Tag:        res.Tag,
		Repo:       repo,
		Status:     models.WorkflowStatusRunning,
	}); err != nil {
		slog.WarnContext(ctx, "build: record workflow run failed (activity will re-record)",
			"workflowId", workflowID, "error", err)
	}

	slog.InfoContext(ctx, "build started",
		"org", in.OrgHandle, "project", in.ProjectName, "tag", res.Tag, "specStatus", res.Status)
	return &buildOutput{Body: BuildResponse{Tag: res.Tag}}, nil
}

// get maps the dev workflow's live status (or its workflow_runs row when the
// live query is unavailable) onto the contract's BuildStatus.
func (s *Service) get(ctx context.Context, in *getBuildInput) (*getBuildOutput, error) {
	workflowID := devflow.DevWorkflowID(in.OrgHandle, in.ProjectName, in.Tag)
	// The workflow_runs row is the org fence: no row under the caller's org ⇒ 404.
	row, err := s.store.GetByWorkflowID(ctx, in.OrgHandle, workflowID)
	if err != nil {
		return nil, huma.Error500InternalServerError("lookup build")
	}
	if row == nil {
		return nil, huma.Error404NotFound("build not found")
	}

	out := &getBuildOutput{}
	st, qerr := s.runner.BuildStatus(ctx, workflowID)
	if qerr != nil {
		// Live query unavailable (Temporal down, run archived) — degrade the
		// overall status to the indexed terminal row status, but STILL list the
		// build's tasks from the durable lineage read (an archived run no longer
		// answers a query, yet its planned issues are permanent).
		out.Body = BuildStatus{
			Status:         statusFromRow(row.Status),
			WorkflowStatus: row.Status,
			Tasks:          s.taskStatuses(ctx, in.OrgHandle, in.ProjectName, in.Tag, nil),
		}
		return out, nil
	}
	out.Body = BuildStatus{
		Status:         statusFromPhase(st.Phase),
		WorkflowStatus: st.Phase,
		Tasks:          s.taskStatuses(ctx, in.OrgHandle, in.ProjectName, in.Tag, st.Tasks),
	}
	return out, nil
}

// list enumerates the project's builds from the workflow_runs index alone (no
// live Temporal queries — the list must stay one cheap read). Rows arrive
// newest-first; a same-tag rebuild writes a second (workflowID, runID) row, so
// the first row seen per tag — its newest run — represents that build.
func (s *Service) list(ctx context.Context, in *listBuildsInput) (*listBuildsOutput, error) {
	rows, err := s.store.ListByProject(ctx, in.OrgHandle, in.ProjectName, models.WorkflowKindDev)
	if err != nil {
		return nil, huma.Error500InternalServerError("list builds")
	}
	seen := make(map[string]bool, len(rows))
	builds := make([]BuildSummary, 0, len(rows))
	for _, row := range rows {
		if row.Tag == "" || seen[row.Tag] {
			continue
		}
		seen[row.Tag] = true
		b := BuildSummary{
			Tag:       row.Tag,
			Status:    statusFromRow(row.Status),
			StartedAt: row.CreatedAt,
			Tasks: BuildTally{
				Total:  int64(row.TasksTotal),
				Done:   int64(row.TasksDone),
				Failed: int64(row.TasksFailed),
			},
		}
		// Active is computed, clamped so a lost total write can never render
		// negative (same rule as the overview's build stage).
		if active := row.TasksTotal - row.TasksDone - row.TasksFailed; active > 0 {
			b.Tasks.Active = int64(active)
		}
		if row.Status != models.WorkflowStatusRunning {
			completed := row.UpdatedAt
			b.CompletedAt = &completed
		}
		builds = append(builds, b)
	}
	return &listBuildsOutput{Body: BuildList{Builds: builds}}, nil
}

// taskStatuses builds the version's task list, DURABLE-first: the source is the
// lineage-tag read (every task stamped with this build's tag), so an archived
// run still answers with its full list and every row carries its issueNumber.
// The live workflow refs (empty for an archived/failed query) then REFINE the
// status of tasks still in flight. A durable-read hiccup degrades to whatever
// the workflow refs carry (numbered placeholders) — build status must never
// 500 because a GitHub read stumbled.
func (s *Service) taskStatuses(ctx context.Context, orgID, projectID, tag string, refs []devflow.DevTaskRef) []BuildStatusTask {
	byIssue := map[int]*BuildStatusTask{}
	order := make([]int, 0)

	// 1. Durable base: the tasks stamped with this build's lineage tag. The
	// aep:spec/<tag> label scopes the read server-side, so every returned row
	// already belongs to this version.
	if s.tasks != nil {
		views, err := s.tasks.ListByTag(ctx, orgID, projectID, "all", tag)
		if err != nil {
			slog.WarnContext(ctx, "build status: durable task read failed",
				"org", orgID, "project", projectID, "error", err)
		}
		for _, v := range views {
			bt := BuildStatusTask{
				IssueNumber: int64(v.IssueNumber),
				Title:       v.Title,
				Status:      statusFromDerived(v.DerivedStatus),
			}
			byIssue[v.IssueNumber] = &bt
			order = append(order, v.IssueNumber)
		}
	}

	// 2. In-flight refinement: the running workflow's own view of each task
	// wins while it is live; a ref for an issue the durable read has not yet
	// surfaced is appended as a numbered placeholder.
	for _, ref := range refs {
		if bt, ok := byIssue[ref.Issue]; ok {
			bt.Status = taskStatus(ref)
			continue
		}
		bt := BuildStatusTask{
			IssueNumber: int64(ref.Issue),
			Title:       fmt.Sprintf("Task #%d", ref.Issue),
			Status:      taskStatus(ref),
		}
		byIssue[ref.Issue] = &bt
		order = append(order, ref.Issue)
	}

	if len(order) == 0 {
		return nil
	}
	sort.Ints(order)
	out := make([]BuildStatusTask, 0, len(order))
	for _, n := range order {
		out = append(out, *byIssue[n])
	}
	return out
}

// mapTagError maps SaveSpec failures onto the edge vocabulary: the spec gate
// is a 422 carrying per-file detail; missing/not-ready repos are 404/409.
func mapTagError(err error) error {
	var se *artifacts.SpecValidationError
	switch {
	case errors.As(err, &se):
		details := make([]error, 0, len(se.Files))
		for _, f := range se.Files {
			details = append(details, &huma.ErrorDetail{
				Message:  f.Code + ": " + f.Message,
				Location: f.Path,
			})
		}
		return huma.Error422UnprocessableEntity("spec validation failed", details...)
	case errors.Is(err, gitrepo.ErrRepoNotFound):
		return huma.Error404NotFound("project repository not found")
	case errors.Is(err, gitrepo.ErrRepoNotReady):
		return huma.Error409Conflict("project repository is not ready yet")
	default:
		return huma.Error500InternalServerError("tag spec: " + err.Error())
	}
}
