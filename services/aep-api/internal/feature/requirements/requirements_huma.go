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

package requirements

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
// the tenant gate (the IDOR fence) by construction. The {projectName} and
// per-tag path params are sibling fields.

type reqProjectInput struct {
	humakit.OrgScopedInput
	ProjectName string `path:"projectName" doc:"Project name (DNS-label slug)"`
}

type reqVersionInput struct {
	humakit.OrgScopedInput
	ProjectName string `path:"projectName" doc:"Project name (DNS-label slug)"`
	Tag         string `path:"tag" doc:"Version tag (e.g. v1)"`
}

// saveBody is the optional save request body. The publish flow pins the commit
// its files-apply just created so the save never races a stale `heads/main`
// read (GitHub ref reads lag writes by seconds).
type saveBody struct {
	CommitSHA string `json:"commitSha,omitempty" doc:"Commit to gate and tag (the publish's just-applied commit). Empty: resolve HEAD."`
}

// reqSaveInput is reqProjectInput plus the optional save body (pointer Body =
// body itself optional; bare POSTs keep working).
type reqSaveInput struct {
	humakit.OrgScopedInput
	ProjectName string `path:"projectName" doc:"Project name (DNS-label slug)"`
	Body        *saveBody
}

func (in *reqSaveInput) commitSHA() string {
	if in.Body == nil {
		return ""
	}
	return in.Body.CommitSHA
}

type requirementsBundleOutput struct{ Body *models.RequirementsBundle }
type requirementsVersionsOutput struct{ Body []models.ArtifactVersion }

// RegisterRequirements registers the requirements feature's HTTP operations on
// the Huma API. Per the GitHub-direct rework
// (docs/design/agents-generation-migration.md §12.2) the per-file PUT/DELETE
// and the skill-routed generate stream are gone — manual edits are frontend
// drafts committed via the Files API, and generation is the unified genai turn
// endpoint. What remains is the read + version surface: get the bundle at HEAD,
// save (tag at HEAD), discard (revert to last tag), and the version reads.
func RegisterRequirements(api huma.API, svc RequirementsService) {
	prefix := "/projects/{projectName}/requirements"

	huma.Register(api, huma.Operation{
		OperationID: "get-requirements",
		Method:      http.MethodGet,
		Path:        prefix,
		Summary:     "Get the requirements bundle",
		Tags:        []string{"Requirements(Deprecated)"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *reqProjectInput) (*requirementsBundleOutput, error) {
		out, err := svc.GetRequirements(ctx, in.OrgHandle, in.ProjectName)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to get requirements")
		}
		return &requirementsBundleOutput{Body: out}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "save-requirements",
		Method:      http.MethodPost,
		Path:        prefix + "/save",
		Summary:     "Save the requirements bundle (cut a new version)",
		Tags:        []string{"Requirements(Deprecated)"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *reqSaveInput) (*requirementsBundleOutput, error) {
		out, err := svc.SaveAndProceed(ctx, in.OrgHandle, in.ProjectName, in.commitSHA())
		if err != nil {
			slog.ErrorContext(ctx, "requirements save failed",
				"project", in.ProjectName, "error", err)
			if errors.Is(err, artifacts.ErrSpecNotFound) {
				return nil, huma.Error404NotFound("requirements not found")
			}
			return nil, huma.Error500InternalServerError("failed to save requirements")
		}
		return &requirementsBundleOutput{Body: out}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "discard-requirements",
		Method:      http.MethodPost,
		Path:        prefix + "/discard",
		Summary:     "Discard unsaved requirements changes",
		Tags:        []string{"Requirements(Deprecated)"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *reqProjectInput) (*requirementsBundleOutput, error) {
		out, err := svc.DiscardChanges(ctx, in.OrgHandle, in.ProjectName)
		if err != nil {
			slog.ErrorContext(ctx, "requirements discard failed",
				"project", in.ProjectName, "error", err)
			return nil, huma.Error500InternalServerError("failed to discard requirements")
		}
		return &requirementsBundleOutput{Body: out}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "list-requirements-versions",
		Method:      http.MethodGet,
		Path:        prefix + "/versions",
		Summary:     "List requirements versions",
		Tags:        []string{"Requirements(Deprecated)"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *reqProjectInput) (*requirementsVersionsOutput, error) {
		versions, err := svc.ListVersions(ctx, in.OrgHandle, in.ProjectName)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to list versions")
		}
		return &requirementsVersionsOutput{Body: versions}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-requirements-at-version",
		Method:      http.MethodGet,
		Path:        prefix + "/versions/{tag}",
		Summary:     "Get the requirements bundle at a version tag",
		Tags:        []string{"Requirements(Deprecated)"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *reqVersionInput) (*requirementsBundleOutput, error) {
		if in.Tag == "" {
			return nil, huma.Error400BadRequest("tag is required")
		}
		out, err := svc.GetRequirementsAtTag(ctx, in.OrgHandle, in.ProjectName, in.Tag)
		if err != nil {
			if errors.Is(err, artifacts.ErrSpecNotFound) {
				return nil, huma.Error404NotFound("requirements not found at tag")
			}
			return nil, huma.Error500InternalServerError("failed to get requirements at tag")
		}
		return &requirementsBundleOutput{Body: out}, nil
	})
}
