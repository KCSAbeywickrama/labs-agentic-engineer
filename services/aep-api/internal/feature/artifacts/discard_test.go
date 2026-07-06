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

// Discard reverts the working tree to the latest tag: files added since the
// tag are removed, deletions are restored. Discard fetches tags itself, so the
// tag only needs to exist on the remote.

import (
	"context"
	"errors"
	"testing"
)

func TestDiscardRequirements_RevertsToLatestTag(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{
		"specs/requirements/requirements.md": "baseline\n",
		"specs/requirements/keep.md":         "keep\n",
	})
	r.remote.Tag(t, "v1", "requirements v1") // baseline snapshot

	// Diverge the working tree: modify, add, and delete.
	r.writeWT("specs/requirements/requirements.md", "edited since tag\n")
	r.writeWT("specs/requirements/added.md", "added since tag\n")
	r.rmWT("specs/requirements/keep.md")

	restored, err := r.svc.DiscardRequirements(context.Background(), r.org, r.proj)
	if err != nil {
		t.Fatalf("DiscardRequirements: %v", err)
	}
	want := map[string]string{"requirements.md": "baseline\n", "keep.md": "keep\n"}
	if len(restored) != len(want) {
		t.Fatalf("restored = %v, want %v", restored, want)
	}
	for k, v := range want {
		if restored[k] != v {
			t.Errorf("restored[%q] = %q, want %q", k, restored[k], v)
		}
	}
	// The added-since-tag file must be gone from the working tree — this proves
	// the "remove current contents first" step, not just a checkout overlay.
	if _, ok := r.readWT("specs/requirements/added.md"); ok {
		t.Error("added.md should be removed by discard")
	}
	if got, _ := r.readWT("specs/requirements/keep.md"); got != "keep\n" {
		t.Errorf("keep.md not restored: %q", got)
	}
	if got, _ := r.readWT("specs/requirements/requirements.md"); got != "baseline\n" {
		t.Errorf("requirements.md not reverted: %q", got)
	}
}

func TestDiscardRequirements_NoTag_ErrNoVersionToDiscard(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "r\n"})
	_, err := r.svc.DiscardRequirements(context.Background(), r.org, r.proj)
	if !errors.Is(err, ErrNoVersionToDiscard) {
		t.Fatalf("err = %v, want ErrNoVersionToDiscard", err)
	}
}

func TestDiscardDesign_RevertsToLatestTag(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{
		"specs/design/design.md":                  "baseline root\n",
		"specs/design/components/api/design.json": "baseline comp\n",
	})
	r.remote.Tag(t, "v1-1", "design v1-1")

	// Diverge: modify root, add a nested file not in the tag.
	r.writeWT("specs/design/design.md", "edited\n")
	r.writeWT("specs/design/components/api/openapi.yaml", "openapi: 3.0.0\n")

	restored, err := r.svc.DiscardDesign(context.Background(), r.org, r.proj)
	if err != nil {
		t.Fatalf("DiscardDesign: %v", err)
	}
	want := map[string]string{
		"design.md":                  "baseline root\n",
		"components/api/design.json": "baseline comp\n",
	}
	if len(restored) != len(want) {
		t.Fatalf("restored = %v, want %v", restored, want)
	}
	for k, v := range want {
		if restored[k] != v {
			t.Errorf("restored[%q] = %q, want %q", k, restored[k], v)
		}
	}
	if _, ok := r.readWT("specs/design/components/api/openapi.yaml"); ok {
		t.Error("added-since-tag openapi.yaml should be removed by discard")
	}
}

func TestDiscardDesign_NoTag_ErrNoVersionToDiscard(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/design/design.md": "d\n"})
	_, err := r.svc.DiscardDesign(context.Background(), r.org, r.proj)
	if !errors.Is(err, ErrNoVersionToDiscard) {
		t.Fatalf("err = %v, want ErrNoVersionToDiscard", err)
	}
}
