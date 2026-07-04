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
	"fmt"
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/models"
)

// EnvValues are the user-supplied values for one environment, split by the
// resource's registered schema.
type EnvValues struct {
	Plain  map[string]string // non-secret key → value
	Secret map[string]string // secret key → value
}

// ExternalResourceProvisioner authors the OpenChoreo Resource model for a
// registered external resource in a project: SM-API value write →
// ResourceType (get-or-create) → Resource (controller cuts a ResourceRelease)
// → per-env ResourceReleaseBinding pinned to status.latestRelease.
type ExternalResourceProvisioner struct {
	lookup externalResourceLookup
	rc     openchoreo.ResourceClient
	sm     SecretWriter

	// pollInterval / pollTimeout bound the wait for the controller to cut the
	// ResourceRelease (Resources have no AutoDeploy — we poll status.latestRelease
	// via openchoreo.WaitForLatestRelease).
	pollInterval time.Duration
	pollTimeout  time.Duration
}

// NewExternalResourceProvisioner wires the provisioner. lookup is only read
// by ResolveRunnerSecrets; Provision/Deprovision receive the resource row from
// the caller.
func NewExternalResourceProvisioner(lookup externalResourceLookup, rc openchoreo.ResourceClient, sm SecretWriter) *ExternalResourceProvisioner {
	return &ExternalResourceProvisioner{
		lookup:       lookup,
		rc:           rc,
		sm:           sm,
		pollInterval: 2 * time.Second,
		pollTimeout:  60 * time.Second,
	}
}

// ProvisionResult reports what was authored.
type ProvisionResult struct {
	ResourceName  string            // the per-project Resource name
	LatestRelease string            // the pinned ResourceRelease
	BindingByEnv  map[string]string // env → binding name
}

// Provision authors (idempotently) the external resource's OC Resource model
// for a project across the given environments. `orgHandle` is the OC namespace
// the CRs live in; `ocOrgID` is the SM-API org id. Per env it writes the
// secret values (when any) to SM-API and pins the per-env binding with the
// resulting secretStorePath + plain values.
func (p *ExternalResourceProvisioner) Provision(
	ctx context.Context,
	orgHandle, ocOrgID, projectName string,
	er *models.ExternalResource,
	byEnv map[string]EnvValues,
) (*ProvisionResult, error) {
	if er == nil {
		return nil, fmt.Errorf("external resources: nil resource")
	}
	if orgHandle == "" || projectName == "" {
		return nil, fmt.Errorf("external resources: orgHandle and projectName required")
	}

	// 1. ResourceType (get-or-create; immutable once created). The cluster RT
	// name is pinned to the generator's template version — a template change
	// authors a fresh RT instead of silently reusing a stale same-named one on
	// 409-conflict.
	rtName := openchoreo.ExternalResourceRTName(er.ResourceTypeName)
	rt, err := openchoreo.BuildExternalResourceType(rtName, toRTConfigKeys(er.ConfigKeys))
	if err != nil {
		return nil, fmt.Errorf("external resources: build resourcetype: %w", err)
	}
	if _, err := p.rc.EnsureResourceType(ctx, orgHandle, rt); err != nil {
		return nil, fmt.Errorf("external resources: ensure resourcetype %q: %w", rtName, err)
	}

	// 2. Resource (one per project; controller cuts the ResourceRelease).
	res := buildExternalResource(projectName, er, rtName)
	if _, err := p.rc.ApplyResource(ctx, orgHandle, res); err != nil {
		return nil, fmt.Errorf("external resources: apply resource: %w", err)
	}

	// 3. Wait for status.latestRelease (no AutoDeploy → BFF pins it).
	latest, err := openchoreo.WaitForLatestRelease(ctx, p.rc, orgHandle, res.Metadata.Name, p.pollInterval, p.pollTimeout)
	if err != nil {
		return nil, fmt.Errorf("external resources: %w", err)
	}

	// 4. Per env: SM-API secret write → per-env binding pinned to latestRelease.
	result := &ProvisionResult{ResourceName: res.Metadata.Name, LatestRelease: latest, BindingByEnv: map[string]string{}}
	for env, vals := range byEnv {
		var secretStorePath string
		if len(vals.Secret) > 0 {
			if !p.sm.Enabled() {
				return nil, fmt.Errorf("external resources: SM-API not configured but resource %q has secret values", er.Name)
			}
			entity := externalResourceSecretEntity(er.Name, env)
			path, _, werr := p.sm.WriteExternalResourceSecret(ctx, ocOrgID, projectName, entity, vals.Secret)
			if werr != nil {
				return nil, fmt.Errorf("external resources: write secret for env %q: %w", env, werr)
			}
			secretStorePath = path
		}
		binding, berr := buildExternalResourceBinding(projectName, er.Name, env, latest, secretStorePath, vals.Plain)
		if berr != nil {
			return nil, berr
		}
		if _, err := p.rc.EnsureBinding(ctx, orgHandle, binding); err != nil {
			return nil, fmt.Errorf("external resources: ensure binding for env %q: %w", env, err)
		}
		result.BindingByEnv[env] = binding.Metadata.Name
	}
	return result, nil
}

// Deprovision is the 2-step delete: per-env bindings first (their retainPolicy
// cascades the DP ConfigMap/ExternalSecret), then the Resource (its finalizer
// blocks until bindings are gone). The ResourceType is long-lived — never
// deleted.
func (p *ExternalResourceProvisioner) Deprovision(ctx context.Context, orgHandle, projectName, name string, envs []string) error {
	resourceName := ExternalResourceName(projectName, name)
	for _, env := range envs {
		if err := p.rc.DeleteBinding(ctx, orgHandle, resourceName+"-"+env); err != nil {
			return fmt.Errorf("external resources: delete binding (%s/%s): %w", name, env, err)
		}
	}
	if err := p.rc.DeleteResource(ctx, orgHandle, resourceName); err != nil {
		return fmt.Errorf("external resources: delete resource (%s): %w", name, err)
	}
	return nil
}

// ExternalResourceRunnerSecret describes one external resource's per-env
// secret bundle for the coding-agent runner: the SM-API vault KV path + the
// secret key list. The dispatcher materialises these into the runner pod (the
// agent integration-tests against the live service during implementation).
type ExternalResourceRunnerSecret struct {
	KVPath string   // user-app-secrets/<orgNs>/<secretRefName>
	Keys   []string // the secret config keys (== env var names + the SM-API properties)
}

// ResolveRunnerSecrets returns the per-run-ExternalSecret inputs for the
// external resources a task depends on, for one environment: the secret key
// list (from the org catalog) + the SM-API vault path (read back off the
// resource's per-env ResourceReleaseBinding, where Provision pinned it).
// Resources with no secret keys (or not yet provisioned) are skipped.
func (p *ExternalResourceProvisioner) ResolveRunnerSecrets(ctx context.Context, orgHandle, projectName, env string, names []string) ([]ExternalResourceRunnerSecret, error) {
	out := make([]ExternalResourceRunnerSecret, 0, len(names))
	for _, name := range names {
		er, err := p.lookup.Get(ctx, orgHandle, name)
		if err != nil || er == nil {
			continue
		}
		var keys []string
		for _, k := range er.ConfigKeys {
			if k.Secret {
				keys = append(keys, k.Key)
			}
		}
		if len(keys) == 0 {
			continue
		}
		b, err := p.rc.GetBinding(ctx, orgHandle, ExternalResourceBindingName(projectName, name, env))
		if err != nil || b == nil {
			continue
		}
		var cfg map[string]string
		if len(b.Spec.ResourceTypeEnvironmentConfigs) > 0 {
			_ = json.Unmarshal(b.Spec.ResourceTypeEnvironmentConfigs, &cfg)
		}
		path := cfg[openchoreo.SecretStorePathField]
		if path == "" {
			continue
		}
		out = append(out, ExternalResourceRunnerSecret{KVPath: path, Keys: keys})
	}
	return out, nil
}

// ---- pure builders (unit-tested) -------------------------------------------

// externalResourceSecretEntity is the SM-API EntityName for an external
// resource's per-env secret bundle — one SM-API secret per (project, resource,
// env).
func externalResourceSecretEntity(name, env string) string { return "extres-" + name + "-" + env }

// buildExternalResource references the version-pinned cluster RT name (rtName),
// not the logical er.ResourceTypeName, so the Resource binds to the freshly
// authored RT rather than a stale same-named one.
func buildExternalResource(projectName string, er *models.ExternalResource, rtName string) *openchoreo.Resource {
	return &openchoreo.Resource{
		Metadata: openchoreo.OCObjectMeta{Name: ExternalResourceName(projectName, er.Name)},
		Spec: openchoreo.ResourceSpec{
			Owner: openchoreo.ResourceOwner{ProjectName: projectName},
			Type:  openchoreo.ResourceTypeRef{Kind: "ResourceType", Name: rtName},
		},
	}
}

func buildExternalResourceBinding(projectName, name, env, latestRelease, secretStorePath string, plain map[string]string) (*openchoreo.ResourceReleaseBinding, error) {
	cfg := map[string]string{}
	for k, v := range plain {
		cfg[k] = v
	}
	if secretStorePath != "" {
		cfg[openchoreo.SecretStorePathField] = secretStorePath
	}
	raw, err := json.Marshal(cfg)
	if err != nil {
		return nil, fmt.Errorf("external resources: marshal env configs: %w", err)
	}
	resourceName := ExternalResourceName(projectName, name)
	return &openchoreo.ResourceReleaseBinding{
		Metadata: openchoreo.OCObjectMeta{Name: ExternalResourceBindingName(projectName, name, env)},
		Spec: openchoreo.ResourceReleaseBindingSpec{
			Owner:                          openchoreo.ResourceReleaseBindingOwner{ProjectName: projectName, ResourceName: resourceName},
			Environment:                    env,
			ResourceRelease:                latestRelease,
			ResourceTypeEnvironmentConfigs: json.RawMessage(raw),
		},
	}, nil
}

func toRTConfigKeys(in []models.ConfigKey) []openchoreo.ExternalResourceConfigKey {
	out := make([]openchoreo.ExternalResourceConfigKey, 0, len(in))
	for _, k := range in {
		out = append(out, openchoreo.ExternalResourceConfigKey{Key: k.Key, Secret: k.Secret})
	}
	return out
}
