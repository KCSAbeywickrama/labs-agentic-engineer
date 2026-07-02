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

package project

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/platform/humakit"
	"github.com/wso2/aep/aep-api/internal/platform/ocerr"
	"github.com/wso2/aep/aep-api/models"
)

// --- Inputs / Outputs ------------------------------------------------------
// Inputs embed humakit.OrgScopedInput, whose Resolve binds the active org from the verified token (no {orgHandle} path param) and applies
// the tenant gate (the IDOR fence) by construction.

type listProjectsInput struct {
	humakit.OrgScopedInput
	Cursor string `query:"cursor" doc:"Opaque pagination cursor"`
}

type orgProjectInput struct {
	humakit.OrgScopedInput
	ProjectName string `path:"projectName" doc:"Project name (DNS-label slug)"`
}

type createProjectInput struct {
	humakit.OrgScopedInput
	Body models.CreateProjectRequest
}

type projectListOutput struct{ Body *models.ProjectList }
type projectOutput struct{ Body *models.Project }
type projectStatusOutput struct{ Body *models.ProjectStatus }
type emptyOutput struct{}

// RegisterProject registers the project feature's HTTP operations on the Huma
// API. It is the code-first replacement for registerProjectRoutes
// (api/project_routes.go): same paths, same auth posture, with the spec
// generated from the typed inputs/outputs.
func RegisterProject(api huma.API, svc ProjectService) {
	huma.Register(api, huma.Operation{
		OperationID: "list-projects",
		Method:      http.MethodGet,
		Path:        "/projects",
		Summary:     "List projects",
		Tags:        []string{"Projects"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *listProjectsInput) (*projectListOutput, error) {
		list, err := svc.ListProjects(ctx, in.OrgHandle, 100, in.Cursor)
		if err != nil {
			return nil, mapProjectError(err)
		}
		return &projectListOutput{Body: list}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID:   "create-project",
		Method:        http.MethodPost,
		Path:          "/projects",
		Summary:       "Create a project",
		Tags:          []string{"Projects"},
		Security:      humakit.SecurityUserJWT,
		DefaultStatus: http.StatusCreated,
	}, func(ctx context.Context, in *createProjectInput) (*projectOutput, error) {
		if in.Body.Name == "" {
			return nil, huma.Error400BadRequest("name is required")
		}
		p, err := svc.CreateProject(ctx, in.OrgHandle, &in.Body)
		if err != nil {
			return nil, mapProjectError(err)
		}
		return &projectOutput{Body: p}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-project",
		Method:      http.MethodGet,
		Path:        "/projects/{projectName}",
		Summary:     "Get a project",
		Tags:        []string{"Projects"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *orgProjectInput) (*projectOutput, error) {
		p, err := svc.GetProject(ctx, in.OrgHandle, in.ProjectName)
		if err != nil {
			return nil, mapProjectError(err)
		}
		return &projectOutput{Body: p}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID:   "delete-project",
		Method:        http.MethodDelete,
		Path:          "/projects/{projectName}",
		Summary:       "Delete a project",
		Tags:          []string{"Projects"},
		Security:      humakit.SecurityUserJWT,
		DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *orgProjectInput) (*emptyOutput, error) {
		if err := svc.DeleteProject(ctx, in.OrgHandle, in.ProjectName); err != nil {
			return nil, mapProjectError(err)
		}
		return &emptyOutput{}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-project-status",
		Method:      http.MethodGet,
		Path:        "/projects/{projectName}/status",
		Summary:     "Get a project's SDLC status",
		Tags:        []string{"Projects"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *orgProjectInput) (*projectStatusOutput, error) {
		st, err := svc.GetProjectStatus(ctx, in.OrgHandle, in.ProjectName)
		if err != nil {
			return nil, mapProjectError(err)
		}
		return &projectStatusOutput{Body: st}, nil
	})
}

// mapProjectError translates project + OpenChoreo sentinel errors into RFC 9457
// problem responses. The feature sentinels (translated from OC by the service's
// translateHTTPError) carry the fixed user-facing messages; any remaining raw
// OC sentinel rides the shared ocerr classifier.
func mapProjectError(err error) error {
	switch {
	case errors.Is(err, ErrUnauthorized) || errors.Is(err, openchoreo.ErrUnauthorized):
		return huma.Error401Unauthorized("invalid or expired token")
	case errors.Is(err, ErrProjectNotFound):
		return huma.Error404NotFound("project not found")
	case errors.Is(err, ErrForbidden):
		return huma.Error403Forbidden("insufficient permissions to perform this action")
	}
	if status, ok := ocerr.Status(err); ok {
		return humakit.ErrorFromStatus(status, err.Error())
	}
	return huma.Error500InternalServerError("internal error")
}
