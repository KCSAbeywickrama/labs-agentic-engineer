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

package design

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/platform/humakit"
	"github.com/wso2/aep/aep-api/models"
)

// --- Inputs / Outputs ------------------------------------------------------
// Inputs embed humakit.OrgScopedInput, whose Resolve binds the active org from the verified token (no {orgHandle} path param) and applies
// the tenant gate (the IDOR fence) by construction. Sibling path params
// (projectName, tag) are plain fields with path tags.

type designProjectInput struct {
	humakit.OrgScopedInput
	ProjectName string `path:"projectName" doc:"Project name (DNS-label slug)"`
}

type designTagInput struct {
	humakit.OrgScopedInput
	ProjectName string `path:"projectName" doc:"Project name (DNS-label slug)"`
	Tag         string `path:"tag" doc:"Design version tag (e.g. v1-2)"`
}

type designOutput struct{ Body *models.Design }
type designBundleOutput struct{ Body *DesignBundle }
type designVersionsOutput struct{ Body []models.ArtifactVersion }

// RegisterDesign registers the design feature's HTTP operations on the Huma
// API. Per the GitHub-direct rework
// (docs/design/agents-generation-migration.md §12.2) the per-file PUT/DELETE,
// component delete, and the architect generate stream are gone — edits are
// frontend drafts committed via the Files API, and generation is the unified
// genai turn endpoint. What remains is the read + version surface: get the
// design bundle at HEAD or at a tag, save (hard gate → tag at HEAD), discard
// (revert to last tag), and list versions.
func RegisterDesign(api huma.API, svc DesignService) {
	huma.Register(api, huma.Operation{
		OperationID: "get-design-bundle",
		Method:      http.MethodGet,
		Path:        "/projects/{projectName}/design/bundle",
		Summary:     "Get the design bundle (file map + assembled design)",
		Tags:        []string{"Design(Deprecated)"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *designProjectInput) (*designBundleOutput, error) {
		bundle, err := svc.GetDesignBundle(ctx, in.OrgHandle, in.ProjectName)
		if err != nil {
			return nil, mapDesignError(err)
		}
		return &designBundleOutput{Body: bundle}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "save-design",
		Method:      http.MethodPost,
		Path:        "/projects/{projectName}/design/save",
		Summary:     "Save the design and proceed",
		Tags:        []string{"Design(Deprecated)"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *designProjectInput) (*designOutput, error) {
		design, err := svc.SaveAndProceed(ctx, in.OrgHandle, in.ProjectName)
		if err != nil {
			slog.ErrorContext(ctx, "design save failed",
				"project", in.ProjectName, "error", err)
			if errors.Is(err, artifacts.ErrDesignNotFound) {
				return nil, huma.Error404NotFound("design not found")
			}
			if errors.Is(err, ErrSpecNotApproved) {
				return nil, huma.Error409Conflict("save requirements first — no v<N> baseline tag")
			}
			if de := asDesignValidationError(err); de != nil {
				return nil, de
			}
			return nil, huma.Error500InternalServerError("failed to save and proceed design")
		}
		return &designOutput{Body: design}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "discard-design-changes",
		Method:      http.MethodPost,
		Path:        "/projects/{projectName}/design/discard",
		Summary:     "Discard unsaved design changes",
		Tags:        []string{"Design(Deprecated)"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *designProjectInput) (*designOutput, error) {
		design, err := svc.DiscardChanges(ctx, in.OrgHandle, in.ProjectName)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to discard design changes")
		}
		return &designOutput{Body: design}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "list-design-versions",
		Method:      http.MethodGet,
		Path:        "/projects/{projectName}/design/versions",
		Summary:     "List design versions",
		Tags:        []string{"Design(Deprecated)"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *designProjectInput) (*designVersionsOutput, error) {
		versions, err := svc.ListDesignVersions(ctx, in.OrgHandle, in.ProjectName)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to list design versions")
		}
		return &designVersionsOutput{Body: versions}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-design-bundle-at-tag",
		Method:      http.MethodGet,
		Path:        "/projects/{projectName}/design/versions/{tag}/bundle",
		Summary:     "Get the design bundle at a tag",
		Tags:        []string{"Design(Deprecated)"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *designTagInput) (*designBundleOutput, error) {
		if in.Tag == "" {
			return nil, huma.Error400BadRequest("tag is required")
		}
		bundle, err := svc.GetDesignBundleAtTag(ctx, in.OrgHandle, in.ProjectName, in.Tag)
		if err != nil {
			if errors.Is(err, artifacts.ErrDesignNotFound) {
				return nil, huma.Error404NotFound("design not found")
			}
			return nil, huma.Error500InternalServerError("failed to get design bundle at tag")
		}
		return &designBundleOutput{Body: bundle}, nil
	})
}

// asDesignValidationError maps the artifact save-gate's per-file validation
// failure into a 422 problem carrying the offending files. Returns nil when
// err is not a validation error.
func asDesignValidationError(err error) error {
	var ve *artifacts.DesignValidationError
	if !errors.As(err, &ve) {
		return nil
	}
	details := make([]error, 0, len(ve.Files))
	for _, f := range ve.Files {
		details = append(details, &huma.ErrorDetail{
			Location: f.Path,
			Message:  f.Code + ": " + f.Message,
		})
	}
	return huma.Error422UnprocessableEntity("design validation failed", details...)
}

// mapDesignError translates the design feature's sentinel errors into RFC 9457
// problem responses. The non-tag GET/bundle operations map every service
// failure to a 500 in the legacy controller; the tag + save operations carry
// their own 404/409 branches inline at the call site.
func mapDesignError(err error) error {
	switch {
	case errors.Is(err, artifacts.ErrDesignNotFound):
		return huma.Error404NotFound("design not found")
	}
	return huma.Error500InternalServerError("internal error")
}
