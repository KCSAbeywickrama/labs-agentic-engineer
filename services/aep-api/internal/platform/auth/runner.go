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

package auth

// This file holds the by-construction tenant gate for the BFF's internal-S2S
// Huma surface — an embeddable input struct whose Resolve method IS the scope
// check. RunnerScopedInput is the internal-S2S analogue of humakit.OrgScopedInput:
// where OrgScopedInput binds the org from a verified user JWT on /api, this
// binds it from a verified runner credential on /internal. Both express
// "a request cannot act on an org it does not own" as a type, not a per-handler
// check. It lives beside the token verifiers (TaskTokenManager,
// PublisherTokenVerifier) it drives — one auth home. See docs/design/internal-s2s-api.md §3.

import (
	"context"
	"log/slog"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/platform/tenant"
)

// SecurityRunner is the OpenAPI security requirement for runner-facing internal
// operations: a BFF-signed per-task JWT OR a Thunder publisher client-
// credentials token (the list expresses OR). RunnerAuthorizer accepts either.
var SecurityRunner = []map[string][]string{{"taskJWT": {}}, {"publisherCC": {}}}

// TaskOrgLookup returns the owning org handle of a task. It is injected (from
// the task service) so this package — the auth layer — never imports a feature
// package; it is needed only for the publisher-cc branch, which is org-scoped
// and must confirm the path task belongs to the token's org.
type TaskOrgLookup func(ctx context.Context, taskID string) (orgHandle string, err error)

// RunnerAuthorizer verifies a runner-callback bearer and resolves the acting
// org. It is the inbound half of the symmetric S2S identity model — the
// analogue of the user-JWT verifier on the public edge — and the single home
// for the dual-token logic + the path↔identity fence (INT-6) that used to live
// inline in the task controller.
type RunnerAuthorizer struct {
	taskTokens *TaskTokenManager
	publisher  *PublisherTokenVerifier // may be nil (Task-JWT only)
	taskOrg    TaskOrgLookup
}

// NewRunnerAuthorizer builds the authorizer. publisher may be nil (local dev
// without the platform IDP) — then only BFF Task-JWTs are accepted.
func NewRunnerAuthorizer(taskTokens *TaskTokenManager, publisher *PublisherTokenVerifier, taskOrg TaskOrgLookup) *RunnerAuthorizer {
	return &RunnerAuthorizer{taskTokens: taskTokens, publisher: publisher, taskOrg: taskOrg}
}

// Authorize verifies authHeader for a runner callback scoped to taskID and
// returns the verified caller. The BFF Task-JWT is tried first (BFF-signed,
// task-bound: the claim's taskId MUST equal the path taskID — the INT-6 fence);
// then the publisher-cc token (org-bound: the path task MUST belong to the
// token's org). Returns a huma error on any failure, mapped straight to the
// response by the resolver.
func (a *RunnerAuthorizer) Authorize(ctx context.Context, authHeader, taskID string) (tenant.Caller, error) {
	const prefix = "Bearer "
	if len(authHeader) <= len(prefix) || !strings.EqualFold(authHeader[:len(prefix)], prefix) {
		return tenant.Caller{}, huma.Error401Unauthorized("bearer token required")
	}
	tok := authHeader[len(prefix):]

	// BFF Task-JWT first: signed by this BFF, task-bound by the INT-6 fence.
	if a.taskTokens != nil {
		if claims, err := a.taskTokens.Verify(tok); err == nil {
			if claims.TaskID != taskID {
				slog.WarnContext(ctx, "runner callback: task bearer subject mismatch",
					"task", taskID, "claimTaskId", claims.TaskID)
				return tenant.Caller{}, huma.Error403Forbidden("task bearer does not match path")
			}
			return tenant.Caller{
				Org:     tenant.OrgHandle(claims.OcOrgID),
				Subject: claims.TaskID,
				Source:  tenant.SourceTaskJWT,
			}, nil
		}
	}

	// Publisher client-credentials fallback: org-bound (the token's audience
	// embeds the org). Confirm the path task actually belongs to that org so an
	// org-A token cannot read/refresh an org-B task it merely names in the path.
	if a.publisher != nil {
		if claims, err := a.publisher.Verify(tok); err == nil {
			taskOrg, lerr := a.taskOrg(ctx, taskID)
			if lerr != nil || taskOrg == "" {
				slog.WarnContext(ctx, "runner callback: task lookup failed",
					"task", taskID, "error", lerr)
				return tenant.Caller{}, huma.Error403Forbidden("task not found")
			}
			if taskOrg != claims.OrgHandle {
				slog.WarnContext(ctx, "runner callback: publisher org mismatch",
					"task", taskID, "taskOrg", taskOrg, "publisherOrg", claims.OrgHandle)
				return tenant.Caller{}, huma.Error403Forbidden("publisher token does not match task org")
			}
			return tenant.Caller{
				Org:    tenant.OrgHandle(claims.OrgHandle),
				Source: tenant.SourcePublisherCC,
			}, nil
		}
	}

	slog.WarnContext(ctx, "runner callback: bearer rejected by all verifiers", "task", taskID)
	return tenant.Caller{}, huma.Error401Unauthorized("invalid bearer")
}

// runnerAuthorizer is the process-wide authorizer used by RunnerScopedInput.
// Resolve. Set once at wiring via SetRunnerAuthorizer (from app.Build only —
// never from a test harness, so there are no concurrent writes) — it lets
// RunnerScopedInput stay a dependency-free embeddable input (Huma constructs
// it per request from the zero value, so it cannot carry injected services
// itself).
var runnerAuthorizer *RunnerAuthorizer

// SetRunnerAuthorizer wires the authorizer at composition time.
func SetRunnerAuthorizer(a *RunnerAuthorizer) { runnerAuthorizer = a }

// RunnerScopedInput is embedded by every internal runner-callback operation.
// Embedding it makes the op runner-scoped-by-construction: Resolve verifies the
// per-task bearer (dual-token) and enforces the path↔identity fence, then binds
// the acting org onto OrgHandle for the handler — exactly as
// humakit.OrgScopedInput does for the public edge, but for the internal S2S
// surface. There is no org path/query/header param: the org is derived solely
// from the verified credential.
type RunnerScopedInput struct {
	TaskID    string `path:"taskId" doc:"Task id the runner callback is scoped to"`
	OrgHandle string `json:"-"` // server-set from the verified caller
}

var _ huma.Resolver = (*RunnerScopedInput)(nil)

// Resolve runs the runner authorizer against the request's bearer + path
// taskId, then binds the resolved org onto OrgHandle. A failed authorization
// becomes the corresponding huma error (401/403). It never runs during spec
// generation (resolvers fire only on real requests), so the nil-authorizer
// branch is a wiring guard, not a hot path.
func (i *RunnerScopedInput) Resolve(ctx huma.Context) []error {
	if runnerAuthorizer == nil {
		return []error{huma.Error503ServiceUnavailable("runner auth not configured")}
	}
	caller, err := runnerAuthorizer.Authorize(ctx.Context(), ctx.Header("Authorization"), i.TaskID)
	if err != nil {
		return []error{err}
	}
	i.OrgHandle = string(caller.Org)
	return nil
}
