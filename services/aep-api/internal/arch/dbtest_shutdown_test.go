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

package arch

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// dbtestPkg is the DB harness. Importing it from a test file is what makes a
// package start its own throwaway Postgres.
const dbtestPkg = mod + "/internal/platform/dbtest"

// TestDBTestPackagesShutDownTheirContainer asserts every package whose tests
// import the DB harness also delegates its TestMain to it.
//
// `go test ./...` runs each package in its own process, and dbtest starts one
// Postgres per process that must outlive every per-test clone — so the only
// place it can be torn down is after that package's last test, in TestMain. A
// package that imports dbtest.New without `func TestMain(m *testing.M) {
// dbtest.Main(m) }` therefore strands a container on the developer's Docker
// host for every run. The check is static, so it holds in the `-short` lane
// that never touches Docker, and the package list comes off disk: a new DB
// package is policed the moment its first test imports the harness.
func TestDBTestPackagesShutDownTheirContainer(t *testing.T) {
	usesHarness := map[string]bool{}
	shutsDown := map[string]bool{}

	err := filepath.WalkDir("../..", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if d.Name() == "testdata" || d.Name() == "node_modules" {
				return fs.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, "_test.go") {
			return nil
		}
		dir := filepath.Dir(path)
		for _, imp := range fileImports(t, path) {
			if imp == dbtestPkg {
				usesHarness[dir] = true
			}
		}
		if delegatesTestMainToDBTest(t, path) {
			shutsDown[dir] = true
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk module: %v", err)
	}

	// Discovery guard: if the walk ever stops finding the harness (a move, a
	// rename, a broken path), this test must fail loudly rather than pass by
	// policing nothing.
	if len(usesHarness) == 0 {
		t.Fatalf("no test file imports %s — discovery is broken, not the code", dbtestPkg)
	}

	var offenders []string
	for dir := range usesHarness {
		if !shutsDown[dir] {
			offenders = append(offenders, dir)
		}
	}
	sort.Strings(offenders)
	for _, dir := range offenders {
		t.Errorf("%s imports the dbtest harness but declares no TestMain delegating to it — its throwaway Postgres survives every run; add\n\n\tfunc TestMain(m *testing.M) { dbtest.Main(m) }\n\nto one of its _test.go files (see internal/platform/dbtest's package doc)", dir)
	}
}

// delegatesTestMainToDBTest reports whether the file declares
// `func TestMain(m *testing.M)` whose body calls dbtest.Main. Parsing (rather
// than grepping) means a mention in a comment or a string cannot satisfy the
// rule.
func delegatesTestMainToDBTest(t *testing.T, path string) bool {
	t.Helper()
	f, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
	if err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	for _, decl := range f.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Recv != nil || fn.Name.Name != "TestMain" || fn.Body == nil {
			continue
		}
		found := false
		ast.Inspect(fn.Body, func(n ast.Node) bool {
			sel, ok := n.(*ast.SelectorExpr)
			if !ok || sel.Sel.Name != "Main" {
				return true
			}
			if pkg, ok := sel.X.(*ast.Ident); ok && pkg.Name == "dbtest" {
				found = true
				return false
			}
			return true
		})
		if found {
			return true
		}
	}
	return false
}
