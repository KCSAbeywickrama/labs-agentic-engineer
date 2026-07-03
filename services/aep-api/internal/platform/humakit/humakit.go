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

// Package humakit holds the shared Huma building blocks for the BFF's
// code-first OpenAPI surface (docs/design/bff-openapi-huma-migration.md): the
// org-scoped tenant gate expressed as an embeddable input + Resolver, the
// security-requirement constants, and the sentinel→RFC 9457 error mapper.
//
// The Huma API is mounted on the apiMux that is already wrapped by the JWT +
// orgensure middleware, so operations inherit user-JWT verification and JIT org
// provisioning. This package only adds the per-route tenant check that
// tenant.BindUserOrg used to apply as leaf-wrapping middleware.
package humakit

import (
	"log/slog"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/platform/auth"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
)

// The tenant gate mode is NOT process state: it rides the request context,
// stamped per-request by the composition root (api.mountSurfaces wraps the
// /api/ chain with tenant.WithGateMode(cfg mode)) and read here via
// tenant.GateModeFromContext, which defaults to ENFORCE when nothing stamped
// it. This replaced a package-global SetGateMode: the global raced under
// parallel component-test harness builds and let a test flip the gate for the
// whole process. bff-component-testing.md §8.3.

// APIV1 is the client-facing edge's version prefix, declared ONCE. It is passed
// to the humago adapter as its route prefix (humago.NewWithPrefix), which both
// prepends it to every operation's served route AND publishes it as the OpenAPI
// `servers` base URL — so Huma operations register server-relative paths (e.g.
// "/projects") and the version is never repeated in individual spec paths. A v2
// is a one-edit change here. Raw routes that bypass the adapter and need the
// absolute path (e.g. the GitHub OAuth redirect_uri) build on this constant
// directly. The internal S2S surface uses a separate /internal/v1 root (see
// api.internalV1 and the agents-client consts).
const APIV1 = "/api/v1"

// SecurityUserJWT is the OpenAPI security requirement for end-user Thunder JWT
// routes. Attach to every org-scoped + user-facing carve-out operation. (The
// internal S2S surface declares its own scheme — auth.SecurityRunner — on the
// separate internal Huma API.)
var SecurityUserJWT = []map[string][]string{{"userJWT": {}}}

// OrgScopedInput is embedded by every org-scoped operation's input struct.
// Embedding it makes the operation org-scoped-by-construction: its Resolve
// method IS the tenant gate. There is NO {orgHandle} path parameter — the
// active org is derived SOLELY from the verified JWT (never client-supplied),
// which closes the IDOR class by construction (a request cannot name an org it
// does not own). Resolve enforces that the token names an org and binds it onto
// OrgHandle for the handler. The arch-lock test asserts every org-scoped op
// embeds this and that OrgHandle carries no request-binding tag.
type OrgScopedInput struct {
	// OrgHandle is populated by Resolve from the verified token claims. It has
	// NO path/query/header tag, so Huma never reads it from the request — it is
	// server-set and read by the handler as the authorized tenant key.
	OrgHandle string `json:"-"`
}

var _ huma.Resolver = (*OrgScopedInput)(nil)

// Resolve enforces the tenant gate. It reads the verified JWT claims from the
// request context (populated by the upstream jwt middleware), requires a token
// that names an org (401 otherwise, in enforce mode), and binds that token org
// onto OrgHandle. There is no path org to compare against — deriving the org
// from the token alone makes a cross-org request unrepresentable.
func (i *OrgScopedInput) Resolve(ctx huma.Context) []error {
	c := ctx.Context()
	tokenOrg := auth.ResolveOuHandle(auth.ClaimsFromContext(c))

	if tokenOrg == "" {
		mode := tenant.GateModeFromContext(c)
		slog.WarnContext(c, "tenant gate would-deny",
			"reason", "no-org-claim", "mode", string(mode))
		if mode == tenant.GateModeEnforce {
			return []error{huma.Error401Unauthorized("authentication required")}
		}
		return nil
	}

	// Active org = the verified token org, never client input.
	i.OrgHandle = tokenOrg
	return nil
}

// ErrorFromStatus maps an HTTP status code to the matching Huma error, so
// handlers can translate sentinel-classified statuses (e.g. OpenChoreo
// pass-through) into RFC 9457 problem responses.
func ErrorFromStatus(status int, msg string) error {
	switch status {
	case 400:
		return huma.Error400BadRequest(msg)
	case 401:
		return huma.Error401Unauthorized(msg)
	case 403:
		return huma.Error403Forbidden(msg)
	case 404:
		return huma.Error404NotFound(msg)
	case 409:
		return huma.Error409Conflict(msg)
	default:
		return huma.Error500InternalServerError(msg)
	}
}
