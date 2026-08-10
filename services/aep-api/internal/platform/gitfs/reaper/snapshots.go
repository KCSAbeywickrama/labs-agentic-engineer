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
	"bufio"
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/wso2/aep/aep-api/internal/platform/gitfs"
)

// reapSnapshots is pass 2: trash every snapshots/<sha> older than
// SnapshotMaxAge whose sha is not the mirror's current HEAD. Snapshots are
// immutable (design D12 — no leases, no heartbeats: age + not-current-HEAD
// is the whole liveness rule) and their mtime is their materialization time,
// so a plain mtime gate is sound. A missing/unreadable mirror leaves the
// snapshot orphaned → every snapshot is eligible. Rename-to-trash, not
// RemoveAll — the same two-phase delete as everything else.
func (r *Reaper) reapSnapshots(ctx context.Context) error {
	now := time.Now()
	return r.walkRepoDirs(ctx, func(_, _, _, slugDir string) {
		snapsDir := gitfs.SnapshotsSubdir(slugDir)
		snaps, err := os.ReadDir(snapsDir)
		if err != nil || len(snaps) == 0 {
			return // no snapshots (or raced with a trash rename) — nothing to reap
		}
		head := mirrorHead(gitfs.GitSubdir(slugDir))
		for _, s := range snaps {
			if ctx.Err() != nil {
				return
			}
			if !s.IsDir() || s.Name() == head {
				continue
			}
			info, err := s.Info()
			if err != nil {
				continue
			}
			if now.Sub(info.ModTime()) <= r.cfg.SnapshotMaxAge {
				continue
			}
			src := filepath.Join(snapsDir, s.Name())
			if err := os.Rename(src, r.trashDest()); err != nil && !os.IsNotExist(err) {
				slog.WarnContext(ctx, "reaper: trash aged snapshot failed", "path", src, "error", err)
			}
		}
	})
}

var sha40 = regexp.MustCompile(`^[0-9a-f]{40}$`)

// mirrorHead resolves the bare mirror's default-branch tip by reading the
// ref store directly — the cheapest correct read (no child process; the
// sweep visits every repo every tick). HEAD names the default branch
// (clone --mirror sets it to origin's); the branch resolves through a loose
// ref first (written by every fetch/push update) and falls back to
// packed-refs (where a fresh clone leaves all refs). Returns "" when the
// mirror is missing or the ref cannot be resolved — the caller then treats
// every snapshot as orphaned, which is exactly right.
func mirrorHead(gitDir string) string {
	data, err := os.ReadFile(filepath.Join(gitDir, "HEAD"))
	if err != nil {
		return ""
	}
	head := strings.TrimSpace(string(data))
	if sha40.MatchString(head) {
		return head // detached HEAD — already the tip sha
	}
	refName, ok := strings.CutPrefix(head, "ref: ")
	if !ok {
		return ""
	}
	refName = strings.TrimSpace(refName)
	// Loose ref wins over packed-refs (git's own precedence).
	if data, err := os.ReadFile(filepath.Join(gitDir, filepath.FromSlash(refName))); err == nil {
		if sha := strings.TrimSpace(string(data)); sha40.MatchString(sha) {
			return sha
		}
	}
	return packedRef(gitDir, refName)
}

// packedRef scans <gitDir>/packed-refs for refName. Lines are
// "<sha> <refname>"; "#" comment and "^" peel lines are skipped.
func packedRef(gitDir, refName string) string {
	f, err := os.Open(filepath.Join(gitDir, "packed-refs"))
	if err != nil {
		return ""
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" || line[0] == '#' || line[0] == '^' {
			continue
		}
		sha, name, ok := strings.Cut(line, " ")
		if ok && name == refName && sha40.MatchString(sha) {
			return sha
		}
	}
	// A line over the scanner's buffer ends the loop early, and "" is this
	// function's "no such ref" answer — so an unread remainder would read as a
	// definitive absence. Say which one it was.
	if err := scanner.Err(); err != nil {
		slog.Warn("reaper: packed-refs scan stopped early — ref treated as absent",
			"gitDir", gitDir, "ref", refName, "error", err)
	}
	return ""
}
