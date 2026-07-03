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

package artifacts

// diffWorkingTreeAgainstHEAD is the changeset engine feeding the save flow.
// These run it against a real clone with a real HEAD.

import (
	"context"
	"testing"
)

// statusOf collapses the changeRow slice into a name→status map. Order from
// `git status` is not contractual, so tests assert on the map, not the slice.
func statusOf(rows []changeRow) map[string]string {
	m := make(map[string]string, len(rows))
	for _, row := range rows {
		m[row.Name] = row.Status
	}
	return m
}

func TestDiffWorkingTreeAgainstHEAD_AMD(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{
		"specs/requirements/requirements.md": "orig\n",
		"specs/requirements/mod.md":          "orig\n",
		"specs/requirements/del.md":          "delete me\n",
	})
	r.writeWT("specs/requirements/mod.md", "changed\n")
	r.rmWT("specs/requirements/del.md")
	r.writeWT("specs/requirements/add.md", "added\n")

	rows, err := diffWorkingTreeAgainstHEAD(context.Background(), r.clonePath, RequirementsDir)
	if err != nil {
		t.Fatalf("diff: %v", err)
	}
	got := statusOf(rows)
	want := map[string]string{"mod.md": "M", "del.md": "D", "add.md": "A"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for name, status := range want {
		if got[name] != status {
			t.Errorf("status[%q] = %q, want %q (full: %v)", name, got[name], status, got)
		}
	}
	if _, ok := got["requirements.md"]; ok {
		t.Error("unchanged requirements.md must not appear in the changeset")
	}
}

func TestDiffWorkingTreeAgainstHEAD_RenameExpandsToDeletePlusAdd(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{
		"specs/requirements/requirements.md": "keep\n",
		"specs/requirements/old.md":          "some reasonably sized body so the rename is an exact-content move\n",
	})
	// `git mv` stages an exact-content rename -> git status reports it as R,
	// which diffWorkingTreeAgainstHEAD must expand into D(old) + A(new).
	r.git("mv", "specs/requirements/old.md", "specs/requirements/renamed.md")

	rows, err := diffWorkingTreeAgainstHEAD(context.Background(), r.clonePath, RequirementsDir)
	if err != nil {
		t.Fatalf("diff: %v", err)
	}
	got := statusOf(rows)
	if got["old.md"] != "D" {
		t.Errorf("old.md status = %q, want D (full: %v)", got["old.md"], got)
	}
	if got["renamed.md"] != "A" {
		t.Errorf("renamed.md status = %q, want A (full: %v)", got["renamed.md"], got)
	}
}

func TestDiffWorkingTreeAgainstHEAD_NestedDesignPathPreserved(t *testing.T) {
	t.Parallel()
	// Regression pin for the filepath.Base bug the code comment warns about: a
	// nested design file must keep its subdir path relative to specs/design/,
	// NOT collapse onto its basename ("design.md"). Swapping the subdir-prefix
	// strip for filepath.Base breaks the multi-file design layout and this test.
	r := newRig(t, map[string]string{
		"specs/design/design.md":                "root\n",
		"specs/design/components/foo/design.md": "foo\n",
	})
	r.writeWT("specs/design/components/foo/design.md", "foo changed\n")

	rows, err := diffWorkingTreeAgainstHEAD(context.Background(), r.clonePath, DesignDir)
	if err != nil {
		t.Fatalf("diff: %v", err)
	}
	got := statusOf(rows)
	if got["components/foo/design.md"] != "M" {
		t.Errorf("want M at nested key %q, got %v", "components/foo/design.md", got)
	}
	if _, collapsed := got["design.md"]; collapsed {
		t.Error("nested path was collapsed onto its basename design.md (filepath.Base regression)")
	}
}
