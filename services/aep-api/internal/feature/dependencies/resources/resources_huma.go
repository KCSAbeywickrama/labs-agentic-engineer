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

package resources

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/platform/humakit"
	"github.com/wso2/aep/aep-api/repositories"
)

// --- Inputs / Outputs ---------------------------------------------------------
// Inputs embed humakit.OrgScopedInput: the active org is derived SOLELY from
// the verified token (no {orgHandle} path param) and the tenant gate applies
// by construction.

type listExternalResourcesInput struct {
	humakit.OrgScopedInput
}

type externalResourceConfigKeyDTO struct {
	Key    string `json:"key"`
	Secret bool   `json:"secret"`
}

type externalResourceDTO struct {
	Name        string                                  `json:"name"`
	Description string                                  `json:"description,omitempty"`
	ConfigKeys  []externalResourceConfigKeyDTO          `json:"configKeys"`
	Consumers   []repositories.ExternalResourceConsumer `json:"consumers"`
}

type listExternalResourcesOutput struct {
	Body struct {
		ExternalResources []externalResourceDTO `json:"externalResources"`
	}
}

type deleteExternalResourceInput struct {
	humakit.OrgScopedInput
	Name string `path:"name" doc:"External resource name to delete"`
}

type saveExternalResourceValuesInput struct {
	humakit.OrgScopedInput
	ProjectName string `path:"projectName" doc:"Project name (DNS-label slug)"`
	Name        string `path:"name" doc:"External resource name (e.g. openweather)"`
	Body        struct {
		// Environments maps an environment name (e.g. "development") to that
		// env's {key: value} map. Values are split into plain/secret by the
		// resource's registered schema — the caller never marks which is which.
		Environments map[string]map[string]string `json:"environments" doc:"Per-environment key→value map (development required)"`
	}
}

type saveExternalResourceValuesOutput struct {
	Body struct {
		Status string `json:"status"`
	}
}

type provisionDependencyInput struct {
	humakit.OrgScopedInput
	ProjectName   string `path:"projectName" doc:"Project name (DNS-label slug)"`
	ComponentName string `path:"componentName" doc:"Component name"`
	DepName       string `path:"depName" doc:"Platform-resource dependency name"`
	Body          struct {
		// Params is the unified provisioning parameters map applied to all envs
		// (the provisioner takes a single params map, not per-env — see the
		// single-params-map limitation in ResourceService.Provision docs).
		Params map[string]string `json:"params,omitempty" doc:"Provisioning parameters (applied to all envs)"`
		// Environments is the list of environments to provision the resource for.
		Environments []string `json:"environments" doc:"Environment names to bind the resource to (e.g. [\"development\"])"`
	}
}

type provisionDependencyOutput struct {
	Body struct {
		Status string `json:"status"`
	}
}

type dependencyStatusInput struct {
	humakit.OrgScopedInput
	ProjectName   string `path:"projectName" doc:"Project name (DNS-label slug)"`
	ComponentName string `path:"componentName" doc:"Component name"`
	DepName       string `path:"depName" doc:"Platform-resource dependency name"`
	Environment   string `query:"environment" doc:"Environment name (default: development)" required:"false"`
}

// dependencyOutputName is one MASKED binding output: name only, never the
// value or the rendered secret reference.
type dependencyOutputName struct {
	Name string `json:"name"`
}

type dependencyStatusOutput struct {
	Body struct {
		// Status mirrors the resource-provisioning task status (pending,
		// building, deployed, failed…).
		Status string `json:"status"`
		// Ready reports whether the OC binding's native Ready condition is True.
		Ready bool `json:"ready"`
		// Outputs lists binding outputs with values MASKED (name only — secret
		// values and rendered secret-ref names never enter API responses).
		Outputs []dependencyOutputName `json:"outputs,omitempty"`
	}
}

// RegisterResources registers the dependencies/resources HTTP surface: the
// org-level external-resource catalog (list + guarded delete), per-project
// external-resource value submission, and the platform-resource provision +
// status routes. Handlers nil-guard every dependency to 503 so registration
// stays pure metadata (the spec generator passes zero deps).
func RegisterResources(api huma.API, registry ExternalResourceRegistry, values *ValueService, svc *ResourceService, rc openchoreo.ResourceClient) {
	// ── Org-level external-resource catalog: list (with consumers) + guarded delete. ──
	huma.Register(api, huma.Operation{
		OperationID: "list-external-resources",
		Method:      http.MethodGet,
		Path:        "/dependencies/external-resources",
		Summary:     "List the org's registered external resources with their consuming components",
		Tags:        []string{"Dependencies"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *listExternalResourcesInput) (*listExternalResourcesOutput, error) {
		if registry == nil {
			return nil, huma.Error503ServiceUnavailable("external-resource registry is not configured")
		}
		rows, err := registry.List(ctx, in.OrgHandle)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to list external resources", err)
		}
		out := &listExternalResourcesOutput{}
		out.Body.ExternalResources = make([]externalResourceDTO, 0, len(rows))
		for i := range rows {
			consumers, cerr := registry.Consumers(ctx, in.OrgHandle, rows[i].Name)
			if cerr != nil {
				return nil, huma.Error500InternalServerError("failed to resolve external-resource consumers", cerr)
			}
			keys := make([]externalResourceConfigKeyDTO, 0, len(rows[i].ConfigKeys))
			for _, k := range rows[i].ConfigKeys {
				keys = append(keys, externalResourceConfigKeyDTO{Key: k.Key, Secret: k.Secret})
			}
			out.Body.ExternalResources = append(out.Body.ExternalResources, externalResourceDTO{
				Name:        rows[i].Name,
				Description: rows[i].Description,
				ConfigKeys:  keys,
				Consumers:   consumers,
			})
		}
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID:   "delete-external-resource",
		Method:        http.MethodDelete,
		Path:          "/dependencies/external-resources/{name}",
		Summary:       "Delete a registered external resource (only when no component uses it)",
		Tags:          []string{"Dependencies"},
		Security:      humakit.SecurityUserJWT,
		DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *deleteExternalResourceInput) (*struct{}, error) {
		if registry == nil {
			return nil, huma.Error503ServiceUnavailable("external-resource registry is not configured")
		}
		consumers, err := registry.Consumers(ctx, in.OrgHandle, in.Name)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to check external-resource usage", err)
		}
		if len(consumers) > 0 {
			used := make([]string, 0, len(consumers))
			for _, c := range consumers {
				used = append(used, c.ProjectID+"/"+c.ComponentName)
			}
			return nil, huma.Error409Conflict(
				"external resource is in use by " + joinUpTo(used, 5) + " — remove those components first")
		}
		if err := registry.Delete(ctx, in.OrgHandle, in.Name); err != nil {
			if errors.Is(err, repositories.ErrExternalResourceNotFound) {
				return nil, huma.Error404NotFound("external resource not found")
			}
			return nil, huma.Error500InternalServerError("failed to delete external resource", err)
		}
		return nil, nil
	})

	// ── Per-project external-resource value submission. ──
	huma.Register(api, huma.Operation{
		OperationID: "save-external-resource-values",
		Method:      http.MethodPost,
		Path:        "/projects/{projectName}/dependencies/external-resources/{name}/values",
		Summary:     "Save an external resource's per-environment values and provision it",
		Tags:        []string{"Dependencies"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *saveExternalResourceValuesInput) (*saveExternalResourceValuesOutput, error) {
		if values == nil {
			return nil, huma.Error503ServiceUnavailable("external-resource provisioning is not configured")
		}
		// The verified token org doubles as the SM-API org key (ocOrgID) at the
		// HTTP tier — same convention as the orgcreds connect flow.
		if err := values.SaveValues(ctx, in.OrgHandle, in.OrgHandle, in.ProjectName, in.Name, in.Body.Environments); err != nil {
			if errors.Is(err, ErrNotRegistered) {
				return nil, huma.Error404NotFound("external resource is not registered", err)
			}
			return nil, huma.Error500InternalServerError("failed to save external resource values", err)
		}
		out := &saveExternalResourceValuesOutput{}
		out.Body.Status = "provisioned"
		return out, nil
	})

	// ── Platform-resource provision (async) + status. ──
	huma.Register(api, huma.Operation{
		OperationID:   "provision-dependency",
		Method:        http.MethodPost,
		Path:          "/projects/{projectName}/components/{componentName}/dependencies/{depName}/provision",
		Summary:       "Author the OC Resource model for a platform-resource dep and mark it in-flight (async)",
		Tags:          []string{"Dependencies"},
		Security:      humakit.SecurityUserJWT,
		DefaultStatus: http.StatusAccepted,
	}, func(ctx context.Context, in *provisionDependencyInput) (*provisionDependencyOutput, error) {
		if svc == nil {
			return nil, huma.Error503ServiceUnavailable("resource provisioning is not configured")
		}
		envs := in.Body.Environments
		if len(envs) == 0 {
			envs = []string{defaultEnvironment}
		}
		if err := svc.Provision(ctx, in.OrgHandle, in.ProjectName, in.ComponentName, in.DepName,
			in.Body.Params, envs); err != nil {
			return nil, mapDepError(err, "failed to provision resource")
		}
		out := &provisionDependencyOutput{}
		out.Body.Status = "provisioning"
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-dependency-status",
		Method:      http.MethodGet,
		Path:        "/projects/{projectName}/components/{componentName}/dependencies/{depName}/status",
		Summary:     "Get the provisioning status and masked outputs for a platform-resource dependency",
		Tags:        []string{"Dependencies"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *dependencyStatusInput) (*dependencyStatusOutput, error) {
		if svc == nil || rc == nil {
			return nil, huma.Error503ServiceUnavailable("resource provisioning is not configured")
		}
		// Kind policy: the status route names a design dependency, so an
		// unknown dep is 404 and a non-platform-resource dep is 400.
		if err := svc.ResolvePlatformDep(ctx, in.OrgHandle, in.ProjectName, in.ComponentName, in.DepName); err != nil {
			return nil, mapDepError(err, "failed to resolve dependency")
		}
		env := in.Environment
		if env == "" {
			env = defaultEnvironment
		}
		// GetBinding returns (nil, nil) mid-provision (binding not yet created)
		// — the response stays 200 with ready=false and the task status.
		binding, err := rc.GetBinding(ctx, in.OrgHandle, platformBindingName(in.ProjectName, in.DepName, env))
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to read resource binding", err)
		}

		out := &dependencyStatusOutput{}
		out.Body.Status = svc.TaskStatus(ctx, in.OrgHandle, in.ProjectName, in.DepName)
		if binding != nil {
			out.Body.Ready = binding.IsReady()
			if binding.Status != nil {
				// Mask outputs: emit the name only, never the value or the
				// rendered secret-ref (secrets must not enter API responses —
				// they live only in the OC-rendered Secret).
				for _, o := range binding.Status.Outputs {
					out.Body.Outputs = append(out.Body.Outputs, dependencyOutputName{Name: o.Name})
				}
			}
		}
		return out, nil
	})
}

// defaultEnvironment is the environment assumed when a request names none.
const defaultEnvironment = "development"

// mapDepError translates the platform-resource sentinel errors into RFC 9457
// problem responses: unknown dep → 404, wrong kind → 400 (the wrap message
// names the actual and the applicable kind), provisioner failure → 502,
// anything else → 500 with the generic message.
func mapDepError(err error, msg500 string) error {
	switch {
	case errors.Is(err, ErrDepWrongKind):
		return huma.Error400BadRequest(err.Error())
	case errors.Is(err, ErrDepNotFound):
		return huma.Error404NotFound("platform-resource dependency not found", err)
	case errors.Is(err, ErrProvisionFailed):
		return huma.Error502BadGateway("platform provisioner failed", err)
	default:
		return huma.Error500InternalServerError(msg500, err)
	}
}

// joinUpTo joins up to n items with ", ", appending "and N more" past the cap.
func joinUpTo(items []string, n int) string {
	if len(items) <= n {
		return strings.Join(items, ", ")
	}
	return strings.Join(items[:n], ", ") + fmt.Sprintf(", and %d more", len(items)-n)
}
