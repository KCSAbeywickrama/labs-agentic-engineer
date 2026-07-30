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
// marker. What genuinely needs live resolution (a cross-project org-service
// endpoint, a sibling's endpoint name) keeps its dispatch-time channel.
//
// Two kinds carry wiring, with two different output vocabularies:
//
//   - platform-resource — outputs are generic (host, port, …), so the env var is
//     prefixed with the dependency name. They come off the ClusterResourceType,
//     which is why this derivation needs the catalog at all.
//   - external — outputs are the resource's own config keys, already namespaced
//     by the schema the design itself declares, so the env var IS the key and no
//     catalog read is involved.
//
// Both mirror what provisioning's bindingEnvBindings does at wiring time, and
// both route through ocname (the shared naming source of truth in the kernel) so
// the pod env var, the SPA's window._env_ key and design.json cannot drift.

// deriveDependencyWiring stamps the resolved consumer-side wiring on every
// platform-resource and external dependency in components, and mutates them in
// place. projectID is the OC-Resource name prefix (the ref's project half).
//
// It OVERWRITES an existing wiring rather than preserving it: the value is
// derived, so a dependency rename, a config-key edit or a resource type gaining
// an output must recompute it — and overwriting is also what makes an
// agent-authored value harmless, so neither write gate has to reject a field the
// design agent will read and echo back.
//
// A dependency it cannot derive wiring for has its wiring REMOVED, not left
// stale: absent means "not derivable yet" (an unknown resourceType, an external
// dep with no config keys), and a stale value is worse than none — the agent
// would author a workload.yaml that binds env vars the binding never exposes.
// The coding agent treats a declared-but-unwired dependency as a platform fault
// and reports it, which is the loud failure the old silent path lacked.
func deriveDependencyWiring(components []DesignComponent, types map[string]CRTType, projectID string) {
	for i := range components {
		deps := components[i].Dependencies
		for j := range deps {
			deps[j].Wiring = dependencyWiring(deps[j], types, projectID)
		}
	}
}

// dependencyWiring computes one dependency's wiring, or nil when it has none to
// compute. Kinds other than platform-resource and external never carry one:
// a component/org-service dependency resolves to an endpoint address, not to
// resource outputs, and its wiring is the dispatch-time `endpoints:` half.
func dependencyWiring(d Dependency, types map[string]CRTType, projectID string) *DependencyWiring {
	var outputs []string
	switch d.Kind {
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

// dependencyWiringEqual reports whether two (possibly nil) wirings describe the
// same value — the change detection that decides whether a component's
// design.json is re-committed. Compared by value, not by pointer: the derivation
// rebuilds the struct every pass, so pointer identity always differs.
func dependencyWiringEqual(a, b *DependencyWiring) bool {
	if a == nil || b == nil {
		return a == b
	}
	if a.Ref != b.Ref || len(a.EnvBindings) != len(b.EnvBindings) {
		return false
	}
	for k, v := range a.EnvBindings {
		if b.EnvBindings[k] != v {
			return false
		}
	}
	return true
}
