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
	titles TaskTitles
}

// Deps carries the service's ports.
type Deps struct {
	Runner WorkflowRunner
	Store  RunStore
	Repos  RepoLookup
	Tagger SpecTagger
	Titles TaskTitles
}

// NewService wires the build service.
func NewService(d Deps) *Service {
	return &Service{runner: d.Runner, store: d.Store, repos: d.Repos, tagger: d.Tagger, titles: d.Titles}
}

// --- wire shapes (names drive the generated schema names — keep them exactly
// --- BuildRequest / BuildResponse / BuildStatus / BuildStatusTask) ----------

// BuildRequest is the (empty) build-project body.
type BuildRequest struct{}

// BuildResponse returns the spec version tag the build runs for.
type BuildResponse struct {
	Tag string `json:"tag"`
}

// BuildStatusTask is one task's progress inside a build.
type BuildStatusTask struct {
	Title  string `json:"title"`
	Status string `json:"status" enum:"started,in_progress,completed,failed"`
}

// BuildStatus is the get-project-build response.
type BuildStatus struct {
	Status         string            `json:"status" enum:"started,in_progress,completed,failed"`
	WorkflowStatus string            `json:"workflow_status"`
	Tasks          []BuildStatusTask `json:"tasks,omitempty"`
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
		// Live query unavailable (Temporal down, run archived) — degrade to the
		// indexed terminal status rather than failing the read.
		out.Body = BuildStatus{Status: statusFromRow(row.Status), WorkflowStatus: row.Status}
		return out, nil
	}
	out.Body = BuildStatus{
		Status:         statusFromPhase(st.Phase),
		WorkflowStatus: st.Phase,
		Tasks:          s.taskStatuses(ctx, in.OrgHandle, in.ProjectName, st.Tasks),
	}
	return out, nil
}

// taskStatuses joins the workflow's task refs (issue numbers) with the live
// issue titles. A title-fetch failure degrades to numbered placeholders —
// build status must never 500 because GitHub reads hiccuped.
func (s *Service) taskStatuses(ctx context.Context, orgID, projectID string, refs []devflow.DevTaskRef) []BuildStatusTask {
	if len(refs) == 0 {
		return nil
	}
	titles := map[int]string{}
	if s.titles != nil {
		views, err := s.titles.List(ctx, orgID, projectID, "all")
		if err != nil {
			slog.WarnContext(ctx, "build status: task title read failed",
				"org", orgID, "project", projectID, "error", err)
		}
		for _, v := range views {
			titles[v.IssueNumber] = v.Title
		}
	}
	out := make([]BuildStatusTask, 0, len(refs))
	for _, ref := range refs {
		title := titles[ref.Issue]
		if title == "" {
			title = fmt.Sprintf("Task #%d", ref.Issue)
		}
		out = append(out, BuildStatusTask{Title: title, Status: taskStatus(ref)})
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
