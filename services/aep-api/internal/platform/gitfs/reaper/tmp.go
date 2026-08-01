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
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/wso2/aep/aep-api/internal/platform/gitfs"
)

// askpassFileName must stay in sync with gitfs's askpass shim basename.
const askpassFileName = "askpass.sh"

// reclaimTmp purges <root>/tmp entries older than TrashMaxAge (binding: 1h),
// skipping askpass.sh. SIGKILL/OOM mid-clone leaves complete bare trees here;
// nothing else reclaims them.
func (r *Reaper) reclaimTmp(ctx context.Context) error {
	tmpDir := gitfs.TmpDir(r.engine.Root())
	entries, err := os.ReadDir(tmpDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	now := time.Now()
	for _, e := range entries {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if e.Name() == askpassFileName {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if now.Sub(info.ModTime()) <= r.cfg.TrashMaxAge {
			continue
		}
		path := filepath.Join(tmpDir, e.Name())
		if err := os.RemoveAll(path); err != nil {
			slog.WarnContext(ctx, "reaper: purge tmp entry failed", "path", path, "error", err)
		}
	}
	return nil
}
