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

package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/wso2/asdlc/asdlc-service/internal/platform/humakit"
	"github.com/wso2/asdlc/asdlc-service/internal/platform/tenant"
	"github.com/wso2/asdlc/asdlc-service/middleware"
	jwtmw "github.com/wso2/asdlc/asdlc-service/middleware/jwt"
	"github.com/wso2/asdlc/asdlc-service/middleware/orgensure"
)

// mountSurfaces wires every HTTP surface onto one outer mux and returns it. This
// is the single screen that answers "what is exposed and who guards it" — the
// whole boundary of the BFF in one place. There are four request surfaces plus
// the unauthenticated discovery endpoints:
//
//	Surface        Root                 Guard (who may call)                       Where it lives / spec
//	───────────────────────────────────────────────────────────────────────────────────────────────────
//	public         /api/v1              Thunder user JWT + org gate                *_huma.go · humakit.OrgScopedInput
//	               (jwt → orgensure)    (org from the verified token, never input)  → api/openapi.yaml
//	internal S2S   /internal/v1/tasks/  BFF Task-JWT or publisher-cc               internal.go · scope.RunnerScopedInput
//	               (per-op resolver)    (dual-token verify + INT-6 fence)           → api/internal-openapi.yaml (non-public)
//	external       /api/v1/webhooks,    per-route bespoke: GitHub HMAC /           webhook_routes.go · org_github_routes.go
//	               .../github/connect    signed connect-state (org from payload)    (no generated spec; paths kept — Q4)
//	dev/test       /_dev/v1             none — registration-gated to dev tier      dev.go · RegisterAllDev
//	               (gated mount)        + on no HTTPRoute (loopback only)           (no spec)
//
//	discovery: /healthz, /auth/external/jwks.json, /openapi.yaml, /docs — public, no auth.
//
// The reusable identity primitive underneath both S2S directions: the BFF is the
// single issuer of org-bearing RS256 tokens (internal/platform/auth.TaskTokenManager
// — Issue inbound, IssueServiceToken outbound), all verified against the one
// JWKS at /auth/external/jwks.json. Org always travels in a verified claim,
// never a trusted header. See docs/design/internal-s2s-api.md.
//
// "Where do I change X?" → credential verify/mint: internal/platform/auth ·
// who-may-touch-what gates: humakit (public) + internal/auth/scope (internal) ·
// what's exposed: this file.
func mountSurfaces(params AppParams) *http.ServeMux {
	mux := http.NewServeMux()

	// ── discovery ────────────────────────────────────────────────────────────
	// Health check — unauthenticated. `/healthz` (k8s idiom) platform-wide.
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`)) //nolint:errcheck
	})

	// Task-JWT public key set (JWKS) — unauthenticated discovery, fetched by
	// every verifier before any auth. A plain handler (not a Huma op) so it stays
	// off the /api/v1 server base path: the public spec is now base-pathed at
	// /api/v1, and this endpoint deliberately lives outside that subtree.
	mux.HandleFunc("GET /auth/external/jwks.json", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if tt := params.HumaDeps.TaskTokens; tt != nil {
			_ = json.NewEncoder(w).Encode(tt.JWKS())
			return
		}
		_, _ = w.Write([]byte(`{"keys":[]}`))
	})

	// ── public edge (/api/v1) ────────────────────────────────────────────────
	// User-JWT authenticated (JWKS-backed RS256). Every org-scoped operation
	// embeds humakit.OrgScopedInput, whose Resolve derives the active org SOLELY
	// from the verified token (there is no {orgHandle} param) and applies the
	// tenant gate — the allowlist-by-construction IDOR fence. Carve-outs (org
	// listing, idp discover) read no org and bypass it. The Huma API is mounted
	// on apiMux so every op inherits the jwt + orgensure middleware applied to
	// "/api/" below; the public spec + docs are served on the outer mux.
	apiMux := http.NewServeMux()
	humakit.SetGateMode(tenant.ParseGateMode(params.Config.TenantGateMode))
	slog.Info("tenant gate active", "mode", string(tenant.ParseGateMode(params.Config.TenantGateMode)))
	humaAPI := newHumaAPI(apiMux)
	registerHumaDocs(mux, humaAPI)
	RegisterAllHuma(humaAPI, params.HumaDeps)

	// ── dev/test surface (/_dev/v1) ──────────────────────────────────────────
	// Local-only tooling, no request auth by design; safety is structural
	// (registration gate to the dev tier + on no HTTPRoute). All gating + handler
	// bodies live in dev.go. See docs/design/internal-s2s-api.md §3.4.
	RegisterAllDev(mux, params)

	// ── external-inbound (webhook + connect-callback) ────────────────────────
	// Callers are outside the platform (GitHub, a mid-OAuth browser); each route
	// keeps its own bespoke auth (HMAC / signed connect-state) and derives org
	// from the verified payload — not a session or service token. Both sit
	// outside the /api/ user-JWT wrapper via their more-specific patterns.
	if params.WebhookController != nil {
		registerWebhookRoutes(mux, params.WebhookController)
	}
	if params.OrgGitHubController != nil {
		registerConnectCallbackRoute(mux, params.OrgGitHubController)
	}

	// ── internal S2S surface (/internal/v1/tasks/) ───────────────────────────
	// Its own Huma API on its own mux, NOT wrapped by the /api/ user-JWT
	// middleware. Each operation authenticates by construction via
	// scope.RunnerScopedInput (BFF Task-JWT or publisher-cc) and is never
	// gateway-advertised. Mounted at /internal/v1/tasks/ so it owns only the
	// runner-callback subtree; the unscoped credentials route keeps its own mount
	// below. See docs/design/internal-s2s-api.md §3.
	internalMux := http.NewServeMux()
	internalAPI := newInternalAPI(internalMux)
	RegisterAllInternal(internalAPI, params.InternalDeps)
	mux.Handle(internalV1+"/tasks/", internalMux)

	// Unscoped per-task credentials refresh (Task-JWT only) — a legacy runner
	// path that retires with WS2.6; kept as a raw RequireTaskBearer-wrapped mount
	// until the runner stops calling it. Fail closed: only mounted when the
	// Task-JWT verifier is configured (set in every committed env).
	if params.TaskJWT != nil {
		taskMux := http.NewServeMux()
		if params.CredCtrl != nil {
			taskMux.HandleFunc("POST "+internalV1+"/credentials/refresh", params.CredCtrl.Refresh)
		}
		mux.Handle(internalV1+"/credentials/", middleware.RequireTaskBearer(params.TaskJWT)(taskMux))
	}

	// ── /api/ user-JWT wrapper ───────────────────────────────────────────────
	// JIT org-onboarding sits between JWT verification and the org-aware route
	// handlers. Tenants materialise on first authenticated request; no env var,
	// manifest, or seed names an org. See default-org-seed-removal.md §3.2.
	jwt := jwtmw.Middleware(jwtmw.Config{
		JWKS:                params.ThunderJWKS,
		AllowedIssuers:      splitAndTrim(params.Config.JWTAllowedIssuer),
		AllowedAudiences:    splitAndTrim(params.Config.JWTAllowedAudience),
		ResourceMetadataURL: params.Config.JWTResourceMetadataURL,
	})
	ensureOrg := orgensure.Middleware(params.OrganizationService)
	mux.Handle("/api/", jwt(ensureOrg(apiMux)))

	return mux
}
