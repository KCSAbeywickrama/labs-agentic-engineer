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

package provisioning

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/feature/dependencies/resources"
	"github.com/wso2/aep/aep-api/internal/platform/humakit"
)

// --- Inputs / Outputs ------------------------------------------------------
// Inputs embed humakit.OrgScopedInput, whose Resolve binds the active org from
// the verified token (the IDOR fence) — there is no {orgHandle} path param.

type listExternalResourcesInput struct {
	humakit.OrgScopedInput
}

type deleteExternalResourceInput struct {
	humakit.OrgScopedInput
	Name string `path:"name" doc:"External resource name"`
}

type saveValuesBody struct {
	Environments map[string]map[string]string `json:"environments" doc:"Per-environment { configKey: value } maps. Secret keys are routed to the secret manager by the registered schema."`
}

type saveValuesInput struct {
	humakit.OrgScopedInput
	ProjectName string `path:"projectName" doc:"Project name (DNS-label slug)"`
	Name        string `path:"name" doc:"External resource (dependency) name"`
	Body        *saveValuesBody
}

type provisionBody struct {
	Params       map[string]string `json:"params,omitempty" doc:"Provisioning parameters (override the design defaults)"`
	Environments []string          `json:"environments,omitempty" doc:"Environments to provision (default: [development])"`
}

type provisionInput struct {
	humakit.OrgScopedInput
	ProjectName   string `path:"projectName" doc:"Project name (DNS-label slug)"`
	ComponentName string `path:"componentName" doc:"Component the drawer opened on (context only)"`
	DepName       string `path:"depName" doc:"Platform-resource dependency name"`
	Body          *provisionBody
}

type statusInput struct {
	humakit.OrgScopedInput
	ProjectName   string `path:"projectName" doc:"Project name (DNS-label slug)"`
	ComponentName string `path:"componentName" doc:"Component the drawer opened on (context only)"`
	DepName       string `path:"depName" doc:"Dependency name"`
	Environment   string `query:"environment" doc:"Environment (default: development)"`
}

type configKeyDTO struct {
	Key             string `json:"key"`
	Secret          bool   `json:"secret"`
	CredentialClass string `json:"credentialClass,omitempty"`
}

type consumerDTO struct {
	ProjectID     string `json:"projectId"`
	ComponentName string `json:"componentName"`
}

type externalResourceDTO struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Config      []configKeyDTO `json:"config"`
	Consumers   []consumerDTO  `json:"consumers"`
}

type statusMsg struct {
	Status string `json:"status"`
}

type externalResourcesOutput struct{ Body []externalResourceDTO }
type statusMsgOutput struct{ Body statusMsg }
type depStatusOutput struct{ Body *DependencyStatus }
type emptyOutput struct{}

// RegisterResources registers the dependency-provisioning HTTP operations. A nil
// service registers the routes but answers 503 (so code-first spec generation
// still emits the surface with the feature unwired).
func RegisterResources(api huma.API, svc *Service) {
	huma.Register(api, huma.Operation{
		OperationID: "list-external-resources",
		Method:      http.MethodGet,
		Path:        "/dependencies/external-resources",
		Summary:     "List the org's external-resource catalog",
		Tags:        []string{"Dependencies"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *listExternalResourcesInput) (*externalResourcesOutput, error) {
		if svc == nil {
			return nil, huma.Error503ServiceUnavailable("provisioning is not configured")
		}
		views, err := svc.ListExternalResources(ctx, in.OrgHandle)
		if err != nil {
			return nil, mapProvisionError(err)
		}
		return &externalResourcesOutput{Body: toExternalResourceDTOs(views)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID:   "delete-external-resource",
		Method:        http.MethodDelete,
		Path:          "/dependencies/external-resources/{name}",
		Summary:       "Delete an external-resource catalog entry (409 if in use)",
		Tags:          []string{"Dependencies"},
		Security:      humakit.SecurityUserJWT,
		DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *deleteExternalResourceInput) (*emptyOutput, error) {
		if svc == nil {
			return nil, huma.Error503ServiceUnavailable("provisioning is not configured")
		}
		if err := svc.DeleteExternalResource(ctx, in.OrgHandle, in.Name); err != nil {
			return nil, mapProvisionError(err)
		}
		return &emptyOutput{}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "collect-external-resource-values",
		Method:      http.MethodPost,
		Path:        "/projects/{projectName}/dependencies/external-resources/{name}/values",
		Summary:     "Collect an external dependency's values and provision it",
		Tags:        []string{"Dependencies"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *saveValuesInput) (*statusMsgOutput, error) {
		if svc == nil {
			return nil, huma.Error503ServiceUnavailable("provisioning is not configured")
		}
		var envs map[string]map[string]string
		if in.Body != nil {
			envs = in.Body.Environments
		}
		// orgHandle serves as both the OC namespace/issues org and the SM-API org
		// id; the ctx carries the user JWT the SM-API writer reads for the vault path.
		if err := svc.SaveValues(ctx, in.OrgHandle, in.OrgHandle, in.ProjectName, in.Name, envs); err != nil {
			return nil, mapProvisionError(err)
		}
		return &statusMsgOutput{Body: statusMsg{Status: "provisioned"}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID:   "provision-platform-resource",
		Method:        http.MethodPost,
		Path:          "/projects/{projectName}/components/{componentName}/dependencies/{depName}/provision",
		Summary:       "Provision a platform-resource dependency (async)",
		Tags:          []string{"Dependencies"},
		Security:      humakit.SecurityUserJWT,
		DefaultStatus: http.StatusAccepted,
	}, func(ctx context.Context, in *provisionInput) (*statusMsgOutput, error) {
		if svc == nil {
			return nil, huma.Error503ServiceUnavailable("provisioning is not configured")
		}
		var params map[string]string
		var envs []string
		if in.Body != nil {
			params, envs = in.Body.Params, in.Body.Environments
		}
		if err := svc.Provision(ctx, in.OrgHandle, in.ProjectName, in.DepName, params, envs); err != nil {
			return nil, mapProvisionError(err)
		}
		return &statusMsgOutput{Body: statusMsg{Status: "provisioning"}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-dependency-status",
		Method:      http.MethodGet,
		Path:        "/projects/{projectName}/components/{componentName}/dependencies/{depName}/status",
		Summary:     "Get a dependency's provisioning status (outputs masked to names)",
		Tags:        []string{"Dependencies"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *statusInput) (*depStatusOutput, error) {
		if svc == nil {
			return nil, huma.Error503ServiceUnavailable("provisioning is not configured")
		}
		st, err := svc.Status(ctx, in.OrgHandle, in.ProjectName, in.DepName, in.Environment)
		if err != nil {
			return nil, mapProvisionError(err)
		}
		return &depStatusOutput{Body: st}, nil
	})

	// Cross-project org-service access-request surface.
	registerAccess(api, svc)
}

func toExternalResourceDTOs(views []ExternalResourceView) []externalResourceDTO {
	out := make([]externalResourceDTO, 0, len(views))
	for _, v := range views {
		keys := make([]configKeyDTO, 0, len(v.Config))
		for _, k := range v.Config {
			keys = append(keys, configKeyDTO{Key: k.Key, Secret: k.Secret, CredentialClass: k.CredentialClass})
		}
		consumers := make([]consumerDTO, 0, len(v.Consumers))
		for _, c := range v.Consumers {
			consumers = append(consumers, consumerDTO{ProjectID: c.ProjectID, ComponentName: c.ComponentName})
		}
		out = append(out, externalResourceDTO{
			Name:        v.Name,
			Description: v.Description,
			Config:      keys,
			Consumers:   consumers,
		})
	}
	return out
}

// mapProvisionError translates the provisioning sentinels into RFC 9457 problems:
// wrong kind → 400, not-found / not-registered → 404, in-use → 409, provision
// failure → 502, else 500.
func mapProvisionError(err error) error {
	switch {
	case errors.Is(err, resources.ErrDepWrongKind):
		return huma.Error400BadRequest(err.Error())
	case errors.Is(err, resources.ErrDepNotFound), errors.Is(err, resources.ErrNotRegistered), errors.Is(err, ErrOrgServiceNotFound):
		return huma.Error404NotFound(err.Error())
	case errors.Is(err, ErrExternalResourceInUse):
		return huma.Error409Conflict(err.Error())
	case errors.Is(err, resources.ErrProvisionFailed):
		return huma.Error502BadGateway(err.Error())
	}
	return huma.Error500InternalServerError("provisioning failed")
}
