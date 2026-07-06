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

package provisioning

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/platform/humakit"
	"github.com/wso2/aep/aep-api/models"
)

type accessRequestInput struct {
	humakit.OrgScopedInput
	ProjectName   string `path:"projectName" doc:"Consumer project name (DNS-label slug)"`
	ComponentName string `path:"componentName" doc:"Consumer component name"`
	DepName       string `path:"depName" doc:"org-service dependency name (the provider component)"`
}

type accessRequestsListInput struct {
	humakit.OrgScopedInput
	ProjectName string `path:"projectName" doc:"Consumer project name (DNS-label slug)"`
}

type accessRequestOutput struct{ Body *models.AccessRequest }
type accessRequestsOutput struct{ Body []models.AccessRequest }

// registerAccess registers the cross-project access-request operations. A nil
// service answers 503 (spec generation stays feature-complete).
func registerAccess(api huma.API, svc *Service) {
	huma.Register(api, huma.Operation{
		OperationID:   "request-org-service-access",
		Method:        http.MethodPost,
		Path:          "/projects/{projectName}/components/{componentName}/dependencies/{depName}/access-request",
		Summary:       "Request access to a cross-project org-service dependency",
		Tags:          []string{"Dependencies"},
		Security:      humakit.SecurityUserJWT,
		DefaultStatus: http.StatusCreated,
	}, func(ctx context.Context, in *accessRequestInput) (*accessRequestOutput, error) {
		if svc == nil {
			return nil, huma.Error503ServiceUnavailable("provisioning is not configured")
		}
		ar, err := svc.RequestAccess(ctx, in.OrgHandle, in.ProjectName, in.ComponentName, in.DepName)
		if err != nil {
			return nil, mapProvisionError(err)
		}
		return &accessRequestOutput{Body: ar}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "list-access-requests",
		Method:      http.MethodGet,
		Path:        "/projects/{projectName}/dependencies/access-requests",
		Summary:     "List a consumer project's access requests",
		Tags:        []string{"Dependencies"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *accessRequestsListInput) (*accessRequestsOutput, error) {
		if svc == nil {
			return nil, huma.Error503ServiceUnavailable("provisioning is not configured")
		}
		reqs, err := svc.ListAccessRequests(ctx, in.OrgHandle, in.ProjectName)
		if err != nil {
			return nil, mapProvisionError(err)
		}
		if reqs == nil {
			reqs = []models.AccessRequest{}
		}
		return &accessRequestsOutput{Body: reqs}, nil
	})
}
