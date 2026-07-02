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

package idp

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/clients/oidc"
	"github.com/wso2/aep/aep-api/internal/platform/auth"
	"github.com/wso2/aep/aep-api/internal/platform/humakit"
)

// --- Inputs / Outputs ------------------------------------------------------
// Org-scoped inputs embed humakit.OrgScopedInput, whose Resolve binds the active org from the verified token (no path param)
// and applies the tenant gate (the IDOR fence) by construction. Every op in
// this feature is org-gated, including the discovery helper.

type orgInput struct {
	humakit.OrgScopedInput
}

type updateProfileInput struct {
	humakit.OrgScopedInput
	Body struct {
		Kind    string `json:"kind" doc:"IDP kind: platform | asgardeo | custom"`
		Issuer  string `json:"issuer" doc:"OIDC issuer URL; empty leaves the existing value unchanged"`
		JWKSURL string `json:"jwksUrl" doc:"JWKS URL; empty leaves the existing value unchanged"`
	}
}

// discoverInput backs the IDP-picker helper used while editing the org IDP
// profile. It lives under /org/idp/discovery and embeds OrgScopedInput so it
// shares the same org-membership gate as its siblings — the org is unused by
// the handler (the result is a pure function of ?issuer), but gating keeps the
// whole /org/idp subtree behind one posture rather than a lone carve-out.
type discoverInput struct {
	humakit.OrgScopedInput
	Issuer string `query:"issuer" doc:"OIDC issuer URL to fetch the discovery document for"`
}

// profileOutput carries either the full IDP profile or, when no profile exists
// yet, a "no IDP configured" map (kind=null) — mirroring the legacy
// controller's 200-even-when-absent contract. Body is typed as any so a single
// operation models both branches.
type profileOutput struct{ Body any }

type clientSecretOutput struct {
	Body struct {
		ClientSecret string `json:"clientSecret"`
	}
}

type discoverOutput struct {
	Body struct {
		Issuer  string `json:"issuer"`
		JWKSURL string `json:"jwksUrl"`
	}
}

// RegisterIDP registers the IDP feature's HTTP operations on the Huma API,
// rooted at /api/v1/org/idp so the URL reads as org-scoped settings (the active
// org is still bound solely from the token — no path param). All ops are
// org-gated via OrgScopedInput, with the spec generated from the typed
// inputs/outputs.
func RegisterIDP(api huma.API, svc IDPService) {
	const base = "/org/idp"

	huma.Register(api, huma.Operation{
		OperationID: "get-idp-profile",
		Method:      http.MethodGet,
		Path:        base,
		Summary:     "Get the organization's IDP profile",
		Tags:        []string{"IDP"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *orgInput) (*profileOutput, error) {
		profile, err := svc.GetProfile(ctx, in.OrgHandle)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load IDP profile")
		}
		if profile == nil {
			return &profileOutput{Body: map[string]interface{}{
				"orgId":   in.OrgHandle,
				"kind":    nil,
				"message": "no IDP profile configured yet; first protected-component deploy provisions one",
			}}, nil
		}
		return &profileOutput{Body: profile}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "update-idp-profile",
		Method:      http.MethodPut,
		Path:        base,
		Summary:     "Update the organization's IDP profile",
		Tags:        []string{"IDP"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *updateProfileInput) (*profileOutput, error) {
		actor := auth.ActorFromContext(ctx)
		updated, err := svc.UpdateProfile(ctx, in.OrgHandle, actor, UpdateProfileRequest{
			Kind:    in.Body.Kind,
			Issuer:  in.Body.Issuer,
			JWKSURL: in.Body.JWKSURL,
		})
		if err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}
		return &profileOutput{Body: updated}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "regenerate-idp-client-secret",
		Method:      http.MethodPost,
		Path:        base + "/rotate",
		Summary:     "Rotate the publisher client secret",
		Tags:        []string{"IDP"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *orgInput) (*clientSecretOutput, error) {
		actor := auth.ActorFromContext(ctx)
		newSecret, err := svc.RegenerateClientSecret(ctx, in.OrgHandle, actor)
		if err != nil {
			if errors.Is(err, ErrIDPThunderUnavailable) {
				return nil, huma.Error503ServiceUnavailable("Thunder admin client not configured")
			}
			return nil, huma.Error500InternalServerError("failed to regenerate client secret")
		}
		out := &clientSecretOutput{}
		out.Body.ClientSecret = newSecret
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "discover-idp-issuer",
		Method:      http.MethodGet,
		Path:        base + "/discovery",
		Summary:     "Discover an OIDC issuer's metadata",
		Tags:        []string{"IDP"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *discoverInput) (*discoverOutput, error) {
		if in.Issuer == "" {
			return nil, huma.Error400BadRequest("issuer query param required")
		}
		md, err := oidc.DiscoverFromIssuer(ctx, in.Issuer)
		if err != nil {
			return nil, huma.Error502BadGateway(err.Error())
		}
		out := &discoverOutput{}
		out.Body.Issuer = md.Issuer
		out.Body.JWKSURL = md.JWKSURI
		return out, nil
	})
}
