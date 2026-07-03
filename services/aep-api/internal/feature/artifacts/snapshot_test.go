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

// Requirements-directory snapshots (the chat per-turn undo / session baseline)
// stored out-of-band under .git/aep-reqchat-snapshots/.

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestSnapshot_CaptureRestoreRoundTrip(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{
		"specs/requirements/requirements.md": "main\n",
		"specs/requirements/a.md":            "alpha\n",
	})
	ctx := context.Background()

	snap, err := r.svc.CaptureRequirementsSnapshot(ctx, r.org, r.proj, "snap1")
	if err != nil {
		t.Fatalf("Capture: %v", err)
	}
	if len(snap) != 2 || snap["requirements.md"] != "main\n" || snap["a.md"] != "alpha\n" {
		t.Fatalf("captured = %v, want {requirements.md, a.md}", snap)
	}

	// Diverge: modify main, delete a.md, add b.md.
	r.writeWT("specs/requirements/requirements.md", "changed\n")
	r.rmWT("specs/requirements/a.md")
	r.writeWT("specs/requirements/b.md", "beta\n")

	restored, err := r.svc.RestoreRequirementsSnapshot(ctx, r.org, r.proj, "snap1")
	if err != nil {
		t.Fatalf("Restore: %v", err)
	}
	want := map[string]string{"requirements.md": "main\n", "a.md": "alpha\n"}
	if len(restored) != len(want) {
		t.Fatalf("restored = %v, want %v", restored, want)
	}
	for k, v := range want {
		if restored[k] != v {
			t.Errorf("restored[%q] = %q, want %q", k, restored[k], v)
		}
	}
	// b.md (added after the snapshot) must be gone; a.md restored.
	if _, ok := r.readWT("specs/requirements/b.md"); ok {
		t.Error("b.md should be removed on restore")
	}
	if got, _ := r.readWT("specs/requirements/a.md"); got != "alpha\n" {
		t.Errorf("a.md not restored: %q", got)
	}
}

func TestSnapshot_ReadFile_ThreeWay(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{
		"specs/requirements/requirements.md": "main\n",
		"specs/requirements/a.md":            "alpha\n",
	})
	ctx := context.Background()
	if _, err := r.svc.CaptureRequirementsSnapshot(ctx, r.org, r.proj, "snap1"); err != nil {
		t.Fatalf("Capture: %v", err)
	}

	t.Run("file present in snapshot", func(t *testing.T) {
		content, existed, err := r.svc.ReadFileFromRequirementsSnapshot(ctx, r.org, r.proj, "snap1", "a.md")
		if err != nil || !existed || content != "alpha\n" {
			t.Fatalf("got (%q, %v, %v), want (alpha, true, nil)", content, existed, err)
		}
	})

	t.Run("snapshot exists but file absent -> existed=false, no error", func(t *testing.T) {
		content, existed, err := r.svc.ReadFileFromRequirementsSnapshot(ctx, r.org, r.proj, "snap1", "later.md")
		if err != nil || existed || content != "" {
			t.Fatalf("got (%q, %v, %v), want (\"\", false, nil)", content, existed, err)
		}
	})

	t.Run("snapshot blob missing -> ErrArtifactNotFound", func(t *testing.T) {
		_, _, err := r.svc.ReadFileFromRequirementsSnapshot(ctx, r.org, r.proj, "no-such-snap", "a.md")
		if !errors.Is(err, ErrArtifactNotFound) {
			t.Fatalf("err = %v, want ErrArtifactNotFound", err)
		}
	})
}

func TestSnapshot_DeleteIdempotent(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "main\n"})
	ctx := context.Background()
	if _, err := r.svc.CaptureRequirementsSnapshot(ctx, r.org, r.proj, "snap1"); err != nil {
		t.Fatalf("Capture: %v", err)
	}
	if err := r.svc.DeleteRequirementsSnapshot(ctx, r.org, r.proj, "snap1"); err != nil {
		t.Fatalf("first delete: %v", err)
	}
	// Deleting an already-gone snapshot is a no-op, not an error.
	if err := r.svc.DeleteRequirementsSnapshot(ctx, r.org, r.proj, "snap1"); err != nil {
		t.Fatalf("second delete should be idempotent: %v", err)
	}
}

func TestSnapshot_RestoreSkipsMalformedFilenames(t *testing.T) {
	t.Parallel()
	// Defence in depth: a hand-crafted snapshot blob with a traversal key must
	// be skipped on restore, never written outside specs/requirements/.
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "seed\n"})
	ctx := context.Background()

	dir := filepath.Join(r.clonePath, ".git", "aep-reqchat-snapshots")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(map[string]string{
		"../escape.md":    "pwned",
		"good.md":         "ok\n",
		"requirements.md": "restored main\n",
	})
	if err := os.WriteFile(filepath.Join(dir, "evil.json"), payload, 0o644); err != nil {
		t.Fatal(err)
	}

	restored, err := r.svc.RestoreRequirementsSnapshot(ctx, r.org, r.proj, "evil")
	if err != nil {
		t.Fatalf("Restore: %v", err)
	}
	want := map[string]string{"good.md": "ok\n", "requirements.md": "restored main\n"}
	if len(restored) != len(want) {
		t.Fatalf("restored = %v, want %v (malformed key must be skipped)", restored, want)
	}
	// The traversal target (one level above specs/requirements) must not exist.
	if _, err := os.Stat(filepath.Join(r.clonePath, "specs", "escape.md")); !os.IsNotExist(err) {
		t.Errorf("traversal file was written (err=%v) — restore defence failed", err)
	}
}

func TestSnapshot_IDValidation(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "main\n"})
	ctx := context.Background()

	for _, id := range []string{"bad/id", "", "has space"} {
		if _, err := r.svc.CaptureRequirementsSnapshot(ctx, r.org, r.proj, id); !errors.Is(err, ErrArtifactPathInvalid) {
			t.Errorf("Capture(%q) err = %v, want ErrArtifactPathInvalid", id, err)
		}
	}
}
