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

package models

import "strings"

// Component type vocabulary. AEP uses OpenChoreo's OWN terms end-to-end —
// these are OC's ComponentType names minus the `deployment/` prefix (OC:
// `deployment/service`, `deployment/web-application`), so no translation
// layer exists anywhere: the agent contract emits these values, design.json
// stores them verbatim, and platform code compares them directly.
const (
	ComponentTypeService        = "service"
	ComponentTypeWebApplication = "web-application"
)

// DesignComponent describes a single component within a design.
// This matches the structured output schema from the AI Agent SDK.
type DesignComponent struct {
	Name          string       `json:"name"`
	ComponentType string       `json:"componentType"`
	Version       string       `json:"version,omitempty"`
	Language      string       `json:"language"`
	Dependencies  []Dependency `json:"dependencies"`
	Entrypoint    string       `json:"entrypoint"`
	Buildpack     string       `json:"buildpack"`
	AppPath       string       `json:"appPath"`
	// Exposure is the gateway exposure of the component's endpoint
	// ("internet" | "intranet"). It is distinct from ExposesAPI (which is the
	// managed-API auth policy) — a component can be intranet-exposed without a
	// managed API and vice versa. Sourced from the design.json `exposure` key.
	Exposure string `json:"exposure,omitempty"`
	// Description is the single-responsibility prose (what the component does /
	// does NOT do) — the design.json `description` key. This is the successor to
	// the per-component design.md markdown body.
	Description string `json:"description,omitempty"`
	// Endpoint is the component's single network endpoint, sourced from the
	// design.json `endpoint` key. Only its Name is declared — the shared key
	// the coding agent's workload.yaml and the platform's api-configuration
	// trait both reference. Nil when the design declares no endpoint; callers
	// use EndpointName() to get the effective name (defaulting to "http").
	Endpoint                   *ComponentEndpoint `json:"endpoint,omitempty"`
	OpenAPISpec                string             `json:"openAPISpec"`
	ComponentAgentInstructions string             `json:"componentAgentInstructions"`
	ExposesAPI                 *ExposesAPI        `json:"exposesAPI,omitempty"`
	// SkillsApplied are the skill names applied to THIS component (per-component
	// — the coding runner materializes exactly these when building it). Sourced
	// from the component design.json `skillsApplied` key.
	SkillsApplied []string `json:"skillsApplied,omitempty"`
}

// DefaultEndpointName is the conventional workload endpoint name the platform's
// managed-API (api-configuration) trait binds to when a component's design.json
// declares no explicit endpoint.
const DefaultEndpointName = "http"

// ComponentEndpoint is the component's single network endpoint as declared in
// design.json. Only Name is carried: it is the SINGLE SOURCE OF TRUTH for the
// endpoint name shared between the coding agent's workload.yaml
// (spec.endpoints[].name) and the api-configuration trait's endpointName. The
// port is deliberately NOT declared here — it stays in workload.yaml, chosen to
// match the app's actual listen port. Mirrors the agent-stream TS `Endpoint`.
type ComponentEndpoint struct {
	Name string `json:"name"`
}

// EndpointName returns the effective workload endpoint name for the component:
// the design.json `endpoint.name` when declared, otherwise the conventional
// DefaultEndpointName ("http"). This is the one place the default lives, so
// every consumer (trait emit, instance naming) agrees.
func (c DesignComponent) EndpointName() string {
	if c.Endpoint != nil && c.Endpoint.Name != "" {
		return c.Endpoint.Name
	}
	return DefaultEndpointName
}

// DependencyKind discriminates the unified Dependency entry.
type DependencyKind = string

const (
	DependencyKindComponent        DependencyKind = "component"
	DependencyKindOrgService       DependencyKind = "org-service"
	DependencyKindExternal         DependencyKind = "external"
	DependencyKindPlatformResource DependencyKind = "platform-resource"
)

// Dependency Status/Reason enum values. These are read-time computed (see
// the Dependency.Status/Reason doc below) — never authored, never persisted.
// ComputeDependencyStatus (dependency_status.go) is the single authority: for
// kind=org-service, namespace-visible → Resolved, catalog-visible elsewhere →
// Blocked/AccessRequired, absent → Unresolved/NotFound. For kind=external,
// 2+ Candidates → Ambiguous (no reason); a registry-known name → Resolved; no
// Style → Unresolved/NeedsInput; Style=rest-api with no SpecPath →
// Unresolved/NeedsSpec; Style=sdk with no Package → Unresolved/NeedsInput;
// otherwise Resolved. component/platform-resource are always Resolved here.
// The design-save proceed-gate (design.ErrUnresolvedDependency) blocks on all
// non-resolved states.
const (
	DependencyStatusResolved   = "resolved"
	DependencyStatusBlocked    = "blocked"
	DependencyStatusUnresolved = "unresolved"
	DependencyStatusAmbiguous  = "ambiguous"

	DependencyReasonAccessRequired = "access-required"
	DependencyReasonNotFound       = "not-found"
	// DependencyReasonNeedsSpec pairs with DependencyStatusUnresolved on an
	// external `style: rest-api` dependency with no specPath yet — the
	// contract-collection state (see ComputeDependencyStatus rule 4).
	DependencyReasonNeedsSpec = "needs-spec"
	// DependencyReasonNeedsInput pairs with DependencyStatusUnresolved on an
	// external dependency the platform cannot resolve without more from the
	// architect: no style at all, or an `sdk` style with no package yet (see
	// ComputeDependencyStatus rules 3 and 5).
	DependencyReasonNeedsInput = "needs-input"
)

// DependencyStyle is the closed set of external dependency shapes (mirrors the
// agent-stream TS `DependencyStyle`). Meaningful only on kind=external.
type DependencyStyle = string

const (
	DependencyStyleRestAPI DependencyStyle = "rest-api"
	DependencyStyleSDK     DependencyStyle = "sdk"
)

// Dependency is the unified, kind-discriminated dependency entry on a
// component. It subsumes the legacy DependsOn (sibling components) and the
// external HTTP APIs a component consumed at runtime. Go has no native
// discriminated union, so a single struct carries every kind's fields; `Kind`
// selects which are meaningful (Config for external; ResourceType/Parameters
// for platform-resource; the rest common). Mirrors the agents-service Zod
// `Dependency`.
type Dependency struct {
	Kind        DependencyKind `json:"kind"`
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	// Status and Reason are READ-TIME computed fields, derived by
	// ComputeDependencyStatus (the single resolution authority) against
	// freshly-fetched resolver-port lookups on every design read; they are NOT
	// persisted and carry NO gorm/yaml tags — plain wire JSON only. The
	// architect never sets them.
	//   Status: resolved|ambiguous|unresolved|blocked
	//   Reason: needs-spec|needs-input|not-found|access-required
	Status string `json:"status,omitempty"`
	Reason string `json:"reason,omitempty"`
	// external: REST API ("rest-api") or SDK ("sdk") shape. Meaningful ONLY on
	// kind=external — a platform-resource is catalog-picked, an org-service is
	// catalog-resolved; neither has web provenance. Every resolution state is
	// DERIVED from which of Style/Package/Sources/Candidates/SpecPath/SpecUrl
	// are present, never a stored flag (the old NeedsSpec boolean is gone).
	// Enforced mechanically by the zod write-gate (superRefine) and the Go fold
	// validator (agentfold), not by this struct.
	Style DependencyStyle `json:"style,omitempty"`
	// external (sdk style): one ecosystem-prefixed package identifier, e.g.
	// "npm:stripe@^14" — version inline but optional (omitted ⇒ latest
	// compatible). External-only.
	Package string `json:"package,omitempty"`
	// external: stored contract path, component-relative (dependencies/<name>.openapi.yaml).
	SpecPath string `json:"specPath,omitempty"`
	// external: transient published-OpenAPI hint auto-fetched at design save then cleared.
	SpecUrl string `json:"specUrl,omitempty"`
	// external: provenance of the pinned/declared intent (docs + spec +
	// package-registry links) — survives resolution. On pin, the chosen
	// candidate's DocsUrl/SpecUrl/package-registry link fold into this slice.
	// Distinct from Candidates[].DocsUrl (a single per-option link). Present
	// only with at least one entry — never an empty slice. External-only.
	Sources []string `json:"sources,omitempty"`
	// external: 2+ identified-but-not-pinned options — the "ambiguous"
	// resolution state. Omitted, never empty: one option fully known collapses
	// to a resolved dep, one option partially known is a partial dep (not a
	// candidate), 2+ identified options is ambiguous. Pinning REMOVES the
	// field. External-only.
	Candidates []DependencyCandidate `json:"candidates,omitempty"`
	// external: the config key schema the consuming component codes against.
	Config []ConfigKey `json:"config,omitempty"`
	// platform-resource: the registered (Cluster)ResourceType + provisioning params.
	// Parameter values are mixed scalar types (string | number | bool) per the
	// target (Cluster)ResourceType's OpenAPI v3 schema — e.g. postgres-cnpg's
	// `instances` is an integer while `storage`/`version` are strings — so the
	// map is any-valued and marshalled verbatim into the OC Resource
	// spec.parameters (numbers must stay JSON numbers for CRD validation).
	ResourceType string         `json:"resourceType,omitempty"`
	Parameters   map[string]any `json:"parameters,omitempty"`
}

// DependencyCandidate is one option in an ambiguous external dependency's
// resolution set (2+ required — see Dependency.Candidates; a single candidate
// never occurs). Mirrors the agent-stream TS `DependencyCandidate`.
type DependencyCandidate struct {
	Name        string          `json:"name"`
	Style       DependencyStyle `json:"style"`
	Description string          `json:"description,omitempty"`
	// DocsUrl is the single canonical docs link for THIS option (lean
	// comparison cards) — distinct from the dep-level Sources, which is the
	// pinned choice's provenance after resolution.
	DocsUrl string `json:"docsUrl,omitempty"`
	SpecUrl string `json:"specUrl,omitempty"`
	// Package: sdk-style candidates only; ecosystem-prefixed package identifier.
	Package string `json:"package,omitempty"`
}

// ConfigKey is one env-var key a component reads at runtime. For an external
// resource these keys form the resource's schema (drives the OC ResourceType).
// Secret keys route through the secret path. `secret` is optional and omitted
// when false — a key with no `secret` field is a plain (non-secret) config value.
type ConfigKey struct {
	Key    string `json:"key"`
	Secret bool   `json:"secret,omitempty"`
	// Description is an optional human-readable note on what this value is for,
	// authored alongside the key. The Build dependency drawer renders it under
	// the field so the user knows what to supply.
	Description string `json:"description,omitempty"`
	// DefaultValue is an optional suggested initial value the agent MAY set for a
	// NON-secret key it can infer a sensible default for (a region, a base URL).
	// The Build dependency drawer pre-fills the field with it. Never set for a
	// secret key — a credential has no default to invent.
	DefaultValue string `json:"defaultValue,omitempty"`
}

// ComponentDependsOn returns the names of this component's sibling-component
// dependencies — the successor to the legacy DependsOn []string field. Used
// for task deploy-gating, runtime-config URL wiring, and task diffing.
func (c DesignComponent) ComponentDependsOn() []string {
	out := make([]string, 0, len(c.Dependencies))
	for _, d := range c.Dependencies {
		if d.Kind == DependencyKindComponent {
			out = append(out, d.Name)
		}
	}
	return out
}

// OrgServiceDependsOn returns the names of this component's cross-project
// `org-service` dependencies. Each name is the provider component name — the
// key the org endpoint catalog resolves to a namespace-visible endpoint. Used
// to wire the consumer Workload's OC WorkloadConnection post-deploy.
func (c DesignComponent) OrgServiceDependsOn() []string {
	out := make([]string, 0, len(c.Dependencies))
	for _, d := range c.Dependencies {
		if d.Kind == DependencyKindOrgService {
			out = append(out, d.Name)
		}
	}
	return out
}

// ProvisionDependsOn returns the names of this component's dependencies that
// gate dispatch on a provisioning run (dependency-management §3.6): external
// (config-collection) and platform-resource (resource-provisioning). org-service
// is gated at PROCEED, not dispatch, so it is excluded. Used by the funnel's
// dependency-kind-aware gate to hold a consumer coding task until each provision
// dependency's aep:provision issue derives deployed.
func (c DesignComponent) ProvisionDependsOn() []string {
	out := make([]string, 0, len(c.Dependencies))
	for _, d := range c.Dependencies {
		if d.Kind == DependencyKindExternal || d.Kind == DependencyKindPlatformResource {
			out = append(out, d.Name)
		}
	}
	return out
}

// ExternalDependencies returns the external + org-service dependencies — the
// resource-bearing entries. Used to surface context into issue bodies and to
// drive value collection.
func (c DesignComponent) ExternalDependencies() []Dependency {
	out := make([]Dependency, 0, len(c.Dependencies))
	for _, d := range c.Dependencies {
		if d.Kind == DependencyKindExternal || d.Kind == DependencyKindOrgService {
			out = append(out, d)
		}
	}
	return out
}

// ExposesAPI declares HTTP API exposure policy for a service component.
// Absent / nil ⇒ public (no gateway hop). `Auth: "end-user-required"` ⇒
// the API Platform gateway validates an end-user JWT and injects
// UserContext (default "X-User-Id") before forwarding upstream.
type ExposesAPI struct {
	Managed     bool   `json:"managed,omitempty"`
	Auth        string `json:"auth,omitempty"`        // "end-user-required" | "service-required" | "none"
	UserContext string `json:"userContext,omitempty"` // injected header name
	// OrgPublished marks a service's endpoint as consumable by OTHER projects in
	// the org. When set, the coding agent writes `visibility: [external,
	// namespace]` on the endpoint in its workload.yaml, and the org endpoint
	// catalog lists it as a cross-project `org-service` target. Deliberate +
	// source-of-truth: the provider owns this; the platform never patches it.
	OrgPublished bool `json:"orgPublished,omitempty"`
}

// UnionExternalConfigKeys scans comps and returns, per external dependency
// name, the UNION of Config[] declared by every component whose
// Dependencies[] names it — a key present in ANY component's Config is
// included, and Secret is OR'd across every declaring component, so a key
// already marked secret by one component can never be downgraded to plain by
// another component that omits it or marks it plain (secret wins). Dependency
// names are grouped case-insensitively (the same fold match
// provisioning.findDepInProject uses to locate a dependency) but keyed in the
// result by the FIRST-SEEN exact casing, so a stray casing difference between
// two components declaring "the same" external dependency cannot split it
// into two separate map entries.
//
// This is the single source of truth two request-time classification paths
// read (provisioning.SaveValues and dependencies/resources'
// secretKeysByName). It MUST stay behaviorally identical to the build path's
// independently-implemented secretKeysByDep
// (internal/feature/build/inputs_coordinator.go), which performs the same
// union-merge, secret-wins accumulation in its own package.
func UnionExternalConfigKeys(comps []DesignComponent) map[string][]ConfigKey {
	out := map[string][]ConfigKey{}
	canonName := map[string]string{}        // lower(name) -> first-seen exact name
	keyIndex := map[string]map[string]int{} // lower(name) -> config key -> index into out[canonName[lower(name)]]
	for _, c := range comps {
		for _, d := range c.Dependencies {
			if d.Kind != DependencyKindExternal {
				continue
			}
			lower := strings.ToLower(d.Name)
			name, ok := canonName[lower]
			if !ok {
				name = d.Name
				canonName[lower] = name
				keyIndex[lower] = map[string]int{}
			}
			idx := keyIndex[lower]
			merged := out[name]
			for _, k := range d.Config {
				if i, exists := idx[k.Key]; exists {
					if k.Secret {
						merged[i].Secret = true
					}
					continue
				}
				idx[k.Key] = len(merged)
				merged = append(merged, k)
			}
			out[name] = merged
		}
	}
	return out
}

// UnionExternalConfigFor returns the UNION Config[] schema (see
// UnionExternalConfigKeys) for the external dependency matching depName
// case-insensitively, or nil when no component in comps declares it. Callers
// that already know the exact dependency name they want (e.g. SaveValues)
// use this instead of scanning UnionExternalConfigKeys's full map themselves.
func UnionExternalConfigFor(comps []DesignComponent, depName string) []ConfigKey {
	for name, cfg := range UnionExternalConfigKeys(comps) {
		if strings.EqualFold(name, depName) {
			return cfg
		}
	}
	return nil
}

// DesignComponents is a slice of DesignComponent.
type DesignComponents []DesignComponent

type Design struct {
	ProjectID         string            `json:"projectId"`
	OrgID             string            `json:"-"`
	Overview          string            `json:"overview"`
	Components        DesignComponents  `json:"components"`
	Status            string            `json:"status"`
	Version           int               `json:"version"`
	Versions          []ArtifactVersion `json:"versions,omitempty"`
	HasUnsavedChanges bool              `json:"hasUnsavedChanges"`
	SourceSpec        string            `json:"sourceSpec,omitempty"`
}
