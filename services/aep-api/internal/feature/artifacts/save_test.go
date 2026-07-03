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

// The save flows end to end: working-tree changeset → GitHub Git Data API
// (blob/tree/commit/ref) → annotated tag → post-save pull, all over the REAL
// clients/github host client against a Git-Data-API fake backed by the same bare repo
// the clone was made from. Assertions read the bare repo directly.

import (
	"context"
	"errors"
	"testing"
)

func TestSaveRequirements_FirstSave_CommitsTagsAndPulls(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "v0 seed\n"})
	ctx := context.Background()

	// Modify the working tree so the save actually uploads a blob + commits.
	r.writeWT("specs/requirements/requirements.md", "v1 content\n")

	res, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{})
	if err != nil {
		t.Fatalf("SaveRequirements: %v", err)
	}
	if res.Status != "approved" || res.Tag != "v1" || res.Version != 1 || res.CommitHash == "" {
		t.Fatalf("result = %+v, want approved/v1/1/<commit>", res)
	}

	// The commit really landed on the bare repo's main.
	if got := r.remote.FileAt(t, "main", "specs/requirements/requirements.md"); got != "v1 content\n" {
		t.Errorf("main content = %q, want %q", got, "v1 content\n")
	}
	if tags := r.remote.Tags(t); len(tags) != 1 || tags[0] != "v1" {
		t.Errorf("remote tags = %v, want [v1]", tags)
	}
	// Post-save pull advanced the local clone HEAD to the new remote HEAD.
	if head := r.remote.HeadSHA(t); head != res.CommitHash || r.localHEAD() != res.CommitHash {
		t.Errorf("HEAD sync mismatch: remote=%s local=%s commit=%s", head, r.localHEAD(), res.CommitHash)
	}

	// A subsequent save with no working-tree change is "unchanged".
	res2, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{})
	if err != nil {
		t.Fatalf("second SaveRequirements: %v", err)
	}
	if res2.Status != "unchanged" || res2.Tag != "v1" {
		t.Errorf("second save = %+v, want unchanged/v1", res2)
	}
}

func TestSaveRequirements_ModifyDeleteAdd_TombstoneAndBaseTree(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{
		"specs/requirements/requirements.md": "main v0\n",
		"specs/requirements/extra.md":        "extra v0\n",
		"unrelated.md":                       "untouched\n", // outside specs/requirements
	})
	ctx := context.Background()

	// v1 baseline (a modify so it commits).
	r.writeWT("specs/requirements/requirements.md", "main v1\n")
	if _, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("baseline save: %v", err)
	}

	// v2: modify main, delete extra.md (a tombstone for a path ON main), add new.md.
	r.writeWT("specs/requirements/requirements.md", "main v2\n")
	r.rmWT("specs/requirements/extra.md")
	r.writeWT("specs/requirements/new.md", "new file\n")

	res, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{})
	if err != nil {
		t.Fatalf("second save: %v", err)
	}
	if res.Status != "approved" || res.Tag != "v2" {
		t.Fatalf("result = %+v, want approved/v2", res)
	}

	if got := r.remote.FileAt(t, "main", "specs/requirements/requirements.md"); got != "main v2\n" {
		t.Errorf("requirements.md = %q, want main v2", got)
	}
	if got := r.remote.FileAt(t, "main", "specs/requirements/new.md"); got != "new file\n" {
		t.Errorf("new.md = %q, want new file", got)
	}
	// Tombstone honoured: extra.md removed from main.
	if r.blobExistsAt("main", "specs/requirements/extra.md") {
		t.Error("extra.md should be tombstoned off main")
	}
	// base_tree semantics: an unrelated file we never touched is carried forward.
	if got := r.remote.FileAt(t, "main", "unrelated.md"); got != "untouched\n" {
		t.Errorf("unrelated.md = %q, want untouched (base_tree must preserve it)", got)
	}
}

func TestSaveRequirements_UnchangedNoTag_TagsMainAsV1(t *testing.T) {
	t.Parallel()
	// No working-tree changes and no tags yet: the flow tags current main as v1
	// (status approved), rather than reporting unchanged.
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "seed\n"})
	res, err := r.svc.SaveRequirements(context.Background(), r.org, r.proj, SaveRequest{})
	if err != nil {
		t.Fatalf("SaveRequirements: %v", err)
	}
	if res.Status != "approved" || res.Tag != "v1" {
		t.Fatalf("result = %+v, want approved/v1", res)
	}
	if tags := r.remote.Tags(t); len(tags) != 1 || tags[0] != "v1" {
		t.Errorf("remote tags = %v, want [v1]", tags)
	}
}

func TestSaveRequirements_DeleteOnlyNotOnMain_NoOpTombstoneUnchanged(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "r0\n"})
	ctx := context.Background()

	// Establish v1 (so an "unchanged" result has a tag to report).
	r.writeWT("specs/requirements/requirements.md", "r1\n")
	if _, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("baseline save: %v", err)
	}

	// Create a file that lives in LOCAL HEAD only (committed locally, never
	// pushed to main), then delete it from the working tree. The changeset then
	// contains a single D for a path that is NOT on main.
	r.writeWT("specs/requirements/ghost.md", "local only\n")
	r.git("add", "specs/requirements/ghost.md")
	r.git("commit", "-m", "local-only ghost")
	r.rmWT("specs/requirements/ghost.md")

	res, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{})
	if err != nil {
		// If the no-op-tombstone filter were dropped, ghost.md would be sent as a
		// sha:null delete for a path absent in base_tree → the fake 422s exactly
		// like GitHub → this save would error. That's the mutation this catches.
		t.Fatalf("delete-only-of-not-on-main should be a no-op, got error: %v", err)
	}
	if res.Status != "unchanged" || res.Tag != "v1" {
		t.Fatalf("result = %+v, want unchanged/v1", res)
	}
}

func TestSaveDesign_NoRequirementsBaseline(t *testing.T) {
	t.Parallel()
	// design.md present but no v<N> requirements tag exists yet.
	r := newRig(t, map[string]string{
		"specs/requirements/requirements.md": "r\n",
		"specs/design/design.md":             "design\n",
	})
	_, err := r.svc.SaveDesign(context.Background(), r.org, r.proj, SaveRequest{})
	if !errors.Is(err, ErrNoRequirementsBaseline) {
		t.Fatalf("err = %v, want ErrNoRequirementsBaseline", err)
	}
}

func TestSaveDesign_MissingRootDesignFile(t *testing.T) {
	t.Parallel()
	// No specs/design/design.md at all — rejected before the baseline check.
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "r\n"})
	_, err := r.svc.SaveDesign(context.Background(), r.org, r.proj, SaveRequest{})
	if !errors.Is(err, ErrArtifactPathInvalid) {
		t.Fatalf("err = %v, want ErrArtifactPathInvalid", err)
	}
}

func TestSaveDesign_RevisionAndParentTracking(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "r0\n"})
	ctx := context.Background()

	// requirements v1
	r.writeWT("specs/requirements/requirements.md", "r1\n")
	if _, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("requirements v1: %v", err)
	}

	// design v1-1
	r.writeWT("specs/design/design.md", "design 1\n")
	d1, err := r.svc.SaveDesign(ctx, r.org, r.proj, SaveRequest{})
	if err != nil {
		t.Fatalf("SaveDesign #1: %v", err)
	}
	if d1.Status != "approved" || d1.Tag != "v1-1" || d1.RequirementsVersion != 1 || d1.DesignRevision != 1 {
		t.Fatalf("d1 = %+v, want approved/v1-1/1/1", d1)
	}
	if got := r.remote.FileAt(t, "main", "specs/design/design.md"); got != "design 1\n" {
		t.Errorf("design.md on main = %q, want design 1", got)
	}

	// design v1-2 (revision bumps under the same parent)
	r.writeWT("specs/design/design.md", "design 2\n")
	d2, err := r.svc.SaveDesign(ctx, r.org, r.proj, SaveRequest{})
	if err != nil {
		t.Fatalf("SaveDesign #2: %v", err)
	}
	if d2.Tag != "v1-2" || d2.DesignRevision != 2 {
		t.Fatalf("d2 = %+v, want v1-2/2", d2)
	}

	// requirements v2, then a design save resets the revision under the new parent.
	r.writeWT("specs/requirements/requirements.md", "r2\n")
	if _, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("requirements v2: %v", err)
	}
	r.writeWT("specs/design/design.md", "design 3\n")
	d3, err := r.svc.SaveDesign(ctx, r.org, r.proj, SaveRequest{})
	if err != nil {
		t.Fatalf("SaveDesign #3: %v", err)
	}
	if d3.Tag != "v2-1" || d3.RequirementsVersion != 2 || d3.DesignRevision != 1 {
		t.Fatalf("d3 = %+v, want v2-1/2/1", d3)
	}
}
