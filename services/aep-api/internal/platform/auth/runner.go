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

// This file holds the runner-callback authorizer for the BFF's internal-S2S
// surface. RunnerAuthorizer is the internal analogue of the public edge's
// deny-by-default tenant gate: where that gate binds the org from a verified
// user JWT on /api, this binds it from a verified runner credential (BFF
// Task-JWT or publisher-cc) on /internal — "a request cannot act on an org it
// does not own", checked before any handler. It lives beside the token
// verifiers (TaskTokenManager, PublisherTokenVerifier) it drives — one auth
// home.

import (
	"context"
	"log/slog"
	"strings"

	"github.com/wso2/aep/aep-api/internal/platform/tenant"
)

// CycleOrgLookup returns the owning org handle of a run cycle. It is injected
// (from the composition root) so this package — the auth layer — never imports a
// feature package; it is needed only for the publisher-cc branch, which is
// org-scoped and must confirm the path cycle belongs to the token's org.
//
// The CYCLE is the runner's identity: every agent pod is launched by the
// milestone supervisor, which carries the cycle id to the pod and binds it into
// the bearer. A lookup that misses fails the request closed.
type CycleOrgLookup func(ctx context.Context, cycleID string) (orgHandle string, err error)

// RunnerAuthorizer verifies a runner-callback bearer and resolves the acting
// org. It is the inbound half of the symmetric S2S identity model — the
// analogue of the user-JWT verifier on the public edge — and the single home
// for the dual-token logic + the path↔identity fence (INT-6) that used to live
// inline in the task controller.
type RunnerAuthorizer struct {
	taskTokens *TaskTokenManager
	publisher  *PublisherTokenVerifier // may be nil (Task-JWT only)
	cycleOrg   CycleOrgLookup
}

// HTTPError is the neutral transport error the authorizer returns (401/403);
// the serving layer maps it onto its error envelope. Neutral on purpose: this
// package must not depend on any HTTP framework.
type HTTPError struct {
	Status  int
	Message string
}

func (e *HTTPError) Error() string { return e.Message }

// NewRunnerAuthorizer builds the authorizer. publisher may be nil (local dev
// without the platform IDP) — then only BFF Task-JWTs are accepted.
func NewRunnerAuthorizer(taskTokens *TaskTokenManager, publisher *PublisherTokenVerifier, cycleOrg CycleOrgLookup) *RunnerAuthorizer {
	return &RunnerAuthorizer{taskTokens: taskTokens, publisher: publisher, cycleOrg: cycleOrg}
}

// Authorize verifies authHeader for a runner callback scoped to cycleID and
// returns the verified caller. The BFF Task-JWT is tried first (BFF-signed and
// cycle-bound: the token's `taskId` claim — kept for wire compat, it carries the
// dispatched cycle id — MUST equal the path id, the INT-6 fence); then the
// publisher-cc token (org-bound: the path cycle MUST belong to the token's org).
// Returns an *HTTPError on any failure; the caller (the internal surface's auth
// gate) maps it onto its envelope.
func (a *RunnerAuthorizer) Authorize(ctx context.Context, authHeader, cycleID string) (tenant.Caller, error) {
	const prefix = "Bearer "
	if len(authHeader) <= len(prefix) || !strings.EqualFold(authHeader[:len(prefix)], prefix) {
		return tenant.Caller{}, &HTTPError{Status: 401, Message: "bearer token required"}
	}
	tok := authHeader[len(prefix):]

	// BFF Task-JWT first: signed by this BFF, cycle-bound by the INT-6 fence.
	if a.taskTokens != nil {
		if claims, err := a.taskTokens.Verify(tok); err == nil {
			if claims.TaskID != cycleID {
				slog.WarnContext(ctx, "runner callback: task bearer subject mismatch",
					"cycle", cycleID, "claimTaskId", claims.TaskID)
				return tenant.Caller{}, &HTTPError{Status: 403, Message: "task bearer does not match path"}
			}
			return tenant.Caller{
				Org:     tenant.OrgHandle(claims.OcOrgID),
				Subject: claims.TaskID,
				Source:  tenant.SourceTaskJWT,
			}, nil
		}
	}

	// Publisher client-credentials fallback: org-bound (the token's audience
	// embeds the org). Confirm the path cycle actually belongs to that org so an
	// org-A token cannot read/refresh an org-B cycle it merely names in the path.
	if a.publisher != nil {
		if claims, err := a.publisher.Verify(tok); err == nil {
			cycleOrg, lerr := a.cycleOrg(ctx, cycleID)
			if lerr != nil || cycleOrg == "" {
				slog.WarnContext(ctx, "runner callback: cycle lookup failed",
					"cycle", cycleID, "error", lerr)
				return tenant.Caller{}, &HTTPError{Status: 403, Message: "cycle not found"}
			}
			if cycleOrg != claims.OrgHandle {
				slog.WarnContext(ctx, "runner callback: publisher org mismatch",
					"cycle", cycleID, "cycleOrg", cycleOrg, "publisherOrg", claims.OrgHandle)
				return tenant.Caller{}, &HTTPError{Status: 403, Message: "publisher token does not match cycle org"}
			}
			return tenant.Caller{
				Org:    tenant.OrgHandle(claims.OrgHandle),
				Source: tenant.SourcePublisherCC,
			}, nil
		}
	}

	slog.WarnContext(ctx, "runner callback: bearer rejected by all verifiers", "cycle", cycleID)
	return tenant.Caller{}, &HTTPError{Status: 401, Message: "invalid bearer"}
}
