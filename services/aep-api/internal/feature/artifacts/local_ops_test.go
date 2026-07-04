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

// Local git-exec ops against a real clone: GetFile/PutFile (+ If-Match + size
// cap), the two list surfaces, and the three delete surfaces (incl. the
// empty-parent-dir cleanup walk). These pin the working-tree behaviour that
// today has zero coverage.

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGetFile_Happy_ReturnsContentAndHashObjectSHA(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "hello world\n"})
	ctx := context.Background()

	got, err := r.svc.GetFile(ctx, r.org, r.proj, "specs/requirements/requirements.md")
	if err != nil {
		t.Fatalf("GetFile: %v", err)
	}
	if got.Content != "hello world\n" {
		t.Errorf("Content = %q, want %q", got.Content, "hello world\n")
	}
	// SHA must be exactly `git hash-object` of the bytes — pin it against the
	// same primitive the service uses so a swapped hash impl is caught.
	wantSHA, err := blobSHAFor(ctx, r.clonePath, []byte("hello world\n"))
	if err != nil {
		t.Fatalf("blobSHAFor: %v", err)
	}
	if got.SHA != wantSHA {
		t.Errorf("SHA = %q, want %q", got.SHA, wantSHA)
	}
}

func TestGetFile_Missing_ReturnsErrArtifactNotFound(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "x\n"})
	_, err := r.svc.GetFile(context.Background(), r.org, r.proj, "specs/requirements/nope.md")
	if !errors.Is(err, ErrArtifactNotFound) {
		t.Fatalf("err = %v, want ErrArtifactNotFound", err)
	}
}

func TestGetFile_Traversal_RejectedBeforeIO(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "x\n"})
	_, err := r.svc.GetFile(context.Background(), r.org, r.proj, "specs/../etc/passwd")
	if !errors.Is(err, ErrArtifactPathInvalid) {
		t.Fatalf("err = %v, want ErrArtifactPathInvalid", err)
	}
}

func TestPutFile_WritesFileAndReturnsHashObjectSHA(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "x\n"})
	ctx := context.Background()

	res, err := r.svc.PutFile(ctx, r.org, r.proj, "specs/requirements/new.md", "brand new\n", "")
	if err != nil {
		t.Fatalf("PutFile: %v", err)
	}
	wantSHA, _ := blobSHAFor(ctx, r.clonePath, []byte("brand new\n"))
	if res.SHA != wantSHA {
		t.Errorf("SHA = %q, want %q", res.SHA, wantSHA)
	}
	if got, ok := r.readWT("specs/requirements/new.md"); !ok || got != "brand new\n" {
		t.Errorf("on-disk content = %q (present=%v), want %q", got, ok, "brand new\n")
	}
}

func TestPutFile_IfMatch(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "x\n"})
	ctx := context.Background()

	// Seed a file, then capture its current blob sha.
	if _, err := r.svc.PutFile(ctx, r.org, r.proj, "specs/requirements/f.md", "v1\n", ""); err != nil {
		t.Fatalf("seed put: %v", err)
	}
	sha1, _ := blobSHAFor(ctx, r.clonePath, []byte("v1\n"))

	t.Run("match succeeds", func(t *testing.T) {
		if _, err := r.svc.PutFile(ctx, r.org, r.proj, "specs/requirements/f.md", "v2\n", sha1); err != nil {
			t.Fatalf("If-Match match should succeed: %v", err)
		}
		if got, _ := r.readWT("specs/requirements/f.md"); got != "v2\n" {
			t.Errorf("content = %q, want v2", got)
		}
	})

	t.Run("mismatch returns ErrIfMatchFailed", func(t *testing.T) {
		// Current content is now "v2\n"; a stale sha must be rejected.
		_, err := r.svc.PutFile(ctx, r.org, r.proj, "specs/requirements/f.md", "v3\n", "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef")
		if !errors.Is(err, ErrIfMatchFailed) {
			t.Fatalf("err = %v, want ErrIfMatchFailed", err)
		}
		if got, _ := r.readWT("specs/requirements/f.md"); got != "v2\n" {
			t.Errorf("content mutated on failed If-Match: %q", got)
		}
	})

	t.Run("absent file with non-empty If-Match fails", func(t *testing.T) {
		// QUIRK: an If-Match against a file that doesn't exist can never match
		// (currentSHA is "" ≠ the supplied sha), so it is ErrIfMatchFailed, not
		// a create.
		_, err := r.svc.PutFile(ctx, r.org, r.proj, "specs/requirements/ghost.md", "x\n", "anything")
		if !errors.Is(err, ErrIfMatchFailed) {
			t.Fatalf("err = %v, want ErrIfMatchFailed", err)
		}
		if _, ok := r.readWT("specs/requirements/ghost.md"); ok {
			t.Error("ghost.md should not have been created")
		}
	})
}

func TestPutFile_OverSizeCap_Rejected(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "x\n"})
	big := strings.Repeat("a", maxArtifactBytes+1)
	_, err := r.svc.PutFile(context.Background(), r.org, r.proj, "specs/requirements/big.md", big, "")
	if !errors.Is(err, ErrArtifactPathInvalid) {
		t.Fatalf("err = %v, want ErrArtifactPathInvalid", err)
	}
	if _, ok := r.readWT("specs/requirements/big.md"); ok {
		t.Error("oversize file should not be written")
	}
}

func TestListRequirementFiles(t *testing.T) {
	t.Parallel()

	t.Run("missing dir yields empty map", func(t *testing.T) {
		t.Parallel()
		r := newRig(t, map[string]string{"README.md": "root"})
		files, err := r.svc.ListRequirementFiles(context.Background(), r.org, r.proj)
		if err != nil {
			t.Fatalf("ListRequirementFiles: %v", err)
		}
		if len(files) != 0 {
			t.Fatalf("want empty map, got %v", files)
		}
	})

	t.Run("extension filtering", func(t *testing.T) {
		t.Parallel()
		r := newRig(t, map[string]string{
			"specs/requirements/requirements.md": "r\n",
			"specs/requirements/wire.excalidraw": "{}",
			"specs/requirements/canvas.dsl":      "dsl",
			"specs/requirements/notes.txt":       "ignored",
		})
		files, err := r.svc.ListRequirementFiles(context.Background(), r.org, r.proj)
		if err != nil {
			t.Fatalf("ListRequirementFiles: %v", err)
		}
		wantKeys := []string{"requirements.md", "wire.excalidraw", "canvas.dsl"}
		if len(files) != len(wantKeys) {
			t.Fatalf("got %d files %v, want %d", len(files), files, len(wantKeys))
		}
		for _, k := range wantKeys {
			if _, ok := files[k]; !ok {
				t.Errorf("missing key %q in %v", k, files)
			}
		}
		if _, ok := files["notes.txt"]; ok {
			t.Error("notes.txt (disallowed ext) should be filtered out")
		}
	})
}

func TestListDesignFiles_NestedKeysForwardSlashed(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{
		"specs/design/design.md":                        "root\n",
		"specs/design/components/user-api/design.json":  "comp\n",
		"specs/design/components/user-api/openapi.yaml": "openapi: 3.0.0\n",
		"specs/design/notes.txt":                        "ignored",
	})
	files, err := r.svc.ListDesignFiles(context.Background(), r.org, r.proj)
	if err != nil {
		t.Fatalf("ListDesignFiles: %v", err)
	}
	want := map[string]string{
		"design.md":                        "root\n",
		"components/user-api/design.json":  "comp\n",
		"components/user-api/openapi.yaml": "openapi: 3.0.0\n",
	}
	if len(files) != len(want) {
		t.Fatalf("got %d entries %v, want %d", len(files), files, len(want))
	}
	for k, v := range want {
		if files[k] != v {
			t.Errorf("files[%q] = %q, want %q", k, files[k], v)
		}
	}
}

func TestListDesignFiles_MissingDirEmpty(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"README.md": "root"})
	files, err := r.svc.ListDesignFiles(context.Background(), r.org, r.proj)
	if err != nil {
		t.Fatalf("ListDesignFiles: %v", err)
	}
	if len(files) != 0 {
		t.Fatalf("want empty map, got %v", files)
	}
}

func TestDeleteRequirementFile(t *testing.T) {
	t.Parallel()

	t.Run("main file undeletable", func(t *testing.T) {
		t.Parallel()
		r := newRig(t, map[string]string{"specs/requirements/requirements.md": "x\n"})
		err := r.svc.DeleteRequirementFile(context.Background(), r.org, r.proj, "requirements.md")
		if !errors.Is(err, ErrArtifactPathInvalid) {
			t.Fatalf("err = %v, want ErrArtifactPathInvalid", err)
		}
		if _, ok := r.readWT("specs/requirements/requirements.md"); !ok {
			t.Error("requirements.md must not be deleted")
		}
	})

	t.Run("missing returns ErrArtifactNotFound", func(t *testing.T) {
		t.Parallel()
		r := newRig(t, map[string]string{"specs/requirements/requirements.md": "x\n"})
		err := r.svc.DeleteRequirementFile(context.Background(), r.org, r.proj, "ghost.md")
		if !errors.Is(err, ErrArtifactNotFound) {
			t.Fatalf("err = %v, want ErrArtifactNotFound", err)
		}
	})

	t.Run("happy removes the file", func(t *testing.T) {
		t.Parallel()
		r := newRig(t, map[string]string{
			"specs/requirements/requirements.md": "x\n",
			"specs/requirements/extra.md":        "extra\n",
		})
		if err := r.svc.DeleteRequirementFile(context.Background(), r.org, r.proj, "extra.md"); err != nil {
			t.Fatalf("DeleteRequirementFile: %v", err)
		}
		if _, ok := r.readWT("specs/requirements/extra.md"); ok {
			t.Error("extra.md should be gone")
		}
	})
}

func TestDeleteDesignFile(t *testing.T) {
	t.Parallel()

	t.Run("root design.md undeletable", func(t *testing.T) {
		t.Parallel()
		r := newRig(t, map[string]string{"specs/design/design.md": "root\n"})
		err := r.svc.DeleteDesignFile(context.Background(), r.org, r.proj, "design.md")
		if !errors.Is(err, ErrArtifactPathInvalid) {
			t.Fatalf("err = %v, want ErrArtifactPathInvalid", err)
		}
	})

	t.Run("missing returns ErrArtifactNotFound", func(t *testing.T) {
		t.Parallel()
		r := newRig(t, map[string]string{"specs/design/design.md": "root\n"})
		err := r.svc.DeleteDesignFile(context.Background(), r.org, r.proj, "components/ghost/design.json")
		if !errors.Is(err, ErrArtifactNotFound) {
			t.Fatalf("err = %v, want ErrArtifactNotFound", err)
		}
	})

	t.Run("empty parent dirs cleaned up but walk stops at DesignDir", func(t *testing.T) {
		t.Parallel()
		r := newRig(t, map[string]string{
			"specs/design/design.md":                  "root\n",
			"specs/design/components/foo/design.json": "foo\n",
		})
		if err := r.svc.DeleteDesignFile(context.Background(), r.org, r.proj, "components/foo/design.json"); err != nil {
			t.Fatalf("DeleteDesignFile: %v", err)
		}
		// components/foo emptied -> removed; components then empty -> removed.
		if _, err := os.Stat(filepath.Join(r.clonePath, "specs/design/components")); !os.IsNotExist(err) {
			t.Errorf("specs/design/components should have been cleaned up (err=%v)", err)
		}
		// The walk must stop at DesignDir: specs/design itself survives.
		if _, err := os.Stat(filepath.Join(r.clonePath, "specs/design")); err != nil {
			t.Errorf("specs/design must not be removed: %v", err)
		}
		if _, ok := r.readWT("specs/design/design.md"); !ok {
			t.Error("root design.md must survive")
		}
	})
}

func TestDeleteDesignDirectory(t *testing.T) {
	t.Parallel()

	t.Run("root refusal", func(t *testing.T) {
		t.Parallel()
		r := newRig(t, map[string]string{"specs/design/design.md": "root\n"})
		// QUIRK: "." is rejected by validateDesignSubDir ("invalid segment")
		// before reaching the explicit sub=="." root-refusal branch, so that
		// branch in DeleteDesignDirectory is currently unreachable dead code.
		err := r.svc.DeleteDesignDirectory(context.Background(), r.org, r.proj, ".")
		if !errors.Is(err, ErrArtifactPathInvalid) {
			t.Fatalf("err = %v, want ErrArtifactPathInvalid", err)
		}
	})

	t.Run("non-directory target rejected", func(t *testing.T) {
		t.Parallel()
		r := newRig(t, map[string]string{"specs/design/design.md": "root\n"})
		err := r.svc.DeleteDesignDirectory(context.Background(), r.org, r.proj, "design.md")
		if !errors.Is(err, ErrArtifactPathInvalid) {
			t.Fatalf("err = %v, want ErrArtifactPathInvalid", err)
		}
	})

	t.Run("missing directory returns ErrArtifactNotFound", func(t *testing.T) {
		t.Parallel()
		r := newRig(t, map[string]string{"specs/design/design.md": "root\n"})
		err := r.svc.DeleteDesignDirectory(context.Background(), r.org, r.proj, "ghostdir")
		if !errors.Is(err, ErrArtifactNotFound) {
			t.Fatalf("err = %v, want ErrArtifactNotFound", err)
		}
	})

	t.Run("happy removes the whole subtree", func(t *testing.T) {
		t.Parallel()
		r := newRig(t, map[string]string{
			"specs/design/design.md":                  "root\n",
			"specs/design/components/foo/design.json": "foo\n",
		})
		if err := r.svc.DeleteDesignDirectory(context.Background(), r.org, r.proj, "components"); err != nil {
			t.Fatalf("DeleteDesignDirectory: %v", err)
		}
		if _, err := os.Stat(filepath.Join(r.clonePath, "specs/design/components")); !os.IsNotExist(err) {
			t.Errorf("components should be gone (err=%v)", err)
		}
		if _, ok := r.readWT("specs/design/design.md"); !ok {
			t.Error("root design.md must survive")
		}
	})
}
