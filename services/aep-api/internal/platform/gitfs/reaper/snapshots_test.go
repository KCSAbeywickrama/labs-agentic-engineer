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

package reaper

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/platform/gitfs"
	"github.com/wso2/aep/aep-api/internal/platform/gitfs/workspacetest"
)

// TestSnapshotAgeReap exercises pass 2 against a REAL mirror: an aged
// non-HEAD snapshot is trashed, the HEAD snapshot survives ANY age, and a
// fresh non-HEAD snapshot survives the age gate.
func TestSnapshotAgeReap(t *testing.T) {
	ctx := context.Background()
	fx := workspacetest.New(t, map[string]string{"f.txt": "v1"})

	sha1 := fx.Origin.HeadSHA(t)
	if err := fx.Engine.Ensure(ctx, fx.Ref, sha1); err != nil {
		t.Fatalf("ensure sha1: %v", err)
	}
	sha2 := fx.Origin.Seed(t, map[string]string{"f.txt": "v2"}, "v2")
	if err := fx.Engine.Ensure(ctx, fx.Ref, sha2); err != nil {
		t.Fatalf("ensure sha2: %v", err)
	}
	sha3 := fx.Origin.Seed(t, map[string]string{"f.txt": "v3"}, "v3")
	if head, err := fx.Engine.Head(ctx, fx.Ref, ""); err != nil || head != sha3 {
		t.Fatalf("head = %q, %v; want %q", head, err, sha3)
	}
	if err := fx.Engine.Ensure(ctx, fx.Ref, sha3); err != nil {
		t.Fatalf("ensure sha3: %v", err)
	}

	dirFor := func(sha string) string {
		d, err := gitfs.SnapshotDir(fx.Engine.Root(), fx.Ref, sha)
		if err != nil {
			t.Fatalf("snapshot dir %s: %v", sha, err)
		}
		return d
	}
	old := time.Now().Add(-25 * time.Hour)
	chtimes(t, dirFor(sha1), old) // aged + not HEAD → reap
	chtimes(t, dirFor(sha3), old) // aged but HEAD → keep
	// sha2 stays fresh → keep.

	r := New(fx.Engine, staticLister(nil), testCfg(), nil)
	if err := r.reapSnapshots(ctx); err != nil {
		t.Fatalf("reap snapshots: %v", err)
	}

	mustNotExist(t, dirFor(sha1))
	mustExist(t, dirFor(sha2))
	mustExist(t, dirFor(sha3))
	if got := trashEntries(t, fx.Engine.Root()); len(got) != 1 {
		t.Fatalf("want exactly the reaped snapshot in trash, got %v", got)
	}
}

// TestSnapshotReapOrphanedByMissingMirror: with no mirror at all, every aged
// snapshot is orphaned and eligible regardless of sha.
func TestSnapshotReapOrphanedByMissingMirror(t *testing.T) {
	r, root := newSyntheticReaper(t, testCfg(), staticLister(nil))
	slugDir := mkSlugDir(t, root, "o1", "p1", "r1")
	aged := mkSnapshot(t, slugDir, fakeSha(1), 10, time.Now().Add(-25*time.Hour))
	fresh := mkSnapshot(t, slugDir, fakeSha(2), 10, time.Now())

	if err := r.reapSnapshots(context.Background()); err != nil {
		t.Fatalf("reap snapshots: %v", err)
	}
	mustNotExist(t, aged)
	mustExist(t, fresh)
}

// TestMirrorHeadResolvesLooseAndPackedRefs covers the direct ref-store read:
// loose ref wins, packed-refs is the fallback, missing mirror is "".
func TestMirrorHeadResolvesLooseAndPackedRefs(t *testing.T) {
	looseSha, packedSha := fakeSha(3), fakeSha(4)
	gitDir := filepath.Join(t.TempDir(), "git")
	mkFile(t, filepath.Join(gitDir, "HEAD"), 0)
	if err := os.WriteFile(filepath.Join(gitDir, "HEAD"), []byte("ref: refs/heads/main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(gitDir, "packed-refs"),
		[]byte("# pack-refs with: peeled fully-peeled sorted\n"+packedSha+" refs/heads/main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := mirrorHead(gitDir); got != packedSha {
		t.Fatalf("packed-refs fallback = %q, want %q", got, packedSha)
	}
	mkFile(t, filepath.Join(gitDir, "refs", "heads", "main"), 0)
	if err := os.WriteFile(filepath.Join(gitDir, "refs", "heads", "main"), []byte(looseSha+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := mirrorHead(gitDir); got != looseSha {
		t.Fatalf("loose ref = %q, want %q", got, looseSha)
	}
	if got := mirrorHead(filepath.Join(t.TempDir(), "absent")); got != "" {
		t.Fatalf("missing mirror = %q, want empty", got)
	}
}
