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

// CredentialRequester is the internal-endpoint's view of the credential service.
// *CredentialService satisfies it.
type CredentialRequester interface {
	RequestCredentials(ctx context.Context, executionID, orgHandle string, req CredentialRequest) (*TestCredential, error)
}

type validationContextOutput struct{ Body *ValidationContextResponse }

// testCredentialsInput embeds the execution-scoped runner fence and carries the
// (all-optional) request hints. Embedding auth.ExecutionScopedInput makes the op
// runner-scoped-by-construction, exactly like the validation-context GET.
type testCredentialsInput struct {
	auth.ExecutionScopedInput
	Body struct {
		Role     string `json:"role,omitempty" doc:"Optional role the login should have (e.g. admin, user). Advisory until real user provisioning exists."`
		Purpose  string `json:"purpose,omitempty" doc:"Optional free-text purpose for the credential request."`
		Username string `json:"username,omitempty" doc:"Optional preferred username hint."`
	}
}

type testCredentialsOutput struct{ Body *TestCredential }

// RegisterInternalValidation registers the validation runner callbacks on the
// internal S2S Huma API: the validation-context fetch (deployed endpoints) and
// the on-demand test-credential request. Auth (dual-token verify + tenant fence)
// is by construction via auth.ExecutionScopedInput — keyed by the EXECUTION id
// the runner bearer is bound to, exactly like credentials/refresh (§9.2). The
// runner calls them with its AEP_TASK_ID (which carries the execution id).
func RegisterInternalValidation(api huma.API, svc ContextProvider, creds CredentialRequester) {
	huma.Register(api, huma.Operation{
		OperationID: "runner-validation-context",
		Method:      http.MethodGet,
		Path:        "/internal/v1/executions/{executionId}/validation-context",
		Summary:     "Fetch a validation run's deployed endpoints (runner callback)",
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

	// On-demand test credentials: the runner POSTs this only when a criterion
	// needs a login, with optional role/purpose/username hints. Returns a mock
	// account today (user provisioning is a follow-up); the request shape is the
	// contract real provisioning will honor. POST, not GET — a real provider
	// allocates/provisions a user (a mutation).
	huma.Register(api, huma.Operation{
		OperationID: "runner-validation-credentials",
		Method:      http.MethodPost,
		Path:        "/internal/v1/executions/{executionId}/test-credentials",
		Summary:     "Request test credentials for a validation run (runner callback)",
		Tags:        []string{"Internal"},
		Security:    auth.SecurityRunner,
	}, func(ctx context.Context, in *testCredentialsInput) (*testCredentialsOutput, error) {
		if creds == nil {
			return nil, huma.Error503ServiceUnavailable("validation credentials not configured")
		}
		resp, err := creds.RequestCredentials(ctx, in.ExecutionID, in.OrgHandle, CredentialRequest{
			Role:     in.Body.Role,
			Purpose:  in.Body.Purpose,
			Username: in.Body.Username,
		})
		if err != nil {
			if errors.Is(err, ErrExecutionNotFound) {
				return nil, huma.Error404NotFound("no validation task for this execution")
			}
			return nil, huma.Error500InternalServerError("failed to request test credentials")
		}
		return &testCredentialsOutput{Body: resp}, nil
	})
}
