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

package skills

import (
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"testing"

	embedskills "github.com/wso2/aep/aep-api/skills"
)

// TestFlowSkillsMirror_MatchesRepoRootSource is the anti-drift guard for the
// vendored flow skills. The single source of truth is the repo-root skills/
// directory; services/aep-api/skills/flow/ is a go:embed-able copy (go:embed
// cannot cross the module boundary — skills/embed.go). It follows the same
// pattern as designspec's TestVendoredSchemaMatchesContracts.
//
// The guard is bidirectional PER MIRRORED SKILL: for every skill directory the
// flow embed ships, every file must exist byte-identical in the repo-root
// source, AND every file the source carries for that skill must be present in
// the mirror. Editing either copy without re-syncing fails here — exactly the
// drift that dropped high-level-architecture's metadata block in 2e25858
// (the mirror was hand-edited instead of re-vendored).
//
// The TOP-LEVEL directory sets may deliberately differ: repo-root skills/
// also carries task-breakdown, which is delivered to the task-planner agent
// via a separate channel (skills/planner/), not the flow embed — so it must
// NOT appear in flow/ (it would be seeded into every org's repo). Each
// mirrored dir must still exist at the root.
//
// Re-sync direction: edit repo-root skills/, then re-vendor. Note the
// embed.go go:generate line copies ALL of skills/ (including task-breakdown);
// after running it, drop flow/task-breakdown — or better, fix the directive.
func TestFlowSkillsMirror_MatchesRepoRootSource(t *testing.T) {
	t.Parallel()
	// skills(pkg) → feature → internal → aep-api → services → repo root.
	const sourceRoot = "../../../../../skills"

	dirs, err := fs.ReadDir(embedskills.FlowFS, "flow")
	if err != nil {
		t.Fatalf("read embedded flow dir: %v", err)
	}
	if len(dirs) == 0 {
		t.Fatal("embedded flow dir is empty — embed glob broken")
	}
	for _, d := range dirs {
		if !d.IsDir() {
			continue
		}
		name := d.Name()
		srcDir := filepath.Join(sourceRoot, name)
		if st, err := os.Stat(srcDir); err != nil || !st.IsDir() {
			t.Errorf("flow mirror ships %q but repo-root skills/%s does not exist — "+
				"the mirror must be a subset of the source of truth", name, name)
			continue
		}

		// Mirror → source: every embedded file must match the source byte-for-byte.
		mirrorFiles := map[string]bool{}
		err := fs.WalkDir(embedskills.FlowFS, path.Join("flow", name), func(p string, e fs.DirEntry, err error) error {
			if err != nil || e.IsDir() {
				return err
			}
			rel, _ := filepath.Rel(path.Join("flow", name), p)
			mirrorFiles[filepath.ToSlash(rel)] = true
			got, err := fs.ReadFile(embedskills.FlowFS, p)
			if err != nil {
				return err
			}
			want, err := os.ReadFile(filepath.Join(srcDir, rel))
			if err != nil {
				t.Errorf("flow/%s/%s exists in the mirror but not in repo-root skills/ — "+
					"re-vendor from the source of truth (services/aep-api/skills/embed.go)", name, rel)
				return nil
			}
			if string(got) != string(want) {
				t.Errorf("flow/%s/%s differs from repo-root skills/%s/%s — edit the repo-root "+
					"copy (the source of truth) and re-vendor; never hand-edit the mirror", name, rel, name, rel)
			}
			return nil
		})
		if err != nil {
			t.Fatalf("walk embedded flow/%s: %v", name, err)
		}

		// Source → mirror: a file added at the root must be re-vendored.
		err = filepath.WalkDir(srcDir, func(p string, e fs.DirEntry, err error) error {
			if err != nil || e.IsDir() {
				return err
			}
			rel, _ := filepath.Rel(srcDir, p)
			if !mirrorFiles[filepath.ToSlash(rel)] {
				t.Errorf("repo-root skills/%s/%s is missing from the flow mirror — re-vendor "+
					"(services/aep-api/skills/embed.go) so the platform ships it", name, rel)
			}
			return nil
		})
		if err != nil {
			t.Fatalf("walk source skills/%s: %v", name, err)
		}
	}
}
