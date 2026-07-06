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

package endpoints

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/platform/humakit"
	"github.com/wso2/aep/aep-api/models"
)

// --- Inputs / Outputs ---------------------------------------------------------
// Inputs embed humakit.OrgScopedInput: the active org is derived SOLELY from
// the verified token (no {orgHandle} path param).

// createAccessRequestInput is dep-addressed: the addressed dependency name IS
// the org-service name, so there is no request body (the source's
// orgServiceName body field is gone). The body may be empty.
type createAccessRequestInput struct {
	humakit.OrgScopedInput
	ProjectName   string `path:"projectName" doc:"Consumer project name (DNS-label slug)"`
	ComponentName string `path:"componentName" doc:"Consumer component requesting access"`
	DepName       string `path:"depName" doc:"Org-service dependency name (== provider component to publish org-wide)"`
}

type createAccessRequestOutput struct {
	Body *models.AccessRequest
}

type listAccessRequestsInput struct {
	humakit.OrgScopedInput
	ProjectName string `path:"projectName" doc:"Consumer project name (DNS-label slug)"`
}

type listAccessRequestsOutput struct {
	Body []models.AccessRequest
}

// RegisterAccess registers the cross-project access-request surface (P3.5): the
// dep-addressed create route (a consumer asks the provider project to publish a
// project-only org-service org-wide — creating or deduping onto the provider
// publish task + GitHub issue) and the consumer-side list. Handlers nil-guard
// the service to 503 so registration stays pure metadata.
func RegisterAccess(api huma.API, svc *AccessService) {
	huma.Register(api, huma.Operation{
		OperationID:   "create-access-request",
		Method:        http.MethodPost,
		Path:          "/projects/{projectName}/components/{componentName}/dependencies/{depName}/access-request",
		Summary:       "Request cross-project access to a project-only org-service dependency",
		Tags:          []string{"Dependencies"},
		Security:      humakit.SecurityUserJWT,
		DefaultStatus: http.StatusCreated,
	}, func(ctx context.Context, in *createAccessRequestInput) (*createAccessRequestOutput, error) {
		if svc == nil {
			return nil, huma.Error503ServiceUnavailable("access requests are not configured")
		}
		ar, err := svc.RequestAccess(ctx, RequestAccessInput{
			OrgHandle:         in.OrgHandle,
			ConsumerProject:   in.ProjectName,
			ConsumerComponent: in.ComponentName,
			DepName:           in.DepName,
		})
		if err != nil {
			return nil, mapAccessError(err)
		}
		return &createAccessRequestOutput{Body: ar}, nil
	})

	// Consumer-side list: every access request a project's components have
	// raised, newest first. The console reads this to render per-dependency
	// request status chips against the live design view.
	huma.Register(api, huma.Operation{
		OperationID: "list-access-requests",
		Method:      http.MethodGet,
		Path:        "/projects/{projectName}/dependencies/access-requests",
		Summary:     "List a project's cross-project access requests",
		Tags:        []string{"Dependencies"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *listAccessRequestsInput) (*listAccessRequestsOutput, error) {
		if svc == nil {
			return nil, huma.Error503ServiceUnavailable("access requests are not configured")
		}
		rows, err := svc.ListByConsumerProject(ctx, in.OrgHandle, in.ProjectName)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to list access requests", err)
		}
		if rows == nil {
			rows = []models.AccessRequest{}
		}
		return &listAccessRequestsOutput{Body: rows}, nil
	})
}

// mapAccessError translates the access sentinels into RFC 9457 problem
// responses: wrong-kind dep → 400 (its wrap message names the actual and the
// applicable kind), unknown dep → 404, unresolved org-service → 404, anything
// else → 500.
func mapAccessError(err error) error {
	switch {
	case errors.Is(err, ErrDepWrongKind):
		return huma.Error400BadRequest(err.Error())
	case errors.Is(err, ErrDepNotFound):
		return huma.Error404NotFound("dependency not found", err)
	case errors.Is(err, ErrOrgServiceNotFound):
		return huma.Error404NotFound("org service not found in catalog")
	default:
		return huma.Error500InternalServerError("failed to create access request", err)
	}
}
