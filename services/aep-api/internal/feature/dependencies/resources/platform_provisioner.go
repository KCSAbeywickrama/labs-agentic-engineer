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
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
)

// ResourceProvisioner is the narrow swap-point for platform resources: it
// authors the OpenChoreo Resource model for a platform-resource dependency and
// returns immediately — provisioning a real backing instance (a database, a
// broker) is asynchronous, so Provision MUST NOT block on readiness. It
// authors the Resource + per-env binding and returns; the resource watcher (a
// later task) observes the binding's native Ready condition out-of-band.
//
// This is the ONLY abstraction that varies by environment. The OC-native
// implementation below authors directly against openchoreo-api in both local
// and cloud; a future cloud provisioning API can swap in behind the same
// interface. Everything else — discovery, the task graph, the drawer,
// consumption — is provisioner-agnostic.
type ResourceProvisioner interface {
	// Provision authors (idempotently) the OC Resource model for a platform-
	// resource dep and returns immediately — it does NOT wait for readiness
	// (a real provisioner is async; the resource watcher observes the binding's
	// native Ready condition). resourceType is a DISCOVERED ClusterResourceType
	// name. params are user-supplied provisioning parameters (spec.parameters).
	Provision(ctx context.Context, orgHandle, projectName, depName, resourceType string,
		params map[string]string, envs []string) (*PlatformProvisionResult, error)

	// Deprovision tears down what Provision authored: the per-env bindings
	// (their retainPolicy cascades the rendered backing instance), then the
	// Resource. Best-effort and 404-tolerant — used by project deletion, where
	// the Resource/binding would otherwise orphan (the OC Project delete does
	// NOT cascade them; they carry a logical spec.owner.projectName, not a k8s
	// ownerReference).
	Deprovision(ctx context.Context, orgHandle, projectName, depName string, envs []string) error
}

// PlatformProvisionResult reports what was authored: the per-project Resource
// name and the per-env binding names. It carries NO outputs — outputs (incl.
// secret references) are resolved later from the binding's status by the
// readiness watcher, never returned synchronously from the request path.
// (Named apart from the external-resource ProvisionResult in this package.)
type PlatformProvisionResult struct {
	ResourceName string
	BindingByEnv map[string]string
}

// OCNativeProvisioner authors the OC Resource model directly against
// openchoreo-api (identical local + cloud). It references a DISCOVERED
// ClusterResourceType — it NEVER authors the type (the cluster PE installs it)
// and so makes no EnsureResourceType call.
//
// Flow (async): ApplyResource → poll status.latestRelease (cutting a release
// is fast; openchoreo.WaitForLatestRelease) → author the per-env binding
// pinned to that release → return. It does NOT wait for the binding's Ready
// condition: standing up a real DB takes minutes; the resource watcher
// observes Ready out-of-band.
type OCNativeProvisioner struct {
	rc openchoreo.ResourceClient

	// pollInterval / pollTimeout bound ONLY the wait for the controller to cut
	// the ResourceRelease (Resources have no AutoDeploy — the BFF pins it).
	// This is NOT a readiness wait — it is the fast "did a release name appear"
	// poll, just long enough to pin the binding.
	pollInterval time.Duration
	pollTimeout  time.Duration
}

// NewOCNativeProvisioner wires the OC-native platform provisioner.
func NewOCNativeProvisioner(rc openchoreo.ResourceClient) *OCNativeProvisioner {
	return &OCNativeProvisioner{
		rc:           rc,
		pollInterval: 2 * time.Second,
		pollTimeout:  60 * time.Second,
	}
}

// Provision authors the Resource + per-env bindings and returns immediately.
// It references the discovered ClusterResourceType `resourceType` (no
// EnsureResourceType), writes user params to spec.parameters, polls only for
// status.latestRelease to pin, and returns success even when the binding is
// not yet Ready (async — the watcher observes readiness later).
func (p *OCNativeProvisioner) Provision(
	ctx context.Context,
	orgHandle, projectName, depName, resourceType string,
	params map[string]string,
	envs []string,
) (*PlatformProvisionResult, error) {
	if orgHandle == "" || projectName == "" || depName == "" {
		return nil, fmt.Errorf("resources: orgHandle, projectName and depName required")
	}
	if resourceType == "" {
		return nil, fmt.Errorf("resources: resourceType (ClusterResourceType name) required")
	}

	// The design carries provisioning params as strings (design.json
	// `parameters` is map[string]string), but a ClusterResourceType schema can
	// declare a param as integer/number/boolean — the ResourceRelease admission
	// webhook rejects a string where the schema wants an integer (e.g.
	// postgres-cnpg `instances`). Coerce each value to its schema-declared JSON
	// type and route it to the schema it belongs to (spec.parameters vs the
	// binding's environmentConfigs). When the CRT can't be read, keep the raw
	// string values so behaviour is unchanged.
	paramTypes, envTypes, schemaOK := p.schemaTypes(ctx, resourceType)
	if !schemaOK {
		paramTypes, envTypes = nil, nil
	}

	// 1. Resource (one per project; references the discovered ClusterResourceType).
	// NO EnsureResourceType — AEP never authors the type.
	res := BuildPlatformResource(projectName, depName, resourceType, coerceParams(params, paramTypes))
	applied, err := p.rc.ApplyResource(ctx, orgHandle, res)
	if err != nil {
		return nil, fmt.Errorf("resources: apply resource: %w", err)
	}

	// 2. Wait for status.latestRelease (no AutoDeploy → BFF pins it). This is a
	// fast poll for the release NAME, not a readiness wait. A reconcile carries
	// the stale pre-reconcile release on `applied`, so wait for a CHANGE off it;
	// a create leaves it empty (wait-for-nonempty).
	latest, err := openchoreo.WaitForReleaseChange(ctx, p.rc, orgHandle, res.Metadata.Name, openchoreo.ReleaseName(applied), p.pollInterval, p.pollTimeout)
	if err != nil {
		return nil, fmt.Errorf("resources: %w", err)
	}

	// 3. Per env: author the binding pinned to latestRelease. Return without
	// waiting on the binding Ready condition — a real DB takes minutes.
	result := &PlatformProvisionResult{ResourceName: res.Metadata.Name, BindingByEnv: map[string]string{}}
	for _, env := range envs {
		binding, berr := BuildPlatformBinding(projectName, depName, env, latest, coerceParams(params, envTypes))
		if berr != nil {
			return nil, berr
		}
		if _, err := p.rc.EnsureBinding(ctx, orgHandle, binding); err != nil {
			return nil, fmt.Errorf("resources: ensure binding for env %q: %w", env, err)
		}
		result.BindingByEnv[env] = binding.Metadata.Name
	}
	return result, nil
}

// Deprovision deletes the per-env bindings (their retainPolicy cascades the
// rendered backing instance + generated Secret/PVC), then the Resource.
// Best-effort: DeleteBinding/DeleteResource are 404-tolerant, and errors are
// COLLECTED (errors.Join) rather than short-circuited so one failed env
// doesn't leave the Resource behind.
func (p *OCNativeProvisioner) Deprovision(ctx context.Context, orgHandle, projectName, depName string, envs []string) error {
	resourceName := platformResourceName(projectName, depName)
	var errs []error
	for _, env := range envs {
		if err := p.rc.DeleteBinding(ctx, orgHandle, platformBindingName(projectName, depName, env)); err != nil {
			errs = append(errs, fmt.Errorf("delete binding (%s/%s): %w", depName, env, err))
		}
	}
	if err := p.rc.DeleteResource(ctx, orgHandle, resourceName); err != nil {
		errs = append(errs, fmt.Errorf("delete resource (%s): %w", depName, err))
	}
	return errors.Join(errs...)
}

// ---- naming + pure builders (unit-tested) ------------------------------------

// platformResourceName is the per-project Resource name (metadata.name is
// namespace-unique; owner.projectName does NOT scope it). Mirrors
// ExternalResourceName for the external half.
func platformResourceName(project, depName string) string { return project + "-" + depName }

// platformBindingName is the per-env ResourceReleaseBinding name — the single
// source of truth shared by Provision, Deprovision and the status read.
func platformBindingName(project, depName, env string) string {
	return platformResourceName(project, depName) + "-" + env
}

// BuildPlatformResource references a DISCOVERED ClusterResourceType (Type.Kind
// = "ClusterResourceType") — unlike the external-resource provisioner's
// namespaced per-resource ResourceType, AEP never authors this type. User
// provisioning params go to spec.parameters as JSON.
func BuildPlatformResource(project, depName, rtName string, params map[string]any) *openchoreo.Resource {
	res := &openchoreo.Resource{
		Metadata: openchoreo.OCObjectMeta{Name: platformResourceName(project, depName)},
		Spec: openchoreo.ResourceSpec{
			Owner: openchoreo.ResourceOwner{ProjectName: project},
			Type:  openchoreo.ResourceTypeRef{Kind: "ClusterResourceType", Name: rtName},
		},
	}
	if len(params) > 0 {
		if raw, err := json.Marshal(params); err == nil {
			res.Spec.Parameters = raw
		}
	}
	return res
}

// BuildPlatformBinding authors a per-env binding pinned to latestRelease.
// Per-env params go to spec.resourceTypeEnvironmentConfigs as JSON.
func BuildPlatformBinding(project, depName, env, latestRelease string, params map[string]any) (*openchoreo.ResourceReleaseBinding, error) {
	resourceName := platformResourceName(project, depName)
	b := &openchoreo.ResourceReleaseBinding{
		Metadata: openchoreo.OCObjectMeta{Name: platformBindingName(project, depName, env)},
		Spec: openchoreo.ResourceReleaseBindingSpec{
			Owner:           openchoreo.ResourceReleaseBindingOwner{ProjectName: project, ResourceName: resourceName},
			Environment:     env,
			ResourceRelease: latestRelease,
		},
	}
	if len(params) > 0 {
		raw, err := json.Marshal(params)
		if err != nil {
			return nil, fmt.Errorf("resources: marshal env configs: %w", err)
		}
		b.Spec.ResourceTypeEnvironmentConfigs = json.RawMessage(raw)
	}
	return b, nil
}

// schemaTypes reads the ClusterResourceType `resourceType` and returns the
// property→JSON-type maps for its `parameters` and `environmentConfigs` schemas.
// ok is false when the type cannot be read (or is not installed): callers then
// keep the raw string params rather than coercing/routing, so a discovery
// failure never silently drops a user's params.
func (p *OCNativeProvisioner) schemaTypes(ctx context.Context, resourceType string) (params, envConfigs map[string]string, ok bool) {
	cts, err := p.rc.ListClusterResourceTypes(ctx)
	if err != nil {
		return nil, nil, false
	}
	for i := range cts {
		if cts[i].Metadata.Name == resourceType {
			return propTypes(cts[i].Spec.Parameters), propTypes(cts[i].Spec.EnvironmentConfigs), true
		}
	}
	return nil, nil, false
}

// propTypes projects a ClusterResourceType schema section to a
// property-name→JSON-type map (e.g. {"instances":"integer","version":"string"}).
// A nil section (the type declares no such schema) yields an empty — but
// non-nil — map, which coerceParams reads as "this schema accepts no keys".
func propTypes(section *openchoreo.SchemaSection) map[string]string {
	types := map[string]string{}
	if section == nil {
		return types
	}
	props, ok := section.OpenAPIV3Schema["properties"].(map[string]any)
	if !ok {
		return types
	}
	for name, raw := range props {
		if m, ok := raw.(map[string]any); ok {
			if t, ok := m["type"].(string); ok {
				types[name] = t
			}
		}
	}
	return types
}

// coerceParams converts the design's string param values to the JSON types the
// ClusterResourceType schema declares (integer/number/boolean; everything else
// stays a string) and drops keys the schema does not declare — so params reach
// the schema they belong to and pass the OC admission webhook. types==nil means
// the schema was unavailable: every value is kept verbatim as a string (no
// coercion, no routing) so behaviour is unchanged. A value that fails to parse
// as its declared type is left as a string for the webhook to reject with a
// precise message rather than being silently altered.
func coerceParams(params map[string]string, types map[string]string) map[string]any {
	if len(params) == 0 {
		return nil
	}
	out := make(map[string]any, len(params))
	for k, v := range params {
		t, known := types[k]
		if types != nil && !known {
			continue // schema present but does not declare this key → route it out
		}
		switch t {
		case "integer":
			if n, err := strconv.Atoi(v); err == nil {
				out[k] = n
				continue
			}
		case "number":
			if f, err := strconv.ParseFloat(v, 64); err == nil {
				out[k] = f
				continue
			}
		case "boolean":
			if b, err := strconv.ParseBool(v); err == nil {
				out[k] = b
				continue
			}
		}
		out[k] = v
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// OCNativeProvisioner is the only registered ResourceProvisioner impl today.
var _ ResourceProvisioner = (*OCNativeProvisioner)(nil)
