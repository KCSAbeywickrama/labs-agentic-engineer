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

// Package arch holds the architecture-boundary invariant tests — the CI lock
// that keeps the vertical-slice layout from regressing. The invariants:
//
//   - no flat services/ or controllers/ layer exists or is imported;
//   - the feature→feature import graph matches an explicit ALLOWLIST (Go's
//     compiler already forbids cycles, so the value here is catching NEW
//     coupling: an edge not on the list fails, and a stale allowlist entry
//     also fails so the list can't rot);
//   - every internal/platform/* package and internal/contracts is
//     feature-free (componenttest is the one deliberate exception — it
//     assembles the real app);
//   - contracts imports nothing module-internal at all (models re-exports
//     FROM contracts, never the reverse);
//   - all Go code lives under internal/ except cmd/, skills/ (go:embed
//     anchors), and the deliberately-flat models/ + repositories/ kernel.
//
// The feature and platform package lists are discovered from disk
// (os.ReadDir), so a new package is policed the moment it exists. Feature
// discovery recurses one level into a top-level feature dir when it hosts a
// NESTED umbrella (e.g. dependencies/{endpoints,resources}, mirroring
// OpenChoreo's Workload.spec.dependencies split): each child that is itself a
// buildable Go package becomes its own "<parent>/<child>" feature key,
// policed exactly like a flat feature — including its own allowlist row.
// Runs under plain `go test` — no extra tooling.
package arch

import (
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
)

const mod = "github.com/wso2/aep/aep-api"

// featureEdgeAllowlist is the complete set of permitted DIRECT
// feature→feature imports. Adding a cross-feature import is a design
// decision: extend this list in the same PR and say why, or (usually better)
// cut the edge with a consumer-side port per the house pattern.
var featureEdgeAllowlist = map[string][]string{
	"artifacts": {"gitrepo"},
	// codingagent's dispatch path imports dependencies/endpoints +
	// dependencies/resources ONLY for their pure naming helpers
	// (endpoints.OrgServiceURLEnv, resources.ExternalResourceName/BindingName) —
	// the single source of truth for the dispatch-time consumer-wiring env-var +
	// ref derivation, so the issue-comment renderer and the provisioners can't
	// diverge. No state or types beyond those funcs cross the edge; every
	// collaborator (org-service resolver, binding reader, external-resource secret
	// resolver, access granter) is a consumer-side port wired at the composition
	// root. resources.ExternalResourceRunnerSecret rides the same edge as the
	// resolver port's return type.
	"codingagent": {"artifacts", "component", "dependencies/endpoints", "dependencies/resources", "gitrepo", "orgcreds"},
	"component":   {"artifacts", "gitrepo"},
	// dependencies is the nested umbrella for a design component's external
	// dependency graph (OpenChoreo Workload.spec.dependencies.{endpoints[],
	// resources[]}); the parent may import its own children ONLY — anything
	// wider is a design decision for a later task, added here with rationale.
	"dependencies":           {"dependencies/endpoints", "dependencies/resources"},
	// dependencies/endpoints owns the single cross-project access-request state
	// machine. It calls gitrepo's pure issue-body builders
	// (BuildOrgPublishIssueBody / BuildIssueBody) rather than duplicating them,
	// so it imports gitrepo — the one permitted feature edge. Every other
	// collaborator (access store, catalog, design reader, task creator,
	// org-published marker) is a consumer-side port wired at the composition root.
	"dependencies/endpoints": {"gitrepo"},
	"dependencies/resources": {},
	"design":                 {"artifacts"},
	"gitrepo":                {},
	"idp":                    {"orgcreds"},
	"organization":           {},
	"orgcreds":               {"gitrepo"},
	"project":                {"artifacts", "gitrepo"},
	"requirements":           {"artifacts"},
	"runtimeconfig":          {"artifacts"},
	"skills":                 {"artifacts", "gitrepo"},
	"task":                   {"artifacts", "gitrepo"},
	"webhook":                {"gitrepo", "orgcreds"},
}

// depCache memoizes each package's transitive import set so the boundary
// tests shell out to `go list -deps` once per distinct package.
var (
	depCacheMu sync.Mutex
	depCache   = map[string]map[string]bool{}
)

// deps returns the transitive import set of pkg via `go list -deps`,
// memoized across all callers/tests.
func deps(t *testing.T, pkg string) map[string]bool {
	t.Helper()
	depCacheMu.Lock()
	defer depCacheMu.Unlock()
	if set, ok := depCache[pkg]; ok {
		return set
	}
	out, err := exec.Command("go", "list", "-deps", pkg).CombinedOutput()
	if err != nil {
		t.Fatalf("go list -deps %s failed: %v\n%s", pkg, err, out)
	}
	set := map[string]bool{}
	for _, d := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		set[d] = true
	}
	depCache[pkg] = set
	return set
}

// directImports returns pkg's DIRECT imports (not transitive) — the right
// granularity for the edge allowlist.
func directImports(t *testing.T, pkg string) []string {
	t.Helper()
	out, err := exec.Command("go", "list", "-f", `{{join .Imports "\n"}}`, pkg).CombinedOutput()
	if err != nil {
		t.Fatalf("go list -f imports %s failed: %v\n%s", pkg, err, out)
	}
	return strings.Split(strings.TrimSpace(string(out)), "\n")
}

func imports(t *testing.T, pkg, dep string) bool {
	return deps(t, pkg)[dep]
}

// listDir returns the package directory names under the given path relative
// to this test file — the on-disk discovery that keeps every check current
// without a hardcoded slice.
func listDir(t *testing.T, rel string) []string {
	t.Helper()
	entries, err := os.ReadDir(rel)
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	return names
}

// hasGoFiles reports whether dir (relative to this test file) contains at
// least one top-level .go file, i.e. whether it is itself a buildable Go
// package rather than a pure directory-only grouping. `go list` FATALs on a
// directory with no .go files, so callers must check this before treating a
// dir as a feature.
func hasGoFiles(t *testing.T, dir string) bool {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read %s: %v", dir, err)
	}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".go") {
			return true
		}
	}
	return false
}

// listFeatures discovers every feature KEY under internal/feature: each
// top-level dir, plus one level of recursion into a NESTED umbrella. A child
// dir only becomes its own "<parent>/<child>" key when it is itself a
// buildable Go package (dependencies/{endpoints,resources}); a child named
// EXACTLY "<top>test" (e.g. artifacts/artifactstest) is a hand-fake package,
// not a feature, and is skipped — the same exception
// TestPlatformAndContractsAreFeatureFree carves out for componenttest. The
// match is exact rather than a "*test" suffix so a future real feature named,
// say, "latest" isn't mistaken for one of these hand-fakes. This keeps
// recursion from sweeping up ordinary test-support packages as if they were
// siblings of the feature that owns them.
func listFeatures(t *testing.T) []string {
	t.Helper()
	var keys []string
	for _, top := range listDir(t, "../feature") {
		keys = append(keys, top)
		topDir := filepath.Join("..", "feature", top)
		for _, sub := range listDir(t, topDir) {
			if sub == top+"test" {
				continue
			}
			if !hasGoFiles(t, filepath.Join(topDir, sub)) {
				continue
			}
			keys = append(keys, top+"/"+sub)
		}
	}
	sort.Strings(keys)
	return keys
}

// featureKeyForImport maps a path relative to internal/feature/ (e.g.
// "dependencies/resources" or, for a deeper import inside a nested feature,
// "dependencies/resources/foo") to the feature KEY that owns it. It matches
// the LONGEST known feature key that is a prefix of rel, so an import of
// internal/feature/dependencies/resources registers as an edge to
// "dependencies/resources", never the shorter "dependencies".
func featureKeyForImport(features []string, rel string) (string, bool) {
	best := ""
	for _, f := range features {
		if rel == f || strings.HasPrefix(rel, f+"/") {
			if len(f) > len(best) {
				best = f
			}
		}
	}
	return best, best != ""
}

// TestNoFlatServicesOrControllers asserts there are no flat layers: no
// feature, platform leaf, or wiring package imports the deleted services/ or
// controllers/ packages.
func TestNoFlatServicesOrControllers(t *testing.T) {
	for _, f := range listFeatures(t) {
		pkg := mod + "/internal/feature/" + f
		if imports(t, pkg, mod+"/services") {
			t.Errorf("%s imports the flat services package (should be gone)", f)
		}
		if imports(t, pkg, mod+"/controllers") {
			t.Errorf("%s imports the controllers package (forbidden — features own their controllers or use ports)", f)
		}
	}
	for _, p := range []string{"/internal/app", "/cmd/aep-api", "/internal/api"} {
		pkg := mod + p
		if imports(t, pkg, mod+"/controllers") {
			t.Errorf("%s imports the controllers package — it is deleted; wire features directly", p)
		}
		if imports(t, pkg, mod+"/services") {
			t.Errorf("%s imports the flat services package — it is deleted", p)
		}
	}
}

// TestFlatPackagesDeleted asserts the flat services/ and controllers/
// packages no longer exist on disk — the strongest form of the boundary (a
// re-created flat layer fails here even before anything imports it).
func TestFlatPackagesDeleted(t *testing.T) {
	for _, p := range []string{"/services", "/controllers"} {
		if err := exec.Command("go", "list", mod+p).Run(); err == nil {
			t.Errorf("package %s%s still resolves — the flat layer must stay deleted", mod, p)
		}
	}
}

// TestFeatureEdgeAllowlist asserts the feature→feature DIRECT import graph is
// exactly featureEdgeAllowlist — new coupling fails loudly, and a stale
// allowlist entry fails too so the list stays honest. This subsumes the old
// 4-edge denylist (task↔codingagent, design→task/component are simply not on
// the list). One exception to "stale": a nested umbrella's parent→own-child
// row (dependencies → dependencies/endpoints|resources) is a scope boundary,
// not a claim of current usage, so it doesn't need a real import yet to stay
// off the stale list — see the loop below.
func TestFeatureEdgeAllowlist(t *testing.T) {
	features := listFeatures(t)
	featureSet := map[string]bool{}
	for _, f := range features {
		featureSet[f] = true
	}

	// Every on-disk feature must have an allowlist row (even an empty one) —
	// a brand-new feature gets policed the moment it exists.
	for _, f := range features {
		if _, ok := featureEdgeAllowlist[f]; !ok {
			t.Errorf("feature %q has no allowlist row — add one (empty is fine) and review its edges", f)
		}
	}
	for f := range featureEdgeAllowlist {
		found := false
		for _, name := range features {
			if name == f {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("allowlist names feature %q which no longer exists on disk — remove the row", f)
		}
	}

	const featPrefix = mod + "/internal/feature/"
	for _, f := range features {
		allowed := map[string]bool{}
		for _, e := range featureEdgeAllowlist[f] {
			allowed[e] = true
		}
		// De-dupe through a set: a nested feature (e.g. dependencies) can
		// have several direct imports that all resolve to the same child
		// edge, and counting the same edge twice would falsely re-trigger
		// the "not on the allowlist" check on its second occurrence.
		actual := map[string]bool{}
		for _, imp := range directImports(t, featPrefix+f) {
			if !strings.HasPrefix(imp, featPrefix) {
				continue
			}
			rel := strings.TrimPrefix(imp, featPrefix)
			edge, ok := featureKeyForImport(features, rel)
			if !ok {
				t.Errorf("%s imports %s, which is under internal/feature/ but matches no known feature key — is a new feature missing from listFeatures or the allowlist?", f, imp)
				continue
			}
			actual[edge] = true
		}
		for edge := range actual {
			if !allowed[edge] {
				t.Errorf("NEW feature edge %s → %s is not on the allowlist — prefer a consumer-side port; if the concrete edge is a deliberate design decision, add it to featureEdgeAllowlist with rationale in the PR", f, edge)
			}
			delete(allowed, edge)
		}
		for stale := range allowed {
			// A parent→own-child row inside a nested umbrella (e.g.
			// dependencies → dependencies/endpoints) is a standing scope
			// boundary — "the parent MAY reach into its children" — not a
			// claim that it currently does, so it's exempt from staleness
			// even with no import yet (declare-before-use). But the exemption
			// only holds while that child still exists on disk: if the child
			// feature is deleted, the row is real rot (a stale reference to a
			// feature that no longer exists) and must still be caught, so we
			// additionally require the child to be a member of featureSet.
			if strings.HasPrefix(stale, f+"/") && featureSet[stale] {
				continue
			}
			t.Errorf("allowlist edge %s → %s no longer exists — remove it so the list stays honest", f, stale)
		}
	}
}

// TestPlatformAndContractsAreFeatureFree asserts every internal/platform/*
// package and internal/contracts imports no feature (and none of the flat
// layers). componenttest is the one deliberate exception: it assembles the
// REAL app graph for the component tier, so it imports everything by design.
func TestPlatformAndContractsAreFeatureFree(t *testing.T) {
	pkgs := []string{mod + "/internal/contracts"}
	for _, p := range listDir(t, "../platform") {
		if p == "componenttest" {
			continue // assembles the real app — feature imports are its job
		}
		pkgs = append(pkgs, mod+"/internal/platform/"+p)
	}
	for _, pkg := range pkgs {
		for d := range deps(t, pkg) {
			if strings.Contains(d, "/internal/feature/") {
				t.Errorf("%s imports a feature (%s) — must stay feature-free", pkg, d)
			}
			if d == mod+"/services" || d == mod+"/controllers" {
				t.Errorf("%s imports %s — must stay feature-free", pkg, d)
			}
		}
	}
}

// TestContractsIsLeaf asserts internal/contracts depends on NOTHING inside
// the module: it is the cycle-breaking leaf, and the dependency direction is
// models → contracts (models re-exports contracts types), never the reverse.
func TestContractsIsLeaf(t *testing.T) {
	for d := range deps(t, mod+"/internal/contracts") {
		if !strings.HasPrefix(d, mod) {
			continue // stdlib / third-party
		}
		if d != mod+"/internal/contracts" {
			t.Errorf("contracts imports %s — contracts must import nothing module-internal", d)
		}
	}
}

// TestInternalOnlyLayout asserts no Go source lives outside the sanctioned
// top-level roots: internal/ (everything), cmd/ (mains), skills/ (go:embed
// must anchor to the source file), and the deliberately-flat models/ +
// repositories/ shared kernel (their relocation is an explicitly gated,
// separate decision — see aep-api-target-structure.md "What moves").
func TestInternalOnlyLayout(t *testing.T) {
	allowedRoots := map[string]bool{
		"internal": true, "cmd": true, "skills": true,
		"models": true, "repositories": true,
	}
	root := ".." + string(filepath.Separator) + ".." // module root from internal/arch
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, rerr := filepath.Rel(root, path)
		if rerr != nil {
			return rerr
		}
		if d.IsDir() {
			// Skip VCS/tooling dirs and testdata wholesale.
			if d.Name() == "testdata" || strings.HasPrefix(d.Name(), ".") && rel != "." {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(d.Name(), ".go") {
			return nil
		}
		top := strings.SplitN(filepath.ToSlash(rel), "/", 2)[0]
		if !allowedRoots[top] {
			t.Errorf("Go file outside the sanctioned roots: %s (allowed: internal/, cmd/, skills/, models/, repositories/)", rel)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk module root: %v", err)
	}
}
