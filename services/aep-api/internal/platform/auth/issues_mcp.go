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

// This file holds the gate for the issue tools the AE Studio pod's Issues and
// issue agents act with (POST /internal/v1/ae-studio/projects/{projectName}/
// issues/mcp and .../issues/{issueNumber}/mcp). The credential is the org's
// ae-studio-<org> client token (StudioClientVerifier), presented by its AE
// Studio tools pod, and the org comes SOLELY from it. The project and, for an
// issue's agent, the issue come from the path: the pod forwards each chat's
// calls to the surface of the project its turn resolved, and of the issue the
// chat is about. The tools never take a project, an org or an issue number as
// an argument, so a model cannot name another.

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
)

// IssuesMCPScope is the org + project an issues MCP call is fenced to, and
// the one issue when the call is an issue's agent's. IssueNumber is 0 on the
// Issues view's surface.
type IssuesMCPScope struct {
	OrgID       string
	ProjectID   string
	IssueNumber int
}

type issuesMCPScopeCtxKey struct{}

// WithIssuesMCPScope returns a copy of ctx carrying scope. Set by
// IssuesMCPGate; read by the handler via IssuesMCPScopeFromContext.
func WithIssuesMCPScope(ctx context.Context, scope IssuesMCPScope) context.Context {
	return context.WithValue(ctx, issuesMCPScopeCtxKey{}, scope)
}

// IssuesMCPScopeFromContext returns the scope bound by IssuesMCPGate. ok is
// false when the request never passed the gate; the handler then fails
// closed.
func IssuesMCPScopeFromContext(ctx context.Context) (IssuesMCPScope, bool) {
	scope, ok := ctx.Value(issuesMCPScopeCtxKey{}).(IssuesMCPScope)
	return scope, ok
}

// IssuesMCPGate wraps next so it runs only for a verified, recorded
// ae-studio client token, with the scope bound onto the context: the org the
// verifier recorded for that client, the path's projectName, and the path's
// issueNumber when the route has one (a positive integer; anything else is a
// 404, as no such surface exists). Every credential refusal is the same 401
// with a generic body, the reason logged only; a recorded client that could
// not be read is a 503, as on MCP (MCPGate). A nil verifier refuses every
// call.
func IssuesMCPGate(studio *StudioClientVerifier, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		const prefix = "Bearer "
		header := r.Header.Get("Authorization")
		if len(header) <= len(prefix) || !strings.EqualFold(header[:len(prefix)], prefix) {
			slog.WarnContext(r.Context(), "issues mcp auth rejected", "reason", "bearer token required")
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		org, err := studio.Verify(r.Context(), header[len(prefix):])
		if errors.Is(err, ErrStudioClientLookup) {
			slog.ErrorContext(r.Context(), "issues mcp auth: ae-studio client lookup failed", "error", err)
			http.Error(w, "service unavailable", http.StatusServiceUnavailable)
			return
		}
		if err != nil {
			slog.WarnContext(r.Context(), "issues mcp auth rejected", "error", err)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		scope := IssuesMCPScope{OrgID: org, ProjectID: r.PathValue("projectName")}
		if scope.ProjectID == "" {
			http.NotFound(w, r)
			return
		}
		if raw := r.PathValue("issueNumber"); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < 1 {
				http.NotFound(w, r)
				return
			}
			scope.IssueNumber = n
		}
		next.ServeHTTP(w, r.WithContext(WithIssuesMCPScope(r.Context(), scope)))
	})
}
