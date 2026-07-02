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

package component

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/platform/humakit"
	"github.com/wso2/aep/aep-api/internal/platform/ocerr"
	"github.com/wso2/aep/aep-api/internal/platform/validate"
	"github.com/wso2/aep/aep-api/models"
)

// --- Inputs / Outputs ------------------------------------------------------
// Inputs embed humakit.OrgScopedInput, whose Resolve binds the active org from the verified token (no {orgHandle} path param) and applies
// the tenant gate (the IDOR fence) by construction. Extra path params are
// declared as sibling fields alongside the embedded struct. projectName/
// componentName/buildName are validated as DNS-label slugs (400 on malformed)
// via the requireSlug helpers below.

type componentProjectInput struct {
	humakit.OrgScopedInput
	ProjectName string `path:"projectName" doc:"Project name (DNS-label slug)"`
}

type componentNameInput struct {
	humakit.OrgScopedInput
	ProjectName   string `path:"projectName" doc:"Project name (DNS-label slug)"`
	ComponentName string `path:"componentName" doc:"Component name (DNS-label slug)"`
}

type buildStatusInput struct {
	humakit.OrgScopedInput
	ProjectName   string `path:"projectName" doc:"Project name (DNS-label slug)"`
	ComponentName string `path:"componentName" doc:"Component name (DNS-label slug)"`
	BuildName     string `path:"buildName" doc:"Build WorkflowRun name (DNS-label slug)"`
}

type componentListOutput struct{ Body *models.ComponentList }
type componentOutput struct{ Body *models.Component }
type workflowRunOutput struct{ Body *models.WorkflowRun }
type workflowRunListOutput struct{ Body *models.WorkflowRunList }
type buildLogsOutput struct{ Body *models.BuildLogs }
type deploymentListOutput struct{ Body *models.DeploymentList }
type componentOpenAPIOutput struct {
	// Status carries the dynamic response code. The legacy controller returned
	// the ComponentOpenAPI body with either 200 (service, spec present) or 409
	// (non-service — body still carries componentType so the UI can render a
	// typed empty state). Huma reads the Status field to set the code per call.
	Status int
	Body   *models.ComponentOpenAPI
}

// RegisterComponent registers the component feature's HTTP operations on the
// Huma API. Code-first replacement for registerComponentRoutes
// (api/component_routes.go): same paths, methods, auth posture, success status
// codes, and per-handler error→status mapping.
func RegisterComponent(api huma.API, svc ComponentService) {
	const prefix = "/projects/{projectName}/components"

	huma.Register(api, huma.Operation{
		OperationID: "list-components",
		Method:      http.MethodGet,
		Path:        prefix,
		Summary:     "List components",
		Tags:        []string{"Components"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *componentProjectInput) (*componentListOutput, error) {
		if err := requireSlug("projectName", in.ProjectName); err != nil {
			return nil, err
		}
		list, err := svc.ListComponents(ctx, in.OrgHandle, in.ProjectName, 100, "")
		if err != nil {
			return nil, mapComponentError(err, "failed to list components")
		}
		return &componentListOutput{Body: list}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-component",
		Method:      http.MethodGet,
		Path:        prefix + "/{componentName}",
		Summary:     "Get a component",
		Tags:        []string{"Components"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *componentNameInput) (*componentOutput, error) {
		if err := requireComponentSlugs(in.ProjectName, in.ComponentName); err != nil {
			return nil, err
		}
		comp, err := svc.GetComponent(ctx, in.OrgHandle, in.ProjectName, in.ComponentName)
		if err != nil {
			// A missing component surfaces as openchoreo.ErrNotFound from the
			// client and is mapped to 404 by mapComponentError. (GetComponent
			// never returns the feature-local ErrComponentNotFound — only the
			// openapi handler below does.)
			return nil, mapComponentError(err, "failed to get component")
		}
		return &componentOutput{Body: comp}, nil
	})

	// Build operations
	huma.Register(api, huma.Operation{
		OperationID:   "trigger-build",
		Method:        http.MethodPost,
		Path:          prefix + "/{componentName}/builds",
		Summary:       "Trigger a component build",
		Tags:          []string{"Components"},
		Security:      humakit.SecurityUserJWT,
		DefaultStatus: http.StatusCreated,
	}, func(ctx context.Context, in *componentNameInput) (*workflowRunOutput, error) {
		if err := requireComponentSlugs(in.ProjectName, in.ComponentName); err != nil {
			return nil, err
		}
		run, err := svc.TriggerBuild(ctx, in.OrgHandle, in.ProjectName, in.ComponentName)
		if err != nil {
			return nil, mapComponentError(err, "failed to trigger build")
		}
		return &workflowRunOutput{Body: run}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "list-builds",
		Method:      http.MethodGet,
		Path:        prefix + "/{componentName}/builds",
		Summary:     "List component builds",
		Tags:        []string{"Components"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *componentNameInput) (*workflowRunListOutput, error) {
		if err := requireComponentSlugs(in.ProjectName, in.ComponentName); err != nil {
			return nil, err
		}
		list, err := svc.ListBuilds(ctx, in.OrgHandle, in.ProjectName, in.ComponentName, 20, "")
		if err != nil {
			return nil, mapComponentError(err, "failed to list builds")
		}
		return &workflowRunListOutput{Body: list}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-build-logs",
		Method:      http.MethodGet,
		Path:        prefix + "/{componentName}/builds/{buildName}/logs",
		Summary:     "Get build logs",
		Tags:        []string{"Components"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *buildStatusInput) (*buildLogsOutput, error) {
		if err := requireComponentSlugs(in.ProjectName, in.ComponentName); err != nil {
			return nil, err
		}
		if err := requireSlug("buildName", in.BuildName); err != nil {
			return nil, err
		}
		logs, err := svc.GetBuildLogs(ctx, in.OrgHandle, in.ProjectName, in.ComponentName, in.BuildName)
		if err != nil {
			if errors.Is(err, ErrLogsUnavailable) {
				return nil, huma.Error503ServiceUnavailable("build logs service not available")
			}
			return nil, mapComponentError(err, "failed to get build logs")
		}
		return &buildLogsOutput{Body: logs}, nil
	})

	// Deploy operations — read-only; OC's Component controller drives the
	// deploy chain via AutoDeploy. The list reflects materialised
	// ReleaseBindings for this component.
	huma.Register(api, huma.Operation{
		OperationID: "list-deployments",
		Method:      http.MethodGet,
		Path:        prefix + "/{componentName}/deployments",
		Summary:     "List component deployments",
		Tags:        []string{"Components"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *componentNameInput) (*deploymentListOutput, error) {
		if err := requireComponentSlugs(in.ProjectName, in.ComponentName); err != nil {
			return nil, err
		}
		list, err := svc.ListDeployments(ctx, in.OrgHandle, in.ProjectName, in.ComponentName)
		if err != nil {
			return nil, mapComponentError(err, "failed to list deployments")
		}
		return &deploymentListOutput{Body: list}, nil
	})

	// OpenAPI spec (drives the Test tab). Read from
	// specs/design/components/<name>/openapi.yaml. Service components have a
	// guaranteed OpenAPI 3.0 doc; non-service components return 409 with the
	// componentType so the UI can render a typed empty state.
	huma.Register(api, huma.Operation{
		OperationID: "get-component-openapi",
		Method:      http.MethodGet,
		Path:        prefix + "/{componentName}/openapi",
		Summary:     "Get a component's OpenAPI spec",
		Tags:        []string{"Components"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *componentNameInput) (*componentOpenAPIOutput, error) {
		if err := requireComponentSlugs(in.ProjectName, in.ComponentName); err != nil {
			return nil, err
		}
		spec, err := svc.GetComponentOpenAPI(ctx, in.OrgHandle, in.ProjectName, in.ComponentName)
		if err != nil {
			if errors.Is(err, ErrComponentNotFound) {
				return nil, huma.Error404NotFound("no OpenAPI spec for this component")
			}
			if errors.Is(err, ErrComponentNotService) {
				// Hand the type back (409) so the client can say "this is a
				// web-app, not a service". The body still carries componentType.
				return &componentOpenAPIOutput{Status: http.StatusConflict, Body: spec}, nil
			}
			return nil, mapComponentError(err, "failed to get OpenAPI spec")
		}
		return &componentOpenAPIOutput{Status: http.StatusOK, Body: spec}, nil
	})
}

// mapComponentError translates an OpenChoreo sentinel that reached
// componentService into its RFC-9457 status via the shared ocerr classifier
// (401/403/404/409/400/500, matching project and organization). An error that
// is not an OC sentinel collapses to a fixed-message 500 that never echoes the
// internal cause. Handler-specific branches (409 not-service, 503
// logs-unavailable, 404 openapi-not-found) are handled at the call site before
// delegating here.
func mapComponentError(err error, internalMsg string) error {
	if status, ok := ocerr.Status(err); ok {
		return humakit.ErrorFromStatus(status, err.Error())
	}
	return huma.Error500InternalServerError(internalMsg)
}

// requireSlug validates a single DNS-label slug path param, returning a 400
// huma error on failure. Delegates to validate.Slug.
func requireSlug(name, v string) error {
	if err := validate.Slug(v); err != nil {
		return huma.Error400BadRequest(name + ": " + err.Error())
	}
	return nil
}

// requireComponentSlugs validates the projectName + componentName path params
// as DNS-label slugs.
func requireComponentSlugs(projectName, componentName string) error {
	if err := requireSlug("projectName", projectName); err != nil {
		return err
	}
	return requireSlug("componentName", componentName)
}
