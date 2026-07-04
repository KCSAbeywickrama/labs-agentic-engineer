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
// (os.ReadDir), so a new package is policed the moment it exists. Runs under
// plain `go test` — no extra tooling.
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
	"artifacts":     {"gitrepo"},
	"codingagent":   {"artifacts", "component", "gitrepo", "orgcreds"},
	"component":     {"artifacts", "gitrepo"},
	"design":        {"artifacts"},
	"files":         {"gitrepo"},
	"genai":         {"gitrepo"},
	"gitrepo":       {},
	"idp":           {"orgcreds"},
	"organization":  {},
	"orgcreds":      {"gitrepo"},
	"project":       {"artifacts", "gitrepo"},
	"requirements":  {"artifacts"},
	"runtimeconfig": {"artifacts"},
	"skills":        {"artifacts", "gitrepo"},
	"task":          {"artifacts", "gitrepo"},
	"webhook":       {"gitrepo", "orgcreds"},
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

// TestNoFlatServicesOrControllers asserts there are no flat layers: no
// feature, platform leaf, or wiring package imports the deleted services/ or
// controllers/ packages.
func TestNoFlatServicesOrControllers(t *testing.T) {
	for _, f := range listDir(t, "../feature") {
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
// the list).
func TestFeatureEdgeAllowlist(t *testing.T) {
	features := listDir(t, "../feature")

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
		var actual []string
		for _, imp := range directImports(t, featPrefix+f) {
			if strings.HasPrefix(imp, featPrefix) {
				actual = append(actual, strings.TrimPrefix(imp, featPrefix))
			}
		}
		for _, edge := range actual {
			if !allowed[edge] {
				t.Errorf("NEW feature edge %s → %s is not on the allowlist — prefer a consumer-side port; if the concrete edge is a deliberate design decision, add it to featureEdgeAllowlist with rationale in the PR", f, edge)
			}
			delete(allowed, edge)
		}
		for stale := range allowed {
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
