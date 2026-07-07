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
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/platform/gitfs"
	"github.com/wso2/aep/aep-api/internal/platform/gitfs/workspacetest"
)

// TestTrashThenPurgeKeepsOpenFds proves the two-phase delete's core safety
// property: a reader holding an open fd survives BOTH phases (TrashRepo's
// rename and reclaimTrash's RemoveAll) by POSIX inode semantics — the
// content stays readable after the unlink.
func TestTrashThenPurgeKeepsOpenFds(t *testing.T) {
	ctx := context.Background()
	fx := workspacetest.New(t, map[string]string{"a.txt": "hello inode"})
	sha, err := fx.Engine.Head(ctx, fx.Ref, "")
	if err != nil {
		t.Fatalf("head: %v", err)
	}
	if err := fx.Engine.Ensure(ctx, fx.Ref, sha); err != nil {
		t.Fatalf("ensure snapshot: %v", err)
	}
	snapDir, err := gitfs.SnapshotDir(fx.Engine.Root(), fx.Ref, sha)
	if err != nil {
		t.Fatalf("snapshot dir: %v", err)
	}
	f, err := os.Open(filepath.Join(snapDir, "a.txt"))
	if err != nil {
		t.Fatalf("open snapshot file: %v", err)
	}
	defer f.Close()

	// Phase 1 — rename into trash: canonical path frees instantly.
	if err := fx.Engine.TrashRepo(ctx, fx.Ref); err != nil {
		t.Fatalf("trash repo: %v", err)
	}
	repoDir, _ := gitfs.RepoDir(fx.Engine.Root(), fx.Ref)
	mustNotExist(t, repoDir)

	// Phase 2 — purge: TrashMaxAge 1ns means everything qualifies.
	cfg := testCfg()
	cfg.TrashMaxAge = time.Nanosecond
	r := New(fx.Engine, staticLister(nil), cfg)
	if err := r.reclaimTrash(ctx); err != nil {
		t.Fatalf("reclaim trash: %v", err)
	}
	if got := trashEntries(t, fx.Engine.Root()); len(got) != 0 {
		t.Fatalf("trash not purged: %v", got)
	}

	// The open fd still reads the full content after the unlink.
	content, err := io.ReadAll(f)
	if err != nil {
		t.Fatalf("read after purge: %v", err)
	}
	if string(content) != "hello inode" {
		t.Fatalf("read after purge = %q, want %q", content, "hello inode")
	}
}

// TestReclaimTrashHonorsMaxAge: only entries older than TrashMaxAge go; age
// comes from the name-embedded rename timestamp, NOT the dir mtime (rename
// preserves mtime, so a dormant subtree would otherwise purge instantly).
func TestReclaimTrashHonorsMaxAge(t *testing.T) {
	r, root := newSyntheticReaper(t, testCfg(), staticLister(nil))
	trash := gitfs.TrashDir(root)

	oldName := fmt.Sprintf("%016x-dead", uint64(time.Now().Add(-48*time.Hour).UnixNano()))
	freshName := fmt.Sprintf("%016x-beef", uint64(time.Now().UnixNano()))
	// A fresh trash entry whose CONTENT mtime is ancient — must be kept
	// (name timestamp wins over the preserved mtime).
	for _, n := range []string{oldName, freshName} {
		mkFile(t, filepath.Join(trash, n, "payload"), 8)
	}
	chtimes(t, filepath.Join(trash, freshName), time.Now().Add(-72*time.Hour))

	if err := r.reclaimTrash(context.Background()); err != nil {
		t.Fatalf("reclaim trash: %v", err)
	}
	mustNotExist(t, filepath.Join(trash, oldName))
	mustExist(t, filepath.Join(trash, freshName))
}

// TestTrashedAtFallsBackToMtime: a foreign (unparseable) entry name derives
// its age from mtime.
func TestTrashedAtFallsBackToMtime(t *testing.T) {
	r, root := newSyntheticReaper(t, testCfg(), staticLister(nil))
	trash := gitfs.TrashDir(root)
	mkFile(t, filepath.Join(trash, "debris", "payload"), 4)
	chtimes(t, filepath.Join(trash, "debris"), time.Now().Add(-48*time.Hour))

	if err := r.reclaimTrash(context.Background()); err != nil {
		t.Fatalf("reclaim trash: %v", err)
	}
	mustNotExist(t, filepath.Join(trash, "debris"))
}
