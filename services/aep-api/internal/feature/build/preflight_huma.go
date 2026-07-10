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

package build

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/platform/humakit"
)

type getPreflightInput struct {
	humakit.OrgScopedInput
	ProjectName string `path:"projectName" doc:"Project name (DNS-label slug)"`
}

type getPreflightOutput struct {
	Body BuildPreflight
}

// RegisterPreflight registers the build dependency-drawer preflight surface.
// A nil service registers the route but answers 503 (so code-first spec
// generation still emits the surface with the feature unwired — mirrors
// provisioning.RegisterResources).
func RegisterPreflight(api huma.API, svc *PreflightService) {
	huma.Register(api, huma.Operation{
		OperationID: "get-build-preflight",
		Method:      http.MethodGet,
		Path:        "/projects/{projectName}/build/preflight",
		Summary:     "Compute the build dependency-drawer preflight",
		Tags:        []string{"Projects"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *getPreflightInput) (*getPreflightOutput, error) {
		if svc == nil {
			return nil, huma.Error503ServiceUnavailable("build preflight is not configured")
		}
		pf, err := svc.Preflight(ctx, in.OrgHandle, in.ProjectName)
		if err != nil {
			return nil, huma.Error500InternalServerError("compute build preflight: " + err.Error())
		}
		return &getPreflightOutput{Body: pf}, nil
	})
}
