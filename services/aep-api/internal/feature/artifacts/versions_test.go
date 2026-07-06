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

// Version listing + read-at-tag, driven off REAL git tags on the bare remote.

import (
	"context"
	"errors"
	"testing"
)

func TestListVersions_OffRealTags_ExternalVisibilityViaFetch(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "r\n"})

	// Tags are created on the remote AFTER the clone; fetchAndListAllTags must
	// pull them via `fetch --tags` over the file:// origin.
	r.remote.Tag(t, "v1", "req v1")
	r.remote.Tag(t, "v2", "req v2")
	r.remote.Tag(t, "v1-1", "design v1-1")
	r.remote.Tag(t, "v2-3", "design v2-3")
	r.remote.Tag(t, "release-9", "not a version tag") // ignored by both parsers

	ctx := context.Background()

	reqs, err := r.svc.ListRequirementsVersions(ctx, r.org, r.proj)
	if err != nil {
		t.Fatalf("ListRequirementsVersions: %v", err)
	}
	if len(reqs) != 2 || reqs[0].Tag != "v2" || reqs[1].Tag != "v1" {
		t.Fatalf("requirements versions = %+v, want [v2, v1] descending", reqs)
	}

	designs, err := r.svc.ListDesignVersions(ctx, r.org, r.proj)
	if err != nil {
		t.Fatalf("ListDesignVersions: %v", err)
	}
	if len(designs) != 2 || designs[0].Tag != "v2-3" || designs[1].Tag != "v1-1" {
		t.Fatalf("design versions = %+v, want [v2-3, v1-1] descending", designs)
	}
}

func TestGetRequirementsAtTag_ReadsTagNotWorkingTree(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "tagged content\n"})
	r.remote.Tag(t, "v1", "v1")
	r.fetchTags() // read-at-tag does not fetch; bring v1 local first

	// Diverge the working tree — the read must still return the TAG's content.
	r.writeWT("specs/requirements/requirements.md", "uncommitted working-tree edit\n")

	got, err := r.svc.GetRequirementsAtTag(context.Background(), r.org, r.proj, "v1")
	if err != nil {
		t.Fatalf("GetRequirementsAtTag: %v", err)
	}
	if got["requirements.md"] != "tagged content\n" {
		t.Errorf("content = %q, want the tagged content (not the working tree)", got["requirements.md"])
	}
}

func TestGetRequirementsAtTag_Errors(t *testing.T) {
	t.Parallel()

	t.Run("malformed tag rejected", func(t *testing.T) {
		t.Parallel()
		r := newRig(t, map[string]string{"specs/requirements/requirements.md": "r\n"})
		_, err := r.svc.GetRequirementsAtTag(context.Background(), r.org, r.proj, "not-a-tag")
		if !errors.Is(err, ErrInvalidVersionTag) {
			t.Fatalf("err = %v, want ErrInvalidVersionTag", err)
		}
	})

	t.Run("well-formed but absent tag -> not found", func(t *testing.T) {
		t.Parallel()
		r := newRig(t, map[string]string{"specs/requirements/requirements.md": "r\n"})
		_, err := r.svc.GetRequirementsAtTag(context.Background(), r.org, r.proj, "v9")
		if !errors.Is(err, ErrArtifactNotFound) {
			t.Fatalf("err = %v, want ErrArtifactNotFound", err)
		}
	})

	t.Run("dir absent at tag -> not found", func(t *testing.T) {
		t.Parallel()
		// Tagged commit has no specs/requirements/ at all.
		r := newRig(t, map[string]string{"README.md": "root"})
		r.remote.Tag(t, "v1", "v1")
		r.fetchTags()
		_, err := r.svc.GetRequirementsAtTag(context.Background(), r.org, r.proj, "v1")
		if !errors.Is(err, ErrArtifactNotFound) {
			t.Fatalf("err = %v, want ErrArtifactNotFound", err)
		}
	})
}

func TestGetDesignAtTag_RecursiveNestedPaths(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{
		"specs/design/design.md":                        "root design\n",
		"specs/design/components/user-api/design.json":  "component design\n",
		"specs/design/components/user-api/openapi.yaml": "openapi: 3.0.0\n",
	})
	r.remote.Tag(t, "v1-1", "design v1-1")
	r.fetchTags()

	got, err := r.svc.GetDesignAtTag(context.Background(), r.org, r.proj, "v1-1")
	if err != nil {
		t.Fatalf("GetDesignAtTag: %v", err)
	}
	want := map[string]string{
		"design.md":                        "root design\n",
		"components/user-api/design.json":  "component design\n",
		"components/user-api/openapi.yaml": "openapi: 3.0.0\n",
	}
	if len(got) != len(want) {
		t.Fatalf("got %d entries %v, want %d (recursive read must include nested files)", len(got), got, len(want))
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("got[%q] = %q, want %q", k, got[k], v)
		}
	}
}

func TestGetDesignAtTag_MalformedTagRejected(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/design/design.md": "d\n"})
	_, err := r.svc.GetDesignAtTag(context.Background(), r.org, r.proj, "v1")
	if !errors.Is(err, ErrInvalidVersionTag) {
		t.Fatalf("err = %v, want ErrInvalidVersionTag (v1 is a requirements tag)", err)
	}
}

func TestConcatRequirementBundle_OrderingAndMarkdownOnly(t *testing.T) {
	t.Parallel()
	if got := ConcatRequirementBundle(nil); got != "" {
		t.Errorf("empty bundle = %q, want empty string", got)
	}
	files := map[string]string{
		"b.md":                 "Body B",
		"a.md":                 "Body A",
		"wireframe.excalidraw": `{"scene":true}`,
		"model.dsl":            "workspace {}",
	}
	got := ConcatRequirementBundle(files)
	want := "# a.md\n\nBody A\n\n# b.md\n\nBody B"
	if got != want {
		t.Errorf("bundle =\n%q\nwant\n%q", got, want)
	}
}
