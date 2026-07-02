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

package api

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestNoClientSuppliedOrg is the IDOR arch-lock for the code-first surface.
// The active org is derived SOLELY from the verified JWT — humakit.OrgScopedInput
// .Resolve binds it onto OrgHandle from the token claims, and there is no
// {orgHandle} path parameter. A request must never be able to name an org it
// does not own. This scan asserts that no operation input — in any feature
// *_huma.go OR the shared marker itself — binds an org-named field from the
// request (path/query/header). Re-adding such a binding would reintroduce the
// IDOR class the path-param removal closed
// (docs/design/active-org-implementation-plan.md, Change 2).
//
// "Every org-scoped op embeds the marker" is not statically asserted here; it
// is enforced by fail-closed semantics (a handler that forgets the marker reads
// an empty OrgHandle and its org-scoped store queries return nothing) plus the
// component-tier cross-org wiring test.
func TestNoClientSuppliedOrg(t *testing.T) {
	// Struct-tag bindings that would let a request supply the org.
	banned := []string{
		`path:"orgHandle"`, `query:"orgHandle"`, `header:"orgHandle"`,
		`path:"org"`, `query:"org"`,
		`path:"orgId"`, `query:"orgId"`,
		`path:"organization"`, `query:"organization"`,
	}
	// The public-edge gate (humakit) + the internal-S2S gate (platform/auth) must
	// both derive the tenant from the verified credential, never a request field.
	files := []string{
		filepath.Join("..", "internal", "platform", "humakit", "humakit.go"),
		filepath.Join("..", "internal", "platform", "auth", "runner.go"),
	}
	root := filepath.Join("..", "internal", "feature")
	if err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() && strings.HasSuffix(path, "_huma.go") {
			files = append(files, path)
		}
		return nil
	}); err != nil {
		t.Fatalf("walk feature packages: %v", err)
	}

	var offenders []string
	for _, path := range files {
		b, readErr := os.ReadFile(path)
		if readErr != nil {
			t.Fatalf("read %s: %v", path, readErr)
		}
		for _, tag := range banned {
			if strings.Contains(string(b), tag) {
				offenders = append(offenders, path+" -> "+tag)
			}
		}
	}
	if len(offenders) > 0 {
		t.Fatalf("client-supplied org binding(s) found — the active org must come only from the "+
			"verified token (embed humakit.OrgScopedInput; never declare a request-bound org field): %v", offenders)
	}
}
