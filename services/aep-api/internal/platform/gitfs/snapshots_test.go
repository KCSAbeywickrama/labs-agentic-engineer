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

package gitfs_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/wso2/aep/aep-api/internal/platform/gitfs"
	"github.com/wso2/aep/aep-api/internal/platform/gitfs/workspacetest"
)

func snapshotDir(t *testing.T, fx *workspacetest.Fixture, sha string) string {
	t.Helper()
	d, err := gitfs.SnapshotDir(fx.Engine.Root(), fx.Ref, sha)
	if err != nil {
		t.Fatalf("SnapshotDir: %v", err)
	}
	return d
}

func assertSnapshotContent(t *testing.T, dir string) {
	t.Helper()
	readme, err := os.ReadFile(filepath.Join(dir, "README.md"))
	if err != nil || string(readme) != "hello\n" {
		t.Fatalf("snapshot README.md = (%q, %v)", readme, err)
	}
	req, err := os.ReadFile(filepath.Join(dir, "specs", "requirements", "requirements.md"))
	if err != nil || string(req) != "req v1\n" {
		t.Fatalf("snapshot requirements.md = (%q, %v)", req, err)
	}
}

func TestEnsureMaterializesImmutableTree(t *testing.T) {
	fx := workspacetest.New(t, seedFiles())
	ctx := context.Background()
	sha := mustHead(t, fx, "")

	if err := fx.Engine.Ensure(ctx, fx.Ref, sha); err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	assertSnapshotContent(t, snapshotDir(t, fx, sha))

	// Idempotent: a second call short-circuits without running git at all.
	rec := recordCommands(t, fx.Engine)
	if err := fx.Engine.Ensure(ctx, fx.Ref, sha); err != nil {
		t.Fatalf("Ensure(again): %v", err)
	}
	if n := len(rec.all()); n != 0 {
		t.Fatalf("idempotent Ensure ran %d git commands, want 0", n)
	}

	// tmp/ staging left no debris behind.
	entries, err := os.ReadDir(gitfs.TmpDir(fx.Engine.Root()))
	if err != nil {
		t.Fatalf("read tmp: %v", err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "snapshot-") {
			t.Fatalf("staging debris left in tmp/: %s", e.Name())
		}
	}
}

func TestEnsureFetchesUnseenShaAndRejectsUnknown(t *testing.T) {
	fx := workspacetest.New(t, seedFiles())
	ctx := context.Background()
	mustHead(t, fx, "") // prime the mirror
	sha2 := fx.Origin.Seed(t, map[string]string{"new.md": "new\n"}, "second")

	// A sha the mirror has not seen yet → fetch, then materialize.
	if err := fx.Engine.Ensure(ctx, fx.Ref, sha2); err != nil {
		t.Fatalf("Ensure(unseen sha): %v", err)
	}
	content, err := os.ReadFile(filepath.Join(snapshotDir(t, fx, sha2), "new.md"))
	if err != nil || string(content) != "new\n" {
		t.Fatalf("snapshot new.md = (%q, %v)", content, err)
	}

	// A sha that exists nowhere → ErrRefNotFound, nothing published.
	missing := strings.Repeat("deadbeef", 5)
	if err := fx.Engine.Ensure(ctx, fx.Ref, missing); !errors.Is(err, gitfs.ErrRefNotFound) {
		t.Fatalf("Ensure(unknown sha) err = %v, want ErrRefNotFound", err)
	}
	if _, err := os.Stat(snapshotDir(t, fx, missing)); !os.IsNotExist(err) {
		t.Fatalf("unknown-sha snapshot dir published (err=%v)", err)
	}

	// Malformed sha (not 40-hex) is rejected before touching disk.
	if err := fx.Engine.Ensure(ctx, fx.Ref, "main"); err == nil {
		t.Fatal("Ensure(symbolic ref) succeeded, want validation error")
	}
}

// TestEnsureSnapshotIsCrossUIDReadable asserts the published snapshot tree is
// readable by a different UID (the agents pod over the RO mount): the root dir
// is 0755 (MkdirTemp makes it 0700), subdirs are group+other r-x, and files
// are group+other readable — so cross-service reads never depend on an
// identical UID.
func TestEnsureSnapshotIsCrossUIDReadable(t *testing.T) {
	fx := workspacetest.New(t, seedFiles())
	ctx := context.Background()
	sha := mustHead(t, fx, "")
	if err := fx.Engine.Ensure(ctx, fx.Ref, sha); err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	dir := snapshotDir(t, fx, sha)

	rootInfo, err := os.Stat(dir)
	if err != nil {
		t.Fatalf("stat snapshot root: %v", err)
	}
	if perm := rootInfo.Mode().Perm(); perm != 0o755 {
		t.Fatalf("snapshot root perm = %04o, want 0755", perm)
	}
	subInfo, err := os.Stat(filepath.Join(dir, "specs"))
	if err != nil {
		t.Fatalf("stat snapshot subdir: %v", err)
	}
	if perm := subInfo.Mode().Perm(); perm&0o055 != 0o055 {
		t.Fatalf("snapshot subdir perm = %04o, want group+other r-x", perm)
	}
	fileInfo, err := os.Stat(filepath.Join(dir, "README.md"))
	if err != nil {
		t.Fatalf("stat snapshot file: %v", err)
	}
	if perm := fileInfo.Mode().Perm(); perm&0o044 != 0o044 {
		t.Fatalf("snapshot file perm = %04o, want group+other readable", perm)
	}
}

func TestEnsureConcurrentDoubleInvocationNeverTearsDir(t *testing.T) {
	fx := workspacetest.New(t, seedFiles())
	ctx := context.Background()
	sha := mustHead(t, fx, "")

	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs[i] = fx.Engine.Ensure(ctx, fx.Ref, sha)
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("concurrent Ensure #%d: %v", i, err)
		}
	}
	// Both succeeded; the canonical dir holds the full tree and snapshots/
	// contains exactly the one sha (no torn or duplicate staging dirs).
	assertSnapshotContent(t, snapshotDir(t, fx, sha))
	snaps, err := gitfs.SnapshotsDir(fx.Engine.Root(), fx.Ref)
	if err != nil {
		t.Fatalf("SnapshotsDir: %v", err)
	}
	entries, err := os.ReadDir(snaps)
	if err != nil {
		t.Fatalf("read snapshots dir: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != sha {
		names := make([]string, 0, len(entries))
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Fatalf("snapshots dir = %v, want exactly [%s]", names, sha)
	}
}
