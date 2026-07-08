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

package validation

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/platform/auth"
)

// ContextProvider is the internal-endpoint's view of the context service.
// *ContextService satisfies it.
type ContextProvider interface {
	ValidationContext(ctx context.Context, executionID, orgHandle string) (*ValidationContextResponse, error)
}

type validationContextOutput struct{ Body *ValidationContextResponse }

// RegisterInternalValidation registers the runner's validation-context fetch on
// the internal S2S Huma API. Auth (dual-token verify + tenant fence) is by
// construction via auth.ExecutionScopedInput — keyed by the EXECUTION id the
// runner bearer is bound to, exactly like credentials/refresh (§9.2). The
// runner calls it with its AEP_TASK_ID (which carries the execution id).
func RegisterInternalValidation(api huma.API, svc ContextProvider) {
	huma.Register(api, huma.Operation{
		OperationID: "runner-validation-context",
		Method:      http.MethodGet,
		Path:        "/internal/v1/executions/{executionId}/validation-context",
		Summary:     "Fetch a validation run's deployed endpoints + test credentials (runner callback)",
		Tags:        []string{"Internal"},
		Security:    auth.SecurityRunner,
	}, func(ctx context.Context, in *auth.ExecutionScopedInput) (*validationContextOutput, error) {
		if svc == nil {
			return nil, huma.Error503ServiceUnavailable("validation context not configured")
		}
		resp, err := svc.ValidationContext(ctx, in.ExecutionID, in.OrgHandle)
		if err != nil {
			if errors.Is(err, ErrExecutionNotFound) {
				return nil, huma.Error404NotFound("no validation task for this execution")
			}
			return nil, huma.Error500InternalServerError("failed to resolve validation context")
		}
		return &validationContextOutput{Body: resp}, nil
	})
}
