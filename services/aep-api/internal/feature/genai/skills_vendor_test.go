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

package genai

import (
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

// TestVendoredSkillsMatchRepoRoot is the anti-drift guard for the go:embed'd
// core flow skills. They are the single source of truth at the repo-root
// skills/ directory (docs/design/agents-generation-migration.md §2), but
// go:embed cannot cross the aep-api Go module boundary, so they are vendored
// under assets/skills/ and kept in sync via the go:generate line in skills.go.
//
// The evals + playground read the repo-root copy; this vendored copy is what the
// BFF actually pushes — so a silent divergence would ship untested guidance. This
// test fails the moment the two trees differ; re-sync with:
//
//	go generate ./internal/feature/genai
func TestVendoredSkillsMatchRepoRoot(t *testing.T) {
	const vendored = "assets/skills"
	// genai → feature → internal → aep-api → services → repo root.
	const repoRoot = "../../../../../skills"

	want := collectSkillFiles(t, repoRoot)
	got := collectSkillFiles(t, vendored)

	if len(want) == 0 {
		t.Fatalf("no files under repo-root skills/ (%s) — layout drift?", repoRoot)
	}

	for rel, wantBytes := range want {
		gotBytes, ok := got[rel]
		if !ok {
			t.Errorf("vendored skills missing %q (run: go generate ./internal/feature/genai)", rel)
			continue
		}
		if string(gotBytes) != string(wantBytes) {
			t.Errorf("vendored skills/%s differs from repo-root skills/%s — re-sync (go generate ./internal/feature/genai)", rel, rel)
		}
	}
	for rel := range got {
		if _, ok := want[rel]; !ok {
			t.Errorf("vendored skills has stale %q not present in repo-root — re-sync (go generate ./internal/feature/genai)", rel)
		}
	}
}

// collectSkillFiles walks root and returns every file keyed by its slash-form
// path relative to root, with its bytes.
func collectSkillFiles(t *testing.T, root string) map[string][]byte {
	t.Helper()
	out := map[string][]byte{}
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, rerr := filepath.Rel(root, path)
		if rerr != nil {
			return rerr
		}
		b, rerr := os.ReadFile(path)
		if rerr != nil {
			return rerr
		}
		out[filepath.ToSlash(rel)] = b
		return nil
	})
	if err != nil {
		t.Fatalf("walk %s: %v", root, err)
	}
	return out
}
