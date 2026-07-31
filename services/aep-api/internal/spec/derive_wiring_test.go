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

import (
	"strings"
	"testing"
)

// postgresType is the sample platform resource type: the same five outputs the
// shipped postgres-cnpg ClusterResourceType declares, in its order.
func postgresType() map[string]CRTType {
	return map[string]CRTType{
		"postgres-cnpg": {Outputs: []string{"host", "port", "dbname", "user", "password"}},
	}
}

func platformDep(name, resourceType string) Dependency {
	return Dependency{Kind: DependencyKindPlatformResource, Name: name, ResourceType: resourceType}
}

func wiringOf(t *testing.T, comps []DesignComponent, depName string) *DependencyWiring {
	t.Helper()
	for _, c := range comps {
		for _, d := range c.Dependencies {
			if d.Name == depName {
				return d.Wiring
			}
		}
	}
	t.Fatalf("dependency %q not found", depName)
	return nil
}

// THE bug this whole change exists for: a platform-resource dependency must carry
// its env-var names without anything having provisioned, resolved or dispatched.
// The expected values are written out literally rather than computed, because a
// test that re-derives them with the same helper would pass even if the naming
// convention silently changed under both.
func TestDeriveDependencyWiring_PlatformResourcePrefixesEveryOutput(t *testing.T) {
	t.Parallel()
	comps := []DesignComponent{{
		Name:         "todo-api",
		Dependencies: []Dependency{platformDep("todo-db", "postgres-cnpg")},
	}}

	deriveDependencyWiring(comps, postgresType(), "todo-webapp")

	w := wiringOf(t, comps, "todo-db")
	if w == nil {
		t.Fatal("no wiring stamped for a known platform-resource type")
	}
	if want := "todo-webapp-todo-db"; w.Ref != want {
		t.Errorf("ref = %q, want %q", w.Ref, want)
	}
	for output, wantEnv := range map[string]string{
		"host":     "TODO_DB_HOST",
		"port":     "TODO_DB_PORT",
		"dbname":   "TODO_DB_DBNAME",
		"user":     "TODO_DB_USER",
		"password": "TODO_DB_PASSWORD",
	} {
		if got := w.EnvBindings[output]; got != wantEnv {
			t.Errorf("envBindings[%q] = %q, want %q", output, got, wantEnv)
		}
	}
	if len(w.EnvBindings) != 5 {
		t.Errorf("envBindings has %d entries, want 5 (one per declared output)", len(w.EnvBindings))
	}
}

// An external resource's outputs are its OWN config keys, already namespaced by
// the schema the design declares — prefixing them would rename the very keys the
// architect authored and the build drawer collects.
func TestDeriveDependencyWiring_ExternalUsesConfigKeysVerbatim(t *testing.T) {
	t.Parallel()
	comps := []DesignComponent{{
		Name: "orders",
		Dependencies: []Dependency{{
			Kind: DependencyKindExternal, Name: "stripe",
			Config: []ConfigKey{{Key: "STRIPE_API_KEY", Secret: true}, {Key: "STRIPE_WEBHOOK_SECRET", Secret: true}},
		}},
	}}

	// No catalog at all: an external dependency's wiring never needs one.
	deriveDependencyWiring(comps, nil, "shop")

	w := wiringOf(t, comps, "stripe")
	if w == nil {
		t.Fatal("no wiring stamped for an external dependency with config keys")
	}
	if want := "shop-stripe"; w.Ref != want {
		t.Errorf("ref = %q, want %q", w.Ref, want)
	}
	for _, key := range []string{"STRIPE_API_KEY", "STRIPE_WEBHOOK_SECRET"} {
		if got := w.EnvBindings[key]; got != key {
			t.Errorf("envBindings[%q] = %q, want it verbatim", key, got)
		}
	}
}

// Absent means "not derivable yet", and it must stay absent rather than becoming
// a half-stamped entry: the coding agent reports a declared-but-unwired
// dependency as a platform fault, which is the loud failure the silent path
// lacked.
func TestDeriveDependencyWiring_UnderivableStampsNothing(t *testing.T) {
	t.Parallel()
	cases := map[string]struct {
		dep   Dependency
		types map[string]CRTType
	}{
		"resourceType absent from the catalog": {platformDep("cache", "redis-unknown"), postgresType()},
		"no catalog read at all":               {platformDep("todo-db", "postgres-cnpg"), nil},
		"type declares no outputs":             {platformDep("thing", "opaque"), map[string]CRTType{"opaque": {}}},
		"external with no config keys":         {Dependency{Kind: DependencyKindExternal, Name: "weather"}, nil},
		"sibling component":                    {Dependency{Kind: DependencyKindComponent, Name: "todo-api"}, postgresType()},
		"cross-project org service":            {Dependency{Kind: DependencyKindOrgService, Name: "billing"}, postgresType()},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			comps := []DesignComponent{{Name: "c", Dependencies: []Dependency{tc.dep}}}
			deriveDependencyWiring(comps, tc.types, "proj")
			if w := wiringOf(t, comps, tc.dep.Name); w != nil {
				t.Errorf("wiring = %+v, want nil", w)
			}
		})
	}
}

// The value is DERIVED, so every save recomputes it. A stale value left by a
// rename — or an invented one an agent echoed back — is replaced, which is what
// lets both write gates accept the field instead of rejecting the agent's own
// echo of what it read.
func TestDeriveDependencyWiring_OverwritesStaleAndInventedValues(t *testing.T) {
	t.Parallel()
	comps := []DesignComponent{{
		Name: "todo-api",
		Dependencies: []Dependency{{
			Kind: DependencyKindPlatformResource, Name: "todo-db", ResourceType: "postgres-cnpg",
			Wiring: &DependencyWiring{
				Ref:         "old-project-orders-db",
				EnvBindings: map[string]string{"host": "POSTGRES_HOST", "invented": "NOPE"},
			},
		}},
	}}

	deriveDependencyWiring(comps, postgresType(), "todo-webapp")

	w := wiringOf(t, comps, "todo-db")
	if w.Ref != "todo-webapp-todo-db" {
		t.Errorf("stale ref survived: %q", w.Ref)
	}
	if w.EnvBindings["host"] != "TODO_DB_HOST" {
		t.Errorf("invented env name survived: %q", w.EnvBindings["host"])
	}
	if _, ok := w.EnvBindings["invented"]; ok {
		t.Error("invented output survived the re-derivation")
	}
}

// A resource whose declared wiring becomes underivable must LOSE it, not keep a
// value that no longer matches reality — a workload.yaml binding env vars the
// binding never exposes is worse than one the agent refuses to write.
func TestDeriveDependencyWiring_RemovesWiringWhenNoLongerDerivable(t *testing.T) {
	t.Parallel()
	comps := []DesignComponent{{
		Name: "todo-api",
		Dependencies: []Dependency{{
			Kind: DependencyKindPlatformResource, Name: "todo-db", ResourceType: "postgres-cnpg",
			Wiring: &DependencyWiring{Ref: "p-todo-db", EnvBindings: map[string]string{"host": "TODO_DB_HOST"}},
		}},
	}}

	deriveDependencyWiring(comps, map[string]CRTType{}, "p") // type uninstalled

	if w := wiringOf(t, comps, "todo-db"); w != nil {
		t.Errorf("wiring = %+v, want nil once the type is gone", w)
	}
}

// The ref is the OC Resource name, and OC renders a CloudNativePG Cluster off it
// — so it is length-bounded. Design save must stamp the SAME bounded name
// provisioning authors, or the agent's workload.yaml would reference a resource
// that does not exist.
func TestDeriveDependencyWiring_RefIsBoundedForLongNames(t *testing.T) {
	t.Parallel()
	longProject := strings.Repeat("verylongproject", 3)
	comps := []DesignComponent{{
		Name:         "c",
		Dependencies: []Dependency{platformDep("primary-database", "postgres-cnpg")},
	}}

	deriveDependencyWiring(comps, postgresType(), longProject)

	ref := wiringOf(t, comps, "primary-database").Ref
	if len(ref) > 26 {
		t.Errorf("ref %q is %d chars, over the OC Resource bound", ref, len(ref))
	}
	if strings.Contains(ref, longProject) {
		t.Errorf("ref %q was not bounded", ref)
	}
}

// The load-bearing property: the ref design save stamps must be the name
// provisioning ACTUALLY authored, or the agent's workload.yaml points at nothing.
// The case pinned here is the real one from asdlc-repos/todo-webapp-api1121 —
// project `todo-webapp-api1121` + dependency `todo-db` overflows the 26-char OC
// Resource bound, and the live gate comment reported binding
// `todo-webapp-api11-82b8423f-development`. Design save must reach the same
// bounded stem, which is only true while both sides derive it through ocname.
func TestDeriveDependencyWiring_RefMatchesTheProvisionedBindingName(t *testing.T) {
	t.Parallel()
	comps := []DesignComponent{{
		Name:         "todo-api",
		Dependencies: []Dependency{platformDep("todo-db", "postgres-cnpg")},
	}}

	deriveDependencyWiring(comps, postgresType(), "todo-webapp-api1121")

	if want, got := "todo-webapp-api11-82b8423f", wiringOf(t, comps, "todo-db").Ref; got != want {
		t.Errorf("ref = %q, want %q (the stem of the binding the platform really created)", got, want)
	}
}

// Change detection is what keeps an unchanged design from committing on every
// save. It has to see through the pointer the derivation rebuilds each pass.
func TestDerivedStateEqual_IgnoresPointerIdentityButCatchesValueChanges(t *testing.T) {
	t.Parallel()
	comp := DesignComponent{
		Name:         "todo-api",
		Dependencies: []Dependency{platformDep("todo-db", "postgres-cnpg")},
	}
	comps := []DesignComponent{comp}
	deriveDependencyWiring(comps, postgresType(), "p")
	first := snapshotDerived(comps[0])

	// Re-deriving builds a brand-new struct with the same value.
	deriveDependencyWiring(comps, postgresType(), "p")
	if !derivedStateEqual(first, snapshotDerived(comps[0])) {
		t.Error("re-deriving the same value reported a change — every save would commit")
	}

	// A real change (the project renamed, so the ref moves) must be caught.
	deriveDependencyWiring(comps, postgresType(), "other-project")
	if derivedStateEqual(first, snapshotDerived(comps[0])) {
		t.Error("a changed ref went undetected — the stamp would never be committed")
	}
}

// snapshotDerived must copy by value: the derivation mutates in place, so a
// snapshot that aliased the live map would compare equal to itself forever.
func TestSnapshotDerived_IsNotAliasedByALaterDerivation(t *testing.T) {
	t.Parallel()
	comps := []DesignComponent{{
		Name:         "todo-api",
		Dependencies: []Dependency{platformDep("todo-db", "postgres-cnpg")},
	}}
	deriveDependencyWiring(comps, postgresType(), "p")
	before := snapshotDerived(comps[0])

	// Mutating the live wiring through the component must not touch the snapshot.
	comps[0].Dependencies[0].Wiring.EnvBindings["host"] = "MUTATED"

	if before.wiring["todo-db"].EnvBindings["host"] != "TODO_DB_HOST" {
		t.Error("snapshot aliased the live envBindings map")
	}
}
