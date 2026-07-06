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

// Discard = a revert-commit that rewrites the artifact subtree on `main` back to
// its last tag (or to empty when no tag exists). The commit is real: assertions
// read the bare repo's `main` tip.

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"

	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
)

func TestDiscardRequirements_RevertsToLastTag(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "approved\n"})
	ctx := context.Background()
	if _, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("save: %v", err)
	}
	// Draft drift on main: edit the main doc, add a new one, add an unrelated file.
	r.seed(map[string]string{
		"specs/requirements/requirements.md": "draft edit\n",
		"specs/requirements/extra.md":        "new draft doc\n",
		"unrelated.md":                       "outside the artifact\n",
	}, "draft changes")

	files, err := r.svc.DiscardRequirements(ctx, r.org, r.proj)
	if err != nil {
		t.Fatalf("DiscardRequirements: %v", err)
	}
	if files["requirements.md"] != "approved\n" {
		t.Errorf("returned bundle = %v, want requirements.md reverted to approved", files)
	}
	if _, ok := files["extra.md"]; ok {
		t.Errorf("extra.md should be gone after discard, got %v", files)
	}
	// main reflects the revert; the unrelated file is untouched.
	if got := r.fileAt("main", "specs/requirements/requirements.md"); got != "approved\n" {
		t.Errorf("main requirements.md = %q, want approved", got)
	}
	if r.blobExistsAt("main", "specs/requirements/extra.md") {
		t.Error("extra.md should have been tombstoned on main")
	}
	if got := r.fileAt("main", "unrelated.md"); got != "outside the artifact\n" {
		t.Errorf("unrelated.md = %q, want preserved (revert only touches the artifact subtree)", got)
	}
}

func TestDiscardRequirements_NoTag_RevertsToEmpty(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{
		"specs/requirements/requirements.md": "never approved\n",
		"keep.md":                            "outside\n",
	})
	files, err := r.svc.DiscardRequirements(context.Background(), r.org, r.proj)
	if err != nil {
		t.Fatalf("DiscardRequirements: %v", err)
	}
	if len(files) != 0 {
		t.Errorf("bundle = %v, want empty (no approved version to revert to)", files)
	}
	if r.blobExistsAt("main", "specs/requirements/requirements.md") {
		t.Error("requirements.md should be gone on main (revert-to-empty)")
	}
	if got := r.fileAt("main", "keep.md"); got != "outside\n" {
		t.Errorf("keep.md = %q, want preserved", got)
	}
}

func TestDiscardDesign_RevertsToLastTag(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "spec\n"})
	ctx := context.Background()
	if _, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("save requirements: %v", err)
	}
	r.seed(map[string]string{
		"specs/design/design.md":                  "# Approved\n",
		"specs/design/components/svc/design.json": validComponentDesignJSON("svc"),
	}, "design")
	if _, err := r.svc.SaveDesign(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("save design: %v", err)
	}
	// Drift the design on main.
	r.seed(map[string]string{"specs/design/design.md": "# Draft edit\n"}, "design draft")

	files, err := r.svc.DiscardDesign(ctx, r.org, r.proj)
	if err != nil {
		t.Fatalf("DiscardDesign: %v", err)
	}
	if files["design.md"] != "# Approved\n" {
		t.Errorf("design.md = %q, want reverted to approved", files["design.md"])
	}
	if got := r.fileAt("main", "specs/design/design.md"); got != "# Approved\n" {
		t.Errorf("main design.md = %q, want approved", got)
	}
}

// A discard when the subtree already matches the latest tag stages a tree
// identical to base — Mutate commits nothing and HEAD stays put (today's
// no-commit-on-no-diff behavior, preserved through the Mutate port).
func TestDiscardRequirements_NoDiff_NoCommit(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "approved\n"})
	ctx := context.Background()
	if _, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("save: %v", err)
	}
	head := r.headSHA()

	files, err := r.svc.DiscardRequirements(ctx, r.org, r.proj)
	if err != nil {
		t.Fatalf("DiscardRequirements: %v", err)
	}
	if files["requirements.md"] != "approved\n" {
		t.Errorf("bundle = %v, want the approved content", files)
	}
	if got := r.headSHA(); got != head {
		t.Errorf("HEAD moved %s → %s on a no-diff discard — must not commit", head, got)
	}
}

// A concurrent writer advances origin between the revert's fetch and its push
// (injected inside the first Mutate fn attempt — post-fetch, pre-push): the
// push is a genuine non-fast-forward, Mutate re-fetches and re-runs the fn
// against the new base, and the retry lands with the external commit preserved.
func TestDiscardRequirements_CASConflict_RetriesAndSucceeds(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "approved\n"})
	ctx := context.Background()
	if _, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("save: %v", err)
	}
	r.seed(map[string]string{"specs/requirements/requirements.md": "draft\n"}, "draft")

	var fnAttempts int32
	r.ws.BeforeMutateFn = func(attempt int) {
		atomic.AddInt32(&fnAttempts, 1)
		if attempt == 1 {
			// An external writer advances main after this attempt's fetch →
			// its push is a real non-fast-forward.
			r.seed(map[string]string{"external.md": "external\n"}, "external push")
		}
	}

	if _, err := r.svc.DiscardRequirements(ctx, r.org, r.proj); err != nil {
		t.Fatalf("DiscardRequirements: %v", err)
	}
	if n := atomic.LoadInt32(&fnAttempts); n != 2 {
		t.Errorf("Mutate fn attempts = %d, want 2 (first push non-FF, retry succeeds)", n)
	}
	if got := r.fileAt("main", "specs/requirements/requirements.md"); got != "approved\n" {
		t.Errorf("requirements.md = %q, want reverted to approved", got)
	}
	if got := r.fileAt("main", "external.md"); got != "external\n" {
		t.Errorf("external.md = %q, want preserved (base refresh on retry)", got)
	}
}

// Origin advances on EVERY attempt → Mutate exhausts its bounded retry and the
// discard surfaces the wrapped ErrRefNotFastForward sentinel (the retired
// REST leaky bucket's ErrConflictBudgetExhausted is gone).
func TestDiscardRequirements_RetryExhaustionSurfacesNonFastForward(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "approved\n"})
	ctx := context.Background()
	if _, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("save: %v", err)
	}
	r.seed(map[string]string{"specs/requirements/requirements.md": "draft\n"}, "draft")

	var fnAttempts int32
	r.ws.BeforeMutateFn = func(attempt int) {
		n := atomic.AddInt32(&fnAttempts, 1)
		// Advance main after every fetch so no push can ever fast-forward.
		r.seed(map[string]string{"ext.md": string(rune('a' + n))}, "external push")
	}

	_, err := r.svc.DiscardRequirements(ctx, r.org, r.proj)
	if !errors.Is(err, gitrepo.ErrRefNotFastForward) {
		t.Fatalf("err = %v, want wrapped gitrepo.ErrRefNotFastForward after exhaustion", err)
	}
	if n := atomic.LoadInt32(&fnAttempts); n != 4 {
		t.Errorf("Mutate fn attempts = %d, want the full default policy of 4", n)
	}
	// The revert never landed — the draft is still on main.
	if got := r.fileAt("main", "specs/requirements/requirements.md"); got != "draft\n" {
		t.Errorf("requirements.md = %q, want the untouched draft", got)
	}
}
