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
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/wso2/aep/aep-api/internal/platform/gitfs"
)

// reclaimTrash is pass 1 (phase 2 of the two-phase delete): os.RemoveAll
// every trash/<id> entry older than TrashMaxAge. Local and idempotent —
// every replica runs it, and a concurrent double-remove is harmless. By
// POSIX inode semantics a still-open fd keeps its content readable through
// the purge, so a mid-turn reader is never corrupted.
func (r *Reaper) reclaimTrash(ctx context.Context) error {
	trashDir := gitfs.TrashDir(r.engine.Root())
	entries, err := os.ReadDir(trashDir)
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
		if now.Sub(trashedAt(e)) <= r.cfg.TrashMaxAge {
			continue
		}
		path := filepath.Join(trashDir, e.Name())
		if err := os.RemoveAll(path); err != nil {
			slog.WarnContext(ctx, "reaper: purge trash entry failed", "path", path, "error", err)
		}
	}
	return nil
}

// trashedAt derives when an entry landed in trash/. Primary source is the
// id itself — the engine (and this package) mint trash ids as
// "%016x-<rand>" with the rename-time UnixNano, and os.Rename PRESERVES the
// renamed dir's own mtime (a dormant repo's subtree can carry an mtime far
// older than its trash time, which would defeat the TrashMaxAge grace).
// Unparseable names (foreign debris) fall back to the entry mtime.
func trashedAt(e os.DirEntry) time.Time {
	name := e.Name()
	if hexTS, _, ok := strings.Cut(name, "-"); ok && len(hexTS) == 16 {
		if nanos, err := strconv.ParseUint(hexTS, 16, 64); err == nil && nanos <= uint64(1)<<62 {
			return time.Unix(0, int64(nanos))
		}
	}
	if info, err := e.Info(); err == nil {
		return info.ModTime()
	}
	return time.Time{} // stat raced with removal — treat as ancient
}

// trashDest mints a unique trash/<id> destination for the reaper's own
// renames (snapshot reap + eviction), using the same sortable id scheme as
// the engine's TrashRepo/TrashOrg (timestamp-hex + random suffix) so
// reclaimTrash can read the trash time back out of the name.
func (r *Reaper) trashDest() string {
	var b [4]byte
	_, _ = rand.Read(b[:])
	id := fmt.Sprintf("%016x-%s", uint64(time.Now().UnixNano()), hex.EncodeToString(b[:]))
	return filepath.Join(gitfs.TrashDir(r.engine.Root()), id)
}
