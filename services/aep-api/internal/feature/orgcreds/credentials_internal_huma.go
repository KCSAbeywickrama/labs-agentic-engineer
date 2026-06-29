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

package orgcreds

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/asdlc/asdlc-service/internal/auth/scope"
)

// runnerRefreshOutput is the runner credentials-refresh response. The Body
// field serializes directly (no envelope) — byte-compatible with the pre-Huma
// raw handler's utils.WriteSuccessResponse(RefreshResponse).
type runnerRefreshOutput struct{ Body *RefreshResponse }

// RegisterInternalCredentials registers the path-scoped runner credential
// refresh on the internal S2S Huma API. Auth (dual-token verify + INT-6 fence)
// is by construction via scope.RunnerScopedInput — same path + tokens as the
// old raw taskController.RefreshCredentials handler. The unscoped
// POST /internal/v1/credentials/refresh (Task-JWT only) stays a raw handler
// until the runner stops using it (WS2.6).
func RegisterInternalCredentials(api huma.API, svc CredentialsRefreshService) {
	huma.Register(api, huma.Operation{
		OperationID: "runner-refresh-credentials",
		Method:      http.MethodPost,
		Path:        "/internal/v1/tasks/{taskId}/credentials/refresh",
		Summary:     "Refresh a task's git credentials (runner callback)",
		Tags:        []string{"Internal"},
		Security:    scope.SecurityRunner,
	}, func(ctx context.Context, in *scope.RunnerScopedInput) (*runnerRefreshOutput, error) {
		if svc == nil {
			return nil, huma.Error503ServiceUnavailable("credentials refresh not configured")
		}
		resp, err := svc.Refresh(ctx, in.TaskID, in.OrgHandle)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to refresh credentials")
		}
		return &runnerRefreshOutput{Body: resp}, nil
	})
}
