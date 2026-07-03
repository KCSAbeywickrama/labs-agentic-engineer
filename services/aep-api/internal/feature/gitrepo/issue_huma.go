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

package gitrepo

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/platform/humakit"
)

// --- Inputs / Outputs ------------------------------------------------------
// Mirrors task_huma.go's convention: inputs embed humakit.OrgScopedInput
// (tenant gate, no {orgHandle} path param), ProjectName is a sibling path
// param that IS the project's slug/ID throughout this codebase (see
// task.ListTasks / task.GetTasks, which pass ProjectName straight through
// as "projectID").

type createIssueInput struct {
	humakit.OrgScopedInput
	ProjectName string `path:"projectName" doc:"Project name (DNS-label slug)"`
	Body        CreateIssueRequest
}

type listIssuesInput struct {
	humakit.OrgScopedInput
	ProjectName string `path:"projectName" doc:"Project name (DNS-label slug)"`
	Labels      string `query:"labels" doc:"Comma-separated GitHub labels to filter by"`
	Query       string `query:"q" doc:"Case-insensitive substring match against issue title/body, applied client-side after the GitHub label filter — used to dedup/find related issues before filing a new one"`
}

type issueOutput struct{ Body *IssueResult }
type issueListOutput struct{ Body []IssueInfo }

// RegisterIssue registers issue create/search operations on the Huma API.
// These back external handoffs — e.g. the OpenChoreo SRE/RCA agent files an
// issue here (and searches for related ones first) ahead of dispatching the
// coding agent via task.RegisterTask's dispatch-task-from-issue operation.
// See AE-HANDOFF-DESIGN.md (openchoreo/agents/sre-agent) for the end-to-end
// flow this supports.
func RegisterIssue(api huma.API, svc IssueService) {
	huma.Register(api, huma.Operation{
		OperationID: "create-issue",
		Method:      http.MethodPost,
		Path:        "/projects/{projectName}/issues",
		Summary:     "Create a GitHub issue on a project's repo",
		Tags:        []string{"Issues"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *createIssueInput) (*issueOutput, error) {
		if svc == nil {
			return nil, huma.Error503ServiceUnavailable("issue service not configured")
		}
		issue, err := svc.CreateIssue(ctx, in.OrgHandle, in.ProjectName, in.Body)
		if err != nil {
			if errors.Is(err, ErrRepoNotFound) {
				return nil, huma.Error404NotFound("project repo not found")
			}
			return nil, huma.Error500InternalServerError("failed to create issue")
		}
		return &issueOutput{Body: issue}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "list-issues",
		Method:      http.MethodGet,
		Path:        "/projects/{projectName}/issues",
		Summary:     "List/search GitHub issues on a project's repo",
		Tags:        []string{"Issues"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *listIssuesInput) (*issueListOutput, error) {
		if svc == nil {
			return nil, huma.Error503ServiceUnavailable("issue service not configured")
		}
		var labels []string
		if strings.TrimSpace(in.Labels) != "" {
			for _, l := range strings.Split(in.Labels, ",") {
				if l = strings.TrimSpace(l); l != "" {
					labels = append(labels, l)
				}
			}
		}
		issues, err := svc.ListIssues(ctx, in.OrgHandle, in.ProjectName, labels)
		if err != nil {
			if errors.Is(err, ErrRepoNotFound) {
				return nil, huma.Error404NotFound("project repo not found")
			}
			return nil, huma.Error500InternalServerError("failed to list issues")
		}

		q := strings.ToLower(strings.TrimSpace(in.Query))
		if q == "" {
			return &issueListOutput{Body: issues}, nil
		}
		filtered := make([]IssueInfo, 0, len(issues))
		for _, iss := range issues {
			if strings.Contains(strings.ToLower(iss.Title), q) || strings.Contains(strings.ToLower(iss.Body), q) {
				filtered = append(filtered, iss)
			}
		}
		return &issueListOutput{Body: filtered}, nil
	})
}
