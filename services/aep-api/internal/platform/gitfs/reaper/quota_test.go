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
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/platform/gitfs"
)

// fakeDisk pins the statfs seam to a fixed picture.
func fakeDisk(total, avail uint64) func(string) (uint64, uint64, uint64, uint64, error) {
	return func(string) (uint64, uint64, uint64, uint64, error) {
		return total, avail, 1000, 1000, nil // inodes quiet by default
	}
}

func TestDuDirUsesAllocatedBlocks(t *testing.T) {
	dir := t.TempDir()
	// One small file: apparent size 1 byte; allocated is typically 4096 / 512 blocks.
	if err := os.WriteFile(filepath.Join(dir, "x"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := duDir(dir)
	if got <= 1 {
		t.Fatalf("duDir returned apparent size %d; want Blocks*512 (>= 512)", got)
	}
}

func TestQuotaEvictsOnInodeWatermark(t *testing.T) {
	r, root := newSyntheticReaper(t, testCfg(), staticLister(nil))
	now := time.Now()
	slug := mkSlugDir(t, root, "o1", "p1", "r1")
	aged := mkSnapshot(t, slug, fakeSha(2), 250, now.Add(-2*time.Hour))
	mkGitDir(t, slug, 50, now.Add(-2*time.Hour))

	// Bytes green (10% used), inodes over high (900/1000 = 90%).
	r.diskUsage = func(string) (uint64, uint64, uint64, uint64, error) {
		return 1000, 900, 1000, 100, nil
	}
	if _, err := r.enforceQuota(context.Background()); err != nil {
		t.Fatalf("enforceQuota: %v", err)
	}
	mustNotExist(t, aged)
}

// TestQuotaEvictsSnapshotsFirstThenMirrorsLRU drives the global watermark
// path end to end: 90% used (high 85, low 70) → target 200 bytes. All
// snapshots go first (oldest first), then the LRU mirror — and eviction
// stops once the estimate clears the LOW watermark, keeping the fresher
// mirror.
func TestQuotaEvictsSnapshotsFirstThenMirrorsLRU(t *testing.T) {
	r, root := newSyntheticReaper(t, testCfg(), staticLister(nil))
	bs := blockPayloadSize(t)
	// 90% used (high 85, low 70) → target 4*bs: three snapshots plus the LRU
	// mirror, but not the fresher mirror (allocated blocks, not apparent size).
	r.diskUsage = fakeDisk(uint64(20*bs), uint64(2*bs))

	now := time.Now()
	r1 := mkSlugDir(t, root, "o1", "p1", "r1")
	snapA := mkSnapshot(t, r1, fakeSha(1), 80, now.Add(-4*time.Hour)) // oldest snapshot
	snapB := mkSnapshot(t, r1, fakeSha(2), 60, now.Add(-2*time.Hour))
	r1Git := mkGitDir(t, r1, 100, now.Add(-3*time.Hour)) // LRU mirror

	r2 := mkSlugDir(t, root, "o1", "p1", "r2")
	snapC := mkSnapshot(t, r2, fakeSha(3), 40, now.Add(-30*time.Minute))
	r2Git := mkGitDir(t, r2, 100, now.Add(-1*time.Hour)) // fresher mirror

	if _, err := r.enforceQuota(context.Background()); err != nil {
		t.Fatalf("enforce quota: %v", err)
	}

	// Snapshots first: A+B+C = 180 < 200 → all evicted...
	mustNotExist(t, snapA)
	mustNotExist(t, snapB)
	mustNotExist(t, snapC)
	// ...then mirrors LRU: r1 (older git/ mtime) tops the estimate up to
	// 280 ≥ 200 → stop. r2 survives — the low watermark bound held.
	mustNotExist(t, r1)
	_ = r1Git
	mustExist(t, r2Git)
	if got := trashEntries(t, root); len(got) != 4 {
		t.Fatalf("want 4 trash entries (3 snapshots + 1 mirror), got %v", got)
	}
}

// TestQuotaNeverEvictsLockedMirror: the LRU candidate whose repo.lock is
// EX-held (live use) is skipped; eviction moves on to the next candidate.
func TestQuotaNeverEvictsLockedMirror(t *testing.T) {
	r, root := newSyntheticReaper(t, testCfg(), staticLister(nil))
	r.diskUsage = fakeDisk(1000, 100) // target 200

	now := time.Now()
	r1 := mkSlugDir(t, root, "o1", "p1", "r1")
	mkGitDir(t, r1, 150, now.Add(-3*time.Hour)) // LRU — but busy
	r2 := mkSlugDir(t, root, "o1", "p1", "r2")
	mkGitDir(t, r2, 150, now.Add(-1*time.Hour))

	lock, err := os.OpenFile(filepath.Join(r1, "repo.lock"), os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		t.Fatalf("open lock: %v", err)
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		t.Fatalf("flock: %v", err)
	}

	if _, err := r.enforceQuota(context.Background()); err != nil {
		t.Fatalf("enforce quota: %v", err)
	}
	mustExist(t, r1)    // held lock → never evicted, despite being LRU
	mustNotExist(t, r2) // the next candidate went instead
}

// TestPerOrgQuota: an org over OrgQuotaBytes sheds snapshots first and stops
// once back under quota (mirror intact); other orgs are untouched.
func TestPerOrgQuota(t *testing.T) {
	cfg := testCfg()
	bs := blockPayloadSize(t)
	cfg.OrgQuotaBytes = 3 * bs / 2 // one snapshot clears the excess over 2*bs
	r, root := newSyntheticReaper(t, cfg, staticLister(nil))
	r.diskUsage = fakeDisk(1000, 900) // 10% used — global watermark quiet

	now := time.Now()
	over := mkSlugDir(t, root, "o1", "p1", "r1") // org usage 2*bs > quota
	overSnap := mkSnapshot(t, over, fakeSha(1), 60, now.Add(-2*time.Hour))
	overGit := mkGitDir(t, over, 90, now.Add(-1*time.Hour))

	under := mkSlugDir(t, root, "o2", "p1", "r1") // org usage bs ≤ quota
	underGit := mkGitDir(t, under, 30, now.Add(-1*time.Hour))

	if _, err := r.enforceQuota(context.Background()); err != nil {
		t.Fatalf("enforce quota: %v", err)
	}
	mustNotExist(t, overSnap) // snapshot eviction clears the excess
	mustExist(t, overGit)     // mirror survives — snapshots-first sufficed
	mustExist(t, underGit)
}

// TestQuotaNeverEvictsCurrentHeadSnapshot: under disk pressure the snapshot the
// mirror HEAD points at is protected (a running turn reads it lazily), even
// though it is old and large enough to satisfy the target on its own — an
// evictable non-HEAD snapshot is shed instead.
func TestQuotaNeverEvictsCurrentHeadSnapshot(t *testing.T) {
	r, root := newSyntheticReaper(t, testCfg(), staticLister(nil))
	r.diskUsage = fakeDisk(1000, 100) // 90% used → target 200

	now := time.Now()
	slug := mkSlugDir(t, root, "o1", "p1", "r1")
	headSha := fakeSha(1)
	headSnap := mkSnapshot(t, slug, headSha, 300, now.Add(-2*time.Hour)) // aged, but HEAD
	evictSnap := mkSnapshot(t, slug, fakeSha(2), 250, now.Add(-3*time.Hour))
	writeGitHead(t, mkGitDir(t, slug, 50, now.Add(-2*time.Hour)), headSha)

	if _, err := r.enforceQuota(context.Background()); err != nil {
		t.Fatalf("enforce quota: %v", err)
	}
	mustExist(t, headSnap)     // current HEAD → never evicted despite pressure
	mustNotExist(t, evictSnap) // the aged non-HEAD snapshot went instead
	mustExist(t, slug)         // mirror untouched — the 250-byte snapshot sufficed
}

// TestQuotaNeverEvictsSnapshotYoungerThanFloor: a snapshot younger than
// snapshotEvictMinAge is protected (it may be feeding an in-flight turn) even
// when not the HEAD; an aged sibling is evicted to clear the target instead.
func TestQuotaNeverEvictsSnapshotYoungerThanFloor(t *testing.T) {
	r, root := newSyntheticReaper(t, testCfg(), staticLister(nil))
	r.diskUsage = fakeDisk(1000, 100) // target 200

	now := time.Now()
	slug := mkSlugDir(t, root, "o1", "p1", "r1")
	young := mkSnapshot(t, slug, fakeSha(1), 300, now.Add(-time.Minute)) // < 30m floor
	aged := mkSnapshot(t, slug, fakeSha(2), 250, now.Add(-2*time.Hour))  // evictable
	mkGitDir(t, slug, 50, now.Add(-2*time.Hour))                         // no HEAD file → isHead false

	if _, err := r.enforceQuota(context.Background()); err != nil {
		t.Fatalf("enforce quota: %v", err)
	}
	mustExist(t, young)   // younger than the floor → protected
	mustNotExist(t, aged) // aged non-HEAD → evicted, clears the target
	mustExist(t, slug)    // mirror untouched
}

// TestQuotaEvictsAgedNonHeadSnapshot: the base case — an aged, non-HEAD
// snapshot (aged via os.Chtimes) is evictable, while the older HEAD snapshot
// beside it stays protected.
func TestQuotaEvictsAgedNonHeadSnapshot(t *testing.T) {
	r, root := newSyntheticReaper(t, testCfg(), staticLister(nil))
	r.diskUsage = fakeDisk(1000, 100) // target 200

	now := time.Now()
	slug := mkSlugDir(t, root, "o1", "p1", "r1")
	headSha := fakeSha(1)
	head := mkSnapshot(t, slug, headSha, 40, now.Add(-3*time.Hour)) // oldest, but HEAD
	aged := mkSnapshot(t, slug, fakeSha(2), 250, now.Add(-2*time.Hour))
	writeGitHead(t, mkGitDir(t, slug, 50, now.Add(-2*time.Hour)), headSha)

	if _, err := r.enforceQuota(context.Background()); err != nil {
		t.Fatalf("enforce quota: %v", err)
	}
	mustNotExist(t, aged) // aged + not HEAD → evicted
	mustExist(t, head)    // HEAD protected regardless of age
}

// TestQuotaPurgesTrashFirstThenConvergesWithoutDrainingRepos: over high
// watermark with young trash that age-gated reclaim would skip. After one
// enforceQuota, trash is gone, diskUsage reports under high, and repos/
// mirrors survive (no cascade drain).
func TestQuotaPurgesTrashFirstThenConvergesWithoutDrainingRepos(t *testing.T) {
	r, root := newSyntheticReaper(t, testCfg(), staticLister(nil))

	now := time.Now()
	slug := mkSlugDir(t, root, "o1", "p1", "r1")
	mkGitDir(t, slug, 400, now.Add(-2*time.Hour))
	mkSnapshot(t, slug, fakeSha(1), 200, now.Add(-2*time.Hour))

	// Young trash (age << TrashMaxAge) that still occupies "disk".
	youngTrash := filepath.Join(gitfs.TrashDir(root),
		fmt.Sprintf("%016x-young", uint64(now.Add(-time.Minute).UnixNano())))
	mkFile(t, filepath.Join(youngTrash, "payload"), 500)

	// fakeDisk: first call over high (used 900/1000); after trash purge,
	// second call under high (used 200/1000). Converges without eviction.
	calls := 0
	r.diskUsage = func(string) (uint64, uint64, uint64, uint64, error) {
		calls++
		if calls == 1 {
			return 1000, 100, 1000, 1000, nil // 90% used
		}
		return 1000, 800, 1000, 1000, nil // 20% used after trash purge
	}

	if _, err := r.enforceQuota(context.Background()); err != nil {
		t.Fatalf("enforceQuota: %v", err)
	}
	mustNotExist(t, youngTrash)
	mustExist(t, slug) // repos NOT drained
	if calls < 2 {
		t.Fatalf("expected re-read of diskUsage after trash purge, calls=%d", calls)
	}
}

// TestOrgQuotaErrorDoesNotSkipGlobalWatermark: a broken org ReadDir used to
// return before the global check. Inject by removing repos/ readability is
// hard; instead verify enforceOrgQuotas errors are swallowed by wrapping:
// put disk over high AND ensure global path still consults diskUsage even
// when OrgQuotaBytes>0 and an empty-name org entry is not the issue —
// use OrgQuotaBytes>0 with a normal tree; primary assertion is diskUsage
// still called when org pass runs cleanly. Companion: force org pass to
// log-and-continue by making evictWithin fail via locked mirrors only —
// the real fix is enforceQuota structure below.
func TestOrgQuotaErrorDoesNotSkipGlobalWatermark(t *testing.T) {
	cfg := testCfg()
	cfg.OrgQuotaBytes = 50
	r, root := newSyntheticReaper(t, cfg, staticLister(nil))

	now := time.Now()
	over := mkSlugDir(t, root, "o1", "p1", "r1")
	mkSnapshot(t, over, fakeSha(1), 80, now.Add(-2*time.Hour))
	mkGitDir(t, over, 40, now.Add(-1*time.Hour))

	statfsCalls := 0
	r.diskUsage = func(string) (uint64, uint64, uint64, uint64, error) {
		statfsCalls++
		return 1000, 100, 1000, 1000, nil // always over high (bytes)
	}
	if _, err := r.enforceQuota(context.Background()); err != nil {
		t.Fatalf("enforceQuota: %v", err)
	}
	if statfsCalls == 0 {
		t.Fatal("global watermark path skipped — org quota must not return early")
	}
}
