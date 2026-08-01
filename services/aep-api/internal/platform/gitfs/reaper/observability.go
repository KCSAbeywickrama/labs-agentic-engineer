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
	"log/slog"
	"os"
	"path/filepath"

	"github.com/wso2/aep/aep-api/internal/platform/gitfs"
)

// rootHealthSentinel is written+removed every sweep to prove the mount is
// writable. Lives at the workspace root (not under repos/tmp/trash) so a
// missing layout directory is diagnosed separately.
const rootHealthSentinel = ".root-health-probe"

// checkRootHealth asserts the workspace root exists, is a directory, is
// writable (sentinel write+remove), and that repos/, tmp/, trash/ are present
// directories. Returns a specific error naming the failed condition (R8b).
func (r *Reaper) checkRootHealth() error {
	root := r.engine.Root()
	st, err := os.Stat(root)
	if err != nil {
		return fmt.Errorf("root missing: %w", err)
	}
	if !st.IsDir() {
		return fmt.Errorf("root is not a directory")
	}
	sentinel := filepath.Join(root, rootHealthSentinel)
	if err := os.WriteFile(sentinel, []byte("ok"), 0o644); err != nil {
		return fmt.Errorf("root not writable: %w", err)
	}
	if err := os.Remove(sentinel); err != nil {
		return fmt.Errorf("root sentinel remove failed: %w", err)
	}
	for _, name := range []string{"repos", "tmp", "trash"} {
		p := filepath.Join(root, name)
		st, err := os.Stat(p)
		if err != nil {
			return fmt.Errorf("%s/ missing: %w", name, err)
		}
		if !st.IsDir() {
			return fmt.Errorf("%s/ is not a directory", name)
		}
	}
	return nil
}

// applyRootHealth runs checkRootHealth, logs ERROR on failure, and updates
// the readiness gate (fail → NotReady; success → Ready again).
func (r *Reaper) applyRootHealth(ctx context.Context) {
	if err := r.checkRootHealth(); err != nil {
		slog.ErrorContext(ctx, "reaper: root health failed", "error", err, "root", r.engine.Root())
		r.ready.Set(false)
		return
	}
	r.ready.Set(true)
}

// logSweepUsage emits the per-sweep usage INFO line (R8b trend data).
func (r *Reaper) logSweepUsage(ctx context.Context, leaderHeld bool, maintained, evictions int) {
	root := r.engine.Root()
	total, avail, inodesTotal, inodesFree, err := r.diskUsage(root)
	var usedBytes, usedInodes uint64
	if err == nil && total > 0 {
		usedBytes = total - avail
		if inodesTotal >= inodesFree {
			usedInodes = inodesTotal - inodesFree
		}
		r.recordDiskUsage(total, avail, inodesTotal, inodesFree)
	} else {
		total, inodesTotal = 0, 0
	}
	trashBytes := duDir(gitfs.TrashDir(root))
	tmpBytes := duDir(gitfs.TmpDir(root))
	slog.InfoContext(ctx, "reaper: sweep usage",
		"usedBytes", usedBytes,
		"totalBytes", total,
		"usedInodes", usedInodes,
		"totalInodes", inodesTotal,
		"trashBytes", trashBytes,
		"tmpBytes", tmpBytes,
		"evictions", evictions,
		"reposMaintained", maintained,
		"leaderHeld", leaderHeld,
	)
}
