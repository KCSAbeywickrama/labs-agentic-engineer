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
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/platform/gitfs"
	"github.com/wso2/aep/aep-api/internal/platform/gitfs/workspacetest"
)

func TestForceSweepPurgesTrashThenSweeps(t *testing.T) {
	r, root := newSyntheticReaper(t, testCfg(), staticLister(nil))
	r.diskUsage = fakeDisk(1000, 50) // 95% — records usage for admission

	trashID := filepath.Join(gitfs.TrashDir(root), "0000000000000001-deadbeef")
	if err := os.MkdirAll(trashID, 0o755); err != nil {
		t.Fatal(err)
	}
	mkFile(t, filepath.Join(trashID, "payload"), 100)

	// Fresh trash would survive reclaimTrash (age < TrashMaxAge); ForceSweep
	// must still purge it via purgeTrashAll.
	chtimes(t, trashID, time.Now())

	r.ForceSweep(context.Background())

	if _, err := os.Stat(trashID); !os.IsNotExist(err) {
		t.Fatalf("trash entry still present after ForceSweep (err=%v)", err)
	}
	if got := r.engine.DiskUsagePct(); got != 95 {
		t.Fatalf("DiskUsagePct = %d, want 95 after ForceSweep recorded usage", got)
	}
}

func TestEnforceQuotaRecordsDiskUsage(t *testing.T) {
	r, _ := newSyntheticReaper(t, testCfg(), staticLister(nil))
	r.diskUsage = fakeDisk(1000, 200) // 80%

	if err := r.enforceQuota(context.Background()); err != nil {
		t.Fatalf("enforceQuota: %v", err)
	}
	if got := r.engine.DiskUsagePct(); got != 80 {
		t.Fatalf("DiskUsagePct = %d, want 80", got)
	}
}

func TestAdmissionRecordsMaxOfByteAndInodePct(t *testing.T) {
	r, _ := newSyntheticReaper(t, testCfg(), staticLister(nil))
	// Bytes green (10% used), inodes at 95% → admission publishes 95.
	r.diskUsage = func(string) (uint64, uint64, uint64, uint64, error) {
		return 1000, 900, 1000, 50, nil
	}
	r.recordUsageFromStatfs()
	if got := r.engine.DiskUsagePct(); got != 95 {
		t.Fatalf("DiskUsagePct = %d, want 95 (inode pressure)", got)
	}
}

func TestEnsureRefusedWhenInodePressureAtAdmission(t *testing.T) {
	fx := workspacetest.New(t, map[string]string{"a.txt": "x"})
	r := New(fx.Engine, staticLister(nil), testCfg())
	// Bytes green (10%), inodes 92% ≥ DiskAdmissionRefusePct.
	r.diskUsage = func(string) (uint64, uint64, uint64, uint64, error) {
		return 1000, 900, 1000, 80, nil
	}
	r.recordUsageFromStatfs()
	if got := r.engine.DiskUsagePct(); got != 92 {
		t.Fatalf("DiskUsagePct = %d, want 92", got)
	}
	sha := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	err := fx.Engine.Ensure(context.Background(), fx.Ref, sha)
	if !errors.Is(err, gitfs.ErrDiskAdmission) {
		t.Fatalf("Ensure = %v, want ErrDiskAdmission under inode pressure", err)
	}
}
