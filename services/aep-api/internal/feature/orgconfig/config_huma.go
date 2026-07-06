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

// config_huma.go — code-first OpenAPI registration for the consolidated
// /config surface: the GET/PATCH singleton plus the four action routes. The
// active org is bound from the verified token (humakit.OrgScopedInput); there
// is no {orgHandle} path param. All handler logic lives in the Service — this
// file only maps HTTP <-> domain and translates SectionError into RFC-9457
// section-pointered problems.

package orgconfig

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/feature/idp"
	"github.com/wso2/aep/aep-api/internal/platform/auth"
	"github.com/wso2/aep/aep-api/internal/platform/humakit"
)

// --- Inputs / Outputs -------------------------------------------------------

type getConfigInput struct {
	humakit.OrgScopedInput
}

type patchConfigInput struct {
	humakit.OrgScopedInput
	Body ConfigPatch
}

type configOutput struct {
	Body *ConfigProjection
}

type startConnectInput struct {
	humakit.OrgScopedInput
	Body struct {
		InstallationID int64 `json:"installationId,omitempty" doc:"Optional installation to pin (set when the user picks a candidate from the 2+ picker)"`
	}
}

type startConnectOutput struct {
	Body struct {
		AuthorizeURL string `json:"authorizeUrl"`
	}
}

type disconnectInput struct {
	humakit.OrgScopedInput
	Uninstall bool `query:"uninstall" default:"true" doc:"App-mode only: when false, leave the install on GitHub for later re-adoption (defaults true)"`
}

type disconnectOutput struct {
	Body struct {
		Status string `json:"status"`
	}
}

type clientSecretOutput struct {
	Body struct {
		ClientSecret string `json:"clientSecret"`
	}
}

type discoverInput struct {
	humakit.OrgScopedInput
	Issuer string `query:"issuer" doc:"OIDC issuer URL to fetch the discovery document for"`
}

type discoverOutput struct {
	Body struct {
		Issuer  string `json:"issuer"`
		JWKSURL string `json:"jwksUrl"`
	}
}

// RegisterConfig registers the consolidated /config surface on the Huma API.
func RegisterConfig(api huma.API, svc *Service) {
	const base = "/config"

	huma.Register(api, huma.Operation{
		OperationID: "get-config",
		Method:      http.MethodGet,
		Path:        base,
		Summary:     "Get the organization's integration config (statuses/kinds, no secrets)",
		Tags:        []string{"Org Config"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *getConfigInput) (*configOutput, error) {
		proj, err := svc.Get(ctx, in.OrgHandle)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load config")
		}
		return &configOutput{Body: proj}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "update-config",
		Method:      http.MethodPatch,
		Path:        base,
		Summary:     "Patch the organization's integration config (per-section, atomic)",
		Tags:        []string{"Org Config"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *patchConfigInput) (*configOutput, error) {
		actor := auth.ActorFromContext(ctx)
		proj, err := svc.Patch(ctx, in.OrgHandle, actor, in.Body)
		if err != nil {
			return nil, mapPatchError(err)
		}
		return &configOutput{Body: proj}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "start-git-provider-connect",
		Method:      http.MethodPost,
		Path:        base + "/git-provider/connect-sessions",
		Summary:     "Start App-mode git-provider connect (OAuth-driven)",
		Tags:        []string{"Org Config"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *startConnectInput) (*startConnectOutput, error) {
		actor := auth.ActorFromContext(ctx)
		authorizeURL, err := svc.StartGitHubConnect(ctx, in.OrgHandle, actor, in.Body.InstallationID)
		if err != nil {
			if errors.Is(err, ErrGitHubAppNotConfigured) {
				return nil, huma.Error503ServiceUnavailable("github app oauth client not configured")
			}
			return nil, huma.Error500InternalServerError("could not start connect")
		}
		out := &startConnectOutput{}
		out.Body.AuthorizeURL = authorizeURL
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "disconnect-git-provider",
		Method:      http.MethodPost,
		Path:        base + "/git-provider/disconnect",
		Summary:     "Disconnect the git provider (cascade) for the org",
		Tags:        []string{"Org Config"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *disconnectInput) (*disconnectOutput, error) {
		connected, err := svc.DisconnectGitProvider(ctx, in.OrgHandle, in.Uninstall)
		if err != nil {
			return nil, huma.Error500InternalServerError("disconnect failed")
		}
		out := &disconnectOutput{}
		if connected {
			out.Body.Status = "disconnected"
		} else {
			out.Body.Status = "not_connected"
		}
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "rotate-idp-client-secret",
		Method:      http.MethodPost,
		Path:        base + "/idp/client-secret",
		Summary:     "Rotate the IDP publisher client secret (returned once)",
		Tags:        []string{"Org Config"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *getConfigInput) (*clientSecretOutput, error) {
		actor := auth.ActorFromContext(ctx)
		newSecret, err := svc.RotateIDPClientSecret(ctx, in.OrgHandle, actor)
		if err != nil {
			if errors.Is(err, idp.ErrIDPThunderUnavailable) {
				return nil, huma.Error503ServiceUnavailable("Thunder admin client not configured")
			}
			return nil, huma.Error500InternalServerError("failed to regenerate client secret")
		}
		out := &clientSecretOutput{}
		out.Body.ClientSecret = newSecret
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "discover-idp",
		Method:      http.MethodGet,
		Path:        base + "/idp/discovery",
		Summary:     "Discover an OIDC issuer's metadata",
		Tags:        []string{"Org Config"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *discoverInput) (*discoverOutput, error) {
		if in.Issuer == "" {
			return nil, huma.Error400BadRequest("issuer query param required")
		}
		issuerOut, jwksURL, err := svc.DiscoverIDP(ctx, in.Issuer)
		if err != nil {
			return nil, huma.Error502BadGateway(err.Error())
		}
		out := &discoverOutput{}
		out.Body.Issuer = issuerOut
		out.Body.JWKSURL = jwksURL
		return out, nil
	})
}

// mapPatchError turns a PATCH failure into an RFC-9457 problem. A SectionError
// carries the offending section, so the response includes a body.<section>
// location the console uses to highlight that form section; anything else
// collapses to an opaque 500 that never echoes the internal cause.
func mapPatchError(err error) error {
	var se *SectionError
	if errors.As(err, &se) {
		detail := &huma.ErrorDetail{Message: se.Message, Location: "body." + se.Section}
		switch se.Status {
		case http.StatusConflict:
			return huma.Error409Conflict(se.Message, detail)
		case http.StatusBadGateway:
			return huma.Error502BadGateway(se.Message, detail)
		default:
			return huma.Error422UnprocessableEntity(se.Message, detail)
		}
	}
	return huma.Error500InternalServerError("internal error")
}
