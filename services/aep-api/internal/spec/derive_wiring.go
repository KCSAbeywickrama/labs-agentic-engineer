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

package spec

import "github.com/wso2/aep/aep-api/internal/platform/ocname"

// DESIGN-TIME ENV BINDINGS.
//
// A component reaches a platform resource through env vars OpenChoreo injects
// from the resource's binding outputs. The coding agent authors every line of
// workload.yaml, so it has to be TOLD which env var carries which output — and
// the platform used to tell it by posting a comment on the run's issues at gate
// resolution. That push had a snapshot audience: a gate that resolved before the
// implementation issues existed told nobody, the agent read "no block ⇒ no
// dependencies", and shipped its own SQLite file instead of the Postgres it had
// provisioned.
//
// The information never needed the gate. Both halves of a resource's wiring are
// pure functions of the design plus the resource type's DECLARED outputs:
//
//	ref         = ExternalResourceName(project, depName)   — deterministic
//	envBindings = EnvVarName(depName, output)               — pure string work
//
// So it is derived HERE, at design save, and committed into design.json next to
// the dependency it belongs to — the same artifact, in the same tree, that the
// agent already reads as its spec. No ordering, no audience, no idempotency
// marker. Only a cross-project org-service endpoint still needs live resolution
// (its project, component and visibility are another project's business) and
// keeps its dispatch-time channel.
//
// A SIBLING'S ENDPOINT is derived here too, for exactly the same reason, and the
// bug that proved it was worse than the SQLite one because it produced a value
// that LOOKED right. Every field is a pure function of the design:
//
//	component   = ScopedComponentName(project, depName)     — deterministic
//	name        = the sibling's own EndpointName()          — read from its design
//	visibility  = "project"                                 — same project
//	envBindings = {address: ServiceURLEnvName(depName)}     — pure string work
//
// It was nonetheless resolved from the LIVE endpoint catalog at dispatch, and that
// catalog only lists components which have already DEPLOYED. On a first delivery,
// where siblings are coded in one cycle before anything runs, it could answer
// nothing — so the comment was never posted and the agent invented `component`. It
// wrote the FRIENDLY name; OpenChoreo resolves endpoint dependencies by SCOPED
// name, matched no binding, and left the consumer at `Ready=False /
// ConnectionsPending`. Nothing crashed — the release still rendered and applied,
// minus the address env var — so the only symptom was a project reporting
// "deploying" forever. Deriving it here is what makes a first delivery work
// without a second build to fix it up.
//
// Three kinds carry wiring, with three different output vocabularies:
//
//   - component — resolves to a sibling's ENDPOINT, not to resource outputs, so it
//     carries the endpoints[] variant and one `address` binding.
//   - platform-resource — outputs are generic (host, port, …), so the env var is
//     prefixed with the dependency name. They come off the ClusterResourceType,
//     which is why this derivation needs the catalog at all.
//   - external — outputs are the resource's own config keys, already namespaced
//     by the schema the design itself declares, so the env var IS the key and no
//     catalog read is involved.
//
// Each mirrors what provisioning emits at wiring time, and all route through
// ocname (the shared naming source of truth in the kernel) so the pod env var, the
// SPA's window._env_ key and design.json cannot drift.

// deriveDependencyWiring stamps the resolved consumer-side wiring on every
// component, platform-resource and external dependency in components, and mutates
// them in place. projectID is the OC name prefix (the ref's and the scoped
// component name's project half).
//
// It OVERWRITES an existing wiring rather than preserving it: the value is
// derived, so a dependency rename, a config-key edit or a resource type gaining
// an output must recompute it — and overwriting is also what makes an
// agent-authored value harmless, so neither write gate has to reject a field the
// design agent will read and echo back.
//
// A dependency it cannot derive wiring for has its wiring REMOVED, not left
// stale: absent means "not derivable yet" (an unknown resourceType, an external
// dep with no config keys, a sibling the design does not declare), and a stale
// value is worse than none — the agent would author a workload.yaml that binds env
// vars the binding never exposes. The coding agent treats a declared-but-unwired
// dependency as a platform fault and reports it, which is the loud failure the old
// silent path lacked.
func deriveDependencyWiring(components []DesignComponent, types map[string]CRTType, projectID string) {
	// A sibling's endpoint name comes off the SIBLING's design, so index the set
	// once before walking the dependencies that point into it.
	endpointNames := make(map[string]string, len(components))
	for _, c := range components {
		endpointNames[c.Name] = c.EndpointName()
	}
	for i := range components {
		deps := components[i].Dependencies
		for j := range deps {
			deps[j].Wiring = dependencyWiring(deps[j], types, projectID, endpointNames)
		}
	}
}

// dependencyWiring computes one dependency's wiring, or nil when it has none to
// compute. org-service is the one kind that never carries one: its project,
// component and visibility belong to another project's design, so it stays on the
// dispatch-time `endpoints:` channel that can actually resolve them.
func dependencyWiring(d Dependency, types map[string]CRTType, projectID string, endpointNames map[string]string) *DependencyWiring {
	var outputs []string
	switch d.Kind {
	case DependencyKindComponent:
		return siblingEndpointWiring(d.Name, projectID, endpointNames)
	case DependencyKindPlatformResource:
		// A nil map (no catalog read) or an unknown resourceType yields no
		// outputs — nothing to bind, so nothing is stamped.
		outputs = types[d.ResourceType].Outputs
	case DependencyKindExternal:
		for _, k := range d.Config {
			if k.Key != "" {
				outputs = append(outputs, k.Key)
			}
		}
	default:
		return nil
	}
	if len(outputs) == 0 {
		return nil
	}
	bindings := make(map[string]string, len(outputs))
	for _, out := range outputs {
		if out == "" {
			continue
		}
		if d.Kind == DependencyKindExternal {
			// Already namespaced by the external resource's own config schema —
			// prefixing would rename the very keys the design declares.
			bindings[out] = out
			continue
		}
		bindings[out] = ocname.EnvVarName(d.Name, out)
	}
	if len(bindings) == 0 {
		return nil
	}
	return &DependencyWiring{Ref: ocname.ExternalResourceName(projectID, d.Name), EnvBindings: bindings}
}

// siblingEndpointWiring resolves a `component` dependency to one
// `dependencies.endpoints[]` entry, or nil when the named sibling is not in this
// design.
//
// An unknown sibling yields NO wiring rather than a guessed one. The endpoint name
// is the sibling's to declare, and inventing "http" for a component that is not
// there would stamp a confident value for a dependency the design cannot satisfy —
// exactly the failure this derivation exists to end. Absent instead makes the
// dangling dependency the coding agent's reportable platform fault.
//
// `project` is deliberately NOT set: it is omitted for a same-project target (see
// provisioning's workloadEndpointDepYAML), and `component` alone is what
// OpenChoreo resolves within the project.
func siblingEndpointWiring(depName, projectID string, endpointNames map[string]string) *DependencyWiring {
	endpoint, ok := endpointNames[depName]
	if !ok || endpoint == "" {
		return nil
	}
	return &DependencyWiring{Endpoint: &EndpointWiring{
		Component:   ocname.ScopedComponentName(projectID, depName),
		Name:        endpoint,
		Visibility:  EndpointVisibilityProject,
		EnvBindings: map[string]string{EndpointAddressOutput: ocname.ServiceURLEnvName(depName)},
	}}
}

// dependencyWiringEqual reports whether two (possibly nil) wirings describe the
// same value — the change detection that decides whether a component's
// design.json is re-committed. Compared by value, not by pointer: the derivation
// rebuilds the struct every pass, so pointer identity always differs.
func dependencyWiringEqual(a, b *DependencyWiring) bool {
	if a == nil || b == nil {
		return a == b
	}
	if a.Ref != b.Ref || !envBindingsEqual(a.EnvBindings, b.EnvBindings) {
		return false
	}
	return endpointWiringEqual(a.Endpoint, b.Endpoint)
}

// endpointWiringEqual compares the endpoints[] variant. Omitting it here would
// re-commit every design.json on every save once the sibling variant exists (a
// derived value the diff never looks at always reads as changed).
func endpointWiringEqual(a, b *EndpointWiring) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Component == b.Component && a.Name == b.Name &&
		a.Visibility == b.Visibility && envBindingsEqual(a.EnvBindings, b.EnvBindings)
}

func envBindingsEqual(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}
