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

// End-to-end coverage of CommitDesignFile over the REAL clients/github host
// client against a Git-Data-API fake (see save_flow_harness_test.go's rig) —
// asserting the untagged-commit contract that the fake-backed
// set_org_published_test.go can't: that this lands a real commit on main
// without creating a version tag, preserves sibling files via base_tree, and
// no-ops when the content already matches main.

import (
	"context"
	"strings"
	"testing"
)

func TestCommitDesignFile_CommitsWithoutTag(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{
		"specs/design/design.md":                  "design\n",
		"specs/design/components/foo/design.json": `{"name":"foo","type":"service"}` + "\n",
		"unrelated.md":                            "untouched\n",
	})
	ctx := context.Background()

	updated := `{"name":"foo","type":"service","exposesAPI":{"orgPublished":true}}` + "\n"
	sha, err := r.svc.CommitDesignFile(ctx, r.org, r.proj, "components/foo/design.json", updated,
		"chore(dependencies): mark foo org-published (namespace visibility)")
	if err != nil {
		t.Fatalf("CommitDesignFile: %v", err)
	}
	if sha == "" {
		t.Fatal("want a non-empty commit sha")
	}

	// The commit landed on the bare repo's main.
	if got := r.remote.FileAt(t, "main", "specs/design/components/foo/design.json"); !strings.Contains(got, "orgPublished") {
		t.Errorf("main content = %q, want it to contain orgPublished", got)
	}
	// base_tree semantics: sibling files we never touched are carried forward.
	if got := r.remote.FileAt(t, "main", "specs/design/design.md"); got != "design\n" {
		t.Errorf("design.md = %q, want untouched", got)
	}
	if got := r.remote.FileAt(t, "main", "unrelated.md"); got != "untouched\n" {
		t.Errorf("unrelated.md = %q, want untouched", got)
	}
	// No version tag was created — CommitDesignFile is explicitly untagged.
	if tags := r.remote.Tags(t); len(tags) != 0 {
		t.Errorf("want no tags created by CommitDesignFile, got %v", tags)
	}
	if head := r.remote.HeadSHA(t); head != sha {
		t.Errorf("remote HEAD = %s, want %s", head, sha)
	}

	// A second call with byte-identical content is a no-op: the resulting tree
	// equals main's current tree, so no commit is made.
	sha2, err := r.svc.CommitDesignFile(ctx, r.org, r.proj, "components/foo/design.json", updated, "no-op")
	if err != nil {
		t.Fatalf("second CommitDesignFile: %v", err)
	}
	if sha2 != "" {
		t.Fatalf("want empty sha for a no-op commit, got %q", sha2)
	}
	if head := r.remote.HeadSHA(t); head != sha {
		t.Errorf("remote HEAD moved on a no-op commit: %s, want unchanged %s", head, sha)
	}
}
