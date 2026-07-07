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

package runtimeconfig

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strings"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/dependencies/resources"
	"github.com/wso2/aep/aep-api/internal/platform/k8sname"
	"github.com/wso2/aep/aep-api/models"
)

const (
	// thunderAppResourceType is the platform-resource ResourceType a web-app
	// declares to sign end users in via OIDC. Its presence on a web-app gates
	// THUNDER_* emission. Mirrors design.thunderAppResourceType.
	thunderAppResourceType = "thunder-app"
	// bindingEnv is the single environment runtime-config targets (mirrors
	// provisioning.defaultEnv). The thunder-app binding whose outputs + redirect
	// URIs drive the SPA lives in this env.
	bindingEnv = "development"
	// thunderCallbackPath is appended to the SPA origin to form the OIDC
	// redirect URI the SPA registers with Thunder and navigates back to.
	thunderCallbackPath = "/callback"
)

// RuntimeConfigService emits the per-web-app `env-config.js` file onto
// each ReleaseBinding's `workloadOverrides.container.files`. The SPA's
// `index.html` loads `/env-config.js` synchronously before its bundle,
// so the values land on `window._env_` before any React module runs.
//
// The BFF plays the platform-engineer role here — the coding agent
// never sees the upstream URL, the OIDC client_id, or any redirect URI.
// One image runs unchanged in every environment; per-env values arrive
// at ReleaseBinding time.
type RuntimeConfigService struct {
	componentClient openchoreo.ComponentClient
	// resourceClient reads the thunder-app dependency's per-env
	// ResourceReleaseBinding — its status.outputs carry the OIDC config
	// (client_id/issuer/scopes, resolved by OC) the SPA needs — and patches the
	// binding's redirectUris declaratively so the operator registers the SPA's
	// callback URL. nil in paths that never emit THUNDER_*.
	resourceClient openchoreo.ResourceClient
	store          *artifacts.ArtifactStore
}

func NewRuntimeConfigService(componentClient openchoreo.ComponentClient, resourceClient openchoreo.ResourceClient, store *artifacts.ArtifactStore) *RuntimeConfigService {
	return &RuntimeConfigService{
		componentClient: componentClient,
		resourceClient:  resourceClient,
		store:           store,
	}
}

// EmitForComponent computes the env-config.js content for the named
// component and writes it onto each of the component's ReleaseBindings.
// No-op when the component is not a web-app.
//
// Idempotent + best-effort. The OC client returns a soft no-op when no
// ReleaseBindings exist yet — the cascade hook re-fires on every deploy
// in the project so the file lands after the first build catches up.
func (s *RuntimeConfigService) EmitForComponent(ctx context.Context, orgID, projectID, componentName string) error {
	if s == nil {
		return nil
	}
	if orgID == "" || projectID == "" || componentName == "" {
		return fmt.Errorf("runtime_config: empty orgID/projectID/componentName")
	}

	design, err := s.store.ReadDesign(ctx, orgID, projectID)
	if err != nil {
		if artifacts.IsNotFound(err) {
			return nil
		}
		return fmt.Errorf("runtime_config: read design: %w", err)
	}
	if design == nil {
		return nil
	}

	var match *models.DesignComponent
	for i := range design.Components {
		if k8sname.ToK8sName(design.Components[i].Name) == componentName {
			match = &design.Components[i]
			break
		}
	}
	if match == nil || match.ComponentType != "web-app" {
		return nil
	}

	envValues, ready := s.buildEnvValues(ctx, orgID, projectID, match, design)
	if !ready {
		// One or more required keys couldn't be populated yet (transient
		// OC error, SPA URL not resolved, etc.). DO NOT write a partial
		// env-config.js — that would either blank previously valid keys
		// or ship a window._env_ that the SPA's src/env.ts throws on at
		// module load. The cascade hook re-fires on every deploy event,
		// so the next sibling deploy (or this SPA's own follow-up
		// reconcile) will retry.
		slog.InfoContext(ctx, "runtime_config: required keys not yet ready; deferring env-config.js write",
			"orgID", orgID,
			"projectID", projectID,
			"component", componentName,
			"keys", sortedKeys(envValues),
		)
		return nil
	}
	file := models.WorkflowFileVar{
		Key:       "env-config.js",
		MountPath: "/usr/share/nginx/html/",
		Value:     renderEnvConfigJS(envValues),
	}

	if err := s.componentClient.UpdateComponentWorkflowFiles(ctx, orgID, projectID, componentName, []models.WorkflowFileVar{file}); err != nil {
		return fmt.Errorf("runtime_config: update workflow files: %w", err)
	}

	slog.InfoContext(ctx, "emitting env-config.js",
		"orgID", orgID,
		"projectID", projectID,
		"component", componentName,
		"keys", sortedKeys(envValues),
	)
	return nil
}

// EmitForProjectSPAs re-emits env-config.js on every web-app component in
// the project. Called from the dispatch cascade so that when ANY component
// lands `deployed` (especially a sibling service whose external URL just
// resolved), every SPA picks up the new value in its ReleaseBinding without
// waiting for the SPA itself to re-deploy.
//
// Idempotent + best-effort: a failure on one component logs and continues.
func (s *RuntimeConfigService) EmitForProjectSPAs(ctx context.Context, orgID, projectID string) error {
	if s == nil {
		return nil
	}
	if orgID == "" || projectID == "" {
		return fmt.Errorf("runtime_config: empty orgID/projectID")
	}
	design, err := s.store.ReadDesign(ctx, orgID, projectID)
	if err != nil {
		if artifacts.IsNotFound(err) {
			return nil
		}
		return fmt.Errorf("runtime_config: read design: %w", err)
	}
	if design == nil {
		return nil
	}
	for _, c := range design.Components {
		if c.ComponentType != "web-app" {
			continue
		}
		k8sName := k8sname.ToK8sName(c.Name)
		if err := s.EmitForComponent(ctx, orgID, projectID, k8sName); err != nil {
			slog.WarnContext(ctx, "runtime_config: per-SPA emit failed; continuing",
				"orgID", orgID,
				"projectID", projectID,
				"componentName", k8sName,
				"error", err,
			)
		}
	}
	return nil
}

// buildEnvValues assembles the map that becomes `window._env_`.
//   - `API_BASE_URL` — first sibling service dep's external URL (the
//     conventional name for the primary backend).
//   - `<UPPER_SNAKE_NAME>_URL` — every dep, keyed by component name. Lets
//     a SPA with multiple backends address each one explicitly.
//   - `THUNDER_*` — OIDC config. Emitted when the webapp declares a
//     `thunder-app` platform-resource dependency. The values come from that
//     dependency's provisioned binding outputs (client_id/issuer/scopes,
//     resolved by OC); the BFF never calls Thunder from this path.
//
// buildEnvValues returns the map + a `ready` flag. The flag is false
// when a required key couldn't be populated yet (transient OC error,
// SPA URL not yet resolved, etc.). The caller must NOT write a
// partial env-config.js on `!ready` — see EmitForComponent.
func (s *RuntimeConfigService) buildEnvValues(ctx context.Context, orgID, projectID string, webapp *models.DesignComponent, design *artifacts.DesignFile) (out map[string]interface{}, ready bool) {
	out = map[string]interface{}{}
	ready = true

	// Index sibling components by name for type lookup.
	byName := make(map[string]models.DesignComponent, len(design.Components))
	for _, c := range design.Components {
		byName[c.Name] = c
	}

	var firstServiceURL string
	for _, dep := range webapp.ComponentDependsOn() {
		sibling, ok := byName[dep]
		if !ok {
			continue
		}
		// Skip non-service deps (peer webapps aren't called over HTTP).
		if sibling.ComponentType != "service" {
			continue
		}
		k8sName := k8sname.ToK8sName(dep)
		list, err := s.componentClient.ListDeployments(ctx, orgID, projectID, k8sName)
		if err != nil {
			// Transient OC failure on a required dep. Mark not-ready so
			// the caller skips the write and preserves the previously
			// valid env-config.js for the pod.
			slog.WarnContext(ctx, "runtime_config: ListDeployments error for dep; deferring",
				"projectID", projectID, "component", webapp.Name, "dep", dep, "error", err)
			ready = false
			continue
		}
		if list == nil {
			// A required dep with no deployment list is not resolvable
			// yet — defer rather than ship an incomplete env-config.js.
			ready = false
			continue
		}
		url := ""
		for _, d := range list.Items {
			if d.EndpointURL != "" {
				url = strings.TrimRight(d.EndpointURL, "/")
				break
			}
		}
		if url == "" {
			// Dep not yet deployed — not an error, but we don't have a
			// URL for it. Defer rather than ship a window._env_ that
			// will throw at module load.
			ready = false
			continue
		}
		out[upperSnakeKey(dep)+"_URL"] = url
		if firstServiceURL == "" {
			firstServiceURL = url
		}
	}
	if firstServiceURL != "" {
		out["API_BASE_URL"] = firstServiceURL
	}

	// Layer THUNDER_* — OIDC config the SPA reads to drive PKCE. Emitted when
	// the web-app declares a `thunder-app` platform-resource dependency; the
	// values come from that dependency's binding outputs (resolved by OC), not
	// from any BFF→Thunder call.
	if dep := thunderAppDep(webapp); dep != nil {
		if ok := s.layerThunderKeys(ctx, orgID, projectID, webapp, dep, out); !ok {
			ready = false
		}
	}

	return out, ready
}

// thunderAppDep returns the first platform-resource dependency with
// resourceType "thunder-app" declared by a web-app component, or nil. Its
// presence is what gates THUNDER_* emission (the successor to the retired
// caller-identity field's end-user mode check): a web-app that declares this
// dependency signs users in via OIDC against the platform IDP.
func thunderAppDep(c *models.DesignComponent) *models.Dependency {
	if c == nil || c.ComponentType != "web-app" {
		return nil
	}
	for i := range c.Dependencies {
		d := &c.Dependencies[i]
		if d.Kind == models.DependencyKindPlatformResource && d.ResourceType == thunderAppResourceType {
			return d
		}
	}
	return nil
}

// layerThunderKeys writes the OIDC client config into the env-config.js map
// from the thunder-app dependency's binding. It (1) patches the binding's dev
// resourceTypeEnvironmentConfigs with the SPA's own redirect URI (declarative —
// the operator reconciles the OAuth client to register it), then (2) reads the
// binding's status.outputs for the resolved client_id / issuer / scopes and
// layers the five THUNDER_* keys.
//
// Returns false — "defer the env-config.js write" — when a required input is
// missing: the resource client isn't wired, the SPA external URL hasn't
// resolved, the redirect-URI patch failed, or the binding outputs aren't ready
// yet (no client_id — e.g. right after the patch, before the operator
// reconciles). On defer it writes NO partial THUNDER_* keys, so the SPA is
// never shipped a window._env_ its typed env shim throws on at module load.
func (s *RuntimeConfigService) layerThunderKeys(ctx context.Context, orgID, projectID string, webapp *models.DesignComponent, dep *models.Dependency, out map[string]interface{}) bool {
	if s.resourceClient == nil {
		slog.WarnContext(ctx, "runtime_config: resourceClient not wired; deferring THUNDER_*",
			"projectID", projectID, "component", webapp.Name)
		return false
	}

	// Defer until the SPA has materialised a public URL (the OC ReleaseBinding
	// status fills the external URL after the first reconcile): the redirect +
	// after-sign-in URLs derive from it, and Thunder rejects an authorize call
	// whose redirect_uri it hasn't been told about.
	spaURL := s.componentExternalURL(ctx, orgID, projectID, webapp.Name)
	if spaURL == "" {
		slog.InfoContext(ctx, "runtime_config: SPA external URL not yet resolved; will retry on next cascade",
			"projectID", projectID, "component", webapp.Name)
		return false
	}
	spaOrigin := strings.TrimRight(spaURL, "/")
	redirectURI := spaOrigin + thunderCallbackPath

	// Patch the dependency's dev binding so the operator registers this SPA's
	// redirect URI on the OAuth client. The patch is idempotent inside the
	// client (no-op when the value is already present), so re-running on every
	// cascade doesn't churn the CR. On failure DEFER rather than emit a
	// client_id whose redirect URI Thunder would reject.
	bindingName := resources.ExternalResourceBindingName(projectID, dep.Name, bindingEnv)
	if err := s.resourceClient.PatchBindingEnvironmentConfigs(ctx, orgID, bindingName,
		map[string]string{"redirectUris": redirectURI}); err != nil {
		slog.WarnContext(ctx, "runtime_config: patch binding redirectUris failed; deferring",
			"projectID", projectID, "component", webapp.Name, "binding", bindingName, "error", err)
		return false
	}

	// Read the resolved OIDC config from the binding outputs. Not-ready (binding
	// absent/without status, or no client_id yet because the operator hasn't
	// reconciled the patch) → defer with NO partial THUNDER_* keys.
	b, err := s.resourceClient.GetBinding(ctx, orgID, bindingName)
	if err != nil {
		slog.WarnContext(ctx, "runtime_config: get thunder-app binding failed; deferring",
			"projectID", projectID, "component", webapp.Name, "binding", bindingName, "error", err)
		return false
	}
	if b == nil || b.Status == nil {
		slog.InfoContext(ctx, "runtime_config: thunder-app binding not ready; will retry on next cascade",
			"projectID", projectID, "component", webapp.Name, "binding", bindingName)
		return false
	}
	outputs := make(map[string]string, len(b.Status.Outputs))
	for _, o := range b.Status.Outputs {
		outputs[o.Name] = o.Value
	}
	clientID := outputs["client_id"]
	if clientID == "" {
		slog.InfoContext(ctx, "runtime_config: thunder-app binding outputs missing client_id; will retry on next cascade",
			"projectID", projectID, "component", webapp.Name, "binding", bindingName)
		return false
	}

	out["THUNDER_URL"] = outputs["issuer"]
	out["THUNDER_CLIENT_ID"] = clientID
	out["THUNDER_SCOPES"] = outputs["scopes"]
	out["THUNDER_REDIRECT_URI"] = redirectURI
	out["THUNDER_AFTER_SIGN_IN_URL"] = spaOrigin
	return true
}

// componentExternalURL returns the first external URL OC has resolved
// for the named component, or "" when none is materialised yet.
func (s *RuntimeConfigService) componentExternalURL(ctx context.Context, orgID, projectID, componentName string) string {
	if s.componentClient == nil {
		return ""
	}
	k8sName := k8sname.ToK8sName(componentName)
	list, err := s.componentClient.ListDeployments(ctx, orgID, projectID, k8sName)
	if err != nil || list == nil {
		return ""
	}
	for _, d := range list.Items {
		if d.EndpointURL != "" {
			return d.EndpointURL
		}
	}
	return ""
}

// renderEnvConfigJS produces the literal JS the SPA's index.html loads
// synchronously before its bundle. Keys are sorted for byte-stable
// output so equality checks don't flap.
//
// Values that fail to marshal are emitted as `null` with a comment —
// silently dropping them would leave a trailing comma that aborts the
// SPA's <script> with a SyntaxError and blanks the page. `null` is at
// least a parseable value the SPA's typed env shim can throw on
// loudly.
func renderEnvConfigJS(values map[string]interface{}) string {
	var b strings.Builder
	b.WriteString("window._env_ = {\n")
	keys := sortedKeys(values)
	for i, k := range keys {
		raw, err := json.Marshal(values[k])
		if err != nil || len(raw) == 0 {
			raw = []byte("null")
		}
		b.WriteString("  ")
		// JS-side keys are bare identifiers — safe to emit unquoted since
		// upperSnakeKey returns only [A-Z0-9_].
		b.WriteString(k)
		b.WriteString(": ")
		b.Write(raw)
		if i < len(keys)-1 {
			b.WriteString(",")
		}
		b.WriteString("\n")
	}
	b.WriteString("};\n")
	return b.String()
}

func sortedKeys(m map[string]interface{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// upperSnakeKey converts a component name (kebab- or camelCase) into the
// upper-snake form used as a `window._env_` key prefix. Drops any chars
// outside [A-Za-z0-9_] so the result is a safe JS identifier.
func upperSnakeKey(name string) string {
	var b strings.Builder
	prevAlnum := false
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r - 'a' + 'A')
			prevAlnum = true
		case r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			b.WriteRune(r)
			prevAlnum = true
		case r == '-' || r == '_':
			if prevAlnum {
				b.WriteRune('_')
			}
			prevAlnum = false
		default:
			prevAlnum = false
		}
	}
	return strings.TrimRight(b.String(), "_")
}
