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
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/platform/gitfs"
)

func TestNewPanicsOnInvalidWatermarks(t *testing.T) {
	eng, err := gitfs.New(filepath.Join(t.TempDir(), "workspaces"))
	if err != nil {
		t.Fatalf("gitfs.New: %v", err)
	}
	cfg := testCfg()
	cfg.DiskLowPct = 90
	cfg.DiskHighPct = 85 // low >= high after floors
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic for DiskLowPct >= DiskHighPct")
		}
	}()
	_ = New(eng, staticLister(nil), cfg)
}

func TestNewPanicsOnDiskHighOver100(t *testing.T) {
	eng, err := gitfs.New(filepath.Join(t.TempDir(), "workspaces"))
	if err != nil {
		t.Fatalf("gitfs.New: %v", err)
	}
	cfg := testCfg()
	cfg.DiskHighPct = 101
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic for DiskHighPct > 100")
		}
	}()
	_ = New(eng, staticLister(nil), cfg)
}

// TestLeaderFlockGatesGlobalPasses: while another holder owns
// <root>/.reaper.lock, a Sweep still runs the local passes (trash purge)
// but skips the global ones (orphan reconciliation); once released, the
// next Sweep completes them.
func TestLeaderFlockGatesGlobalPasses(t *testing.T) {
	r, root := newSyntheticReaper(t, testCfg(), staticLister(nil))
	r.diskUsage = fakeDisk(1000, 900) // watermark quiet

	orphan := mkSlugDir(t, root, "o9", "p9", "r9")
	chtimes(t, orphan, time.Now().Add(-10*time.Minute)) // past grace
	oldTrash := filepath.Join(gitfs.TrashDir(root),
		fmt.Sprintf("%016x-dead", uint64(time.Now().Add(-48*time.Hour).UnixNano())))
	mkFile(t, filepath.Join(oldTrash, "payload"), 4)

	// A competing replica holds the leader lock.
	lock, err := os.OpenFile(filepath.Join(root, leaderLockName), os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		t.Fatalf("open leader lock: %v", err)
	}
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		t.Fatalf("flock: %v", err)
	}

	r.Sweep(context.Background())
	mustNotExist(t, oldTrash) // local pass 1 ran on this replica
	mustExist(t, orphan)      // global pass 3 deferred to the leader

	_ = syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	_ = lock.Close()

	r.Sweep(context.Background())
	mustNotExist(t, orphan) // leadership acquired — orphan reconciled
}

// TestSweepPassIsolation: a failing pass (orphan reconciliation with a
// broken lister) must not stop the following pass (quota — observed via the
// statfs seam being consulted).
func TestSweepPassIsolation(t *testing.T) {
	r, _ := newSyntheticReaper(t, testCfg(), errLister{err: errors.New("db down")})
	statfsCalled := false
	r.diskUsage = func(string) (uint64, uint64, error) {
		statfsCalled = true
		return 1000, 900, nil
	}
	r.Sweep(context.Background())
	if !statfsCalled {
		t.Fatal("quota pass did not run after the orphan pass failed — passes must be isolated")
	}
}

// TestRunRespectsContextCancel: Run ticks on the interval and returns
// promptly on cancel.
func TestRunRespectsContextCancel(t *testing.T) {
	cfg := testCfg()
	cfg.ReapInterval = 10 * time.Millisecond
	r, root := newSyntheticReaper(t, cfg, staticLister(nil))
	r.diskUsage = fakeDisk(1000, 900)

	oldTrash := filepath.Join(gitfs.TrashDir(root),
		fmt.Sprintf("%016x-dead", uint64(time.Now().Add(-48*time.Hour).UnixNano())))
	mkFile(t, filepath.Join(oldTrash, "payload"), 4)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		r.Run(ctx)
		close(done)
	}()

	// The ticker fired at least once: the aged trash entry gets purged.
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(oldTrash); os.IsNotExist(err) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("Run never swept within 5s")
		}
		time.Sleep(5 * time.Millisecond)
	}

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after ctx cancel")
	}
}
