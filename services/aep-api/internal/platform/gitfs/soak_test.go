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
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/platform/gitfs"
	"github.com/wso2/aep/aep-api/internal/platform/gitfs/workspacetest"
)

// TestCorruptionSoak hammers ONE shared mirror from two Engine instances on
// the same root (simulating two writer processes) — 4 workers × 15 Mutates
// each, mixed with concurrent readers — then checks the object DB with
// `git fsck --strict` and asserts history stayed linear with zero lost
// commits (the CAS counter serialized perfectly).
func TestCorruptionSoak(t *testing.T) {
	const workers = 4
	mutatesPerWorker := 15
	if testing.Short() {
		mutatesPerWorker = 5 // the fast `make test` lane still soaks, smaller
	}
	total := workers * mutatesPerWorker

	fx := workspacetest.New(t, map[string]string{"count.txt": "0\n"})
	seedSHA := fx.Origin.HeadSHA(t)
	engine2, _, err := gitfs.New(fx.Engine.Root())
	if err != nil {
		t.Fatalf("second engine on shared root: %v", err)
	}
	engines := []*gitfs.Engine{fx.Engine, engine2, fx.Engine, engine2}
	ctx := context.Background()
	soakRetry := gitfs.RetryPolicy{Attempts: 60, Backoff: []time.Duration{2 * time.Millisecond, 5 * time.Millisecond}}

	done := make(chan struct{})
	var readers sync.WaitGroup
	for r := 0; r < 2; r++ {
		readers.Add(1)
		go func() {
			defer readers.Done()
			for {
				select {
				case <-done:
					return
				case <-time.After(25 * time.Millisecond):
					// Paced: flock has no fairness, so back-to-back SHARED
					// holders would starve the writers' EXCLUSIVE sections.
				}
				// Raw-sha reads are pure SHARED-flock object reads racing the
				// writers' EXCLUSIVE fetch/push sections — they must never
				// error while the object DB is being hammered.
				if _, _, err := fx.Engine.ReadFile(ctx, fx.Ref, seedSHA, "count.txt"); err != nil {
					t.Errorf("concurrent read failed: %v", err)
					return
				}
			}
		}()
	}

	var writers sync.WaitGroup
	errCh := make(chan error, total)
	for w := 0; w < workers; w++ {
		writers.Add(1)
		go func(w int) {
			defer writers.Done()
			e := engines[w]
			for i := 0; i < mutatesPerWorker; i++ {
				_, err := e.Mutate(ctx, fx.Ref, func(tx gitfs.Tx) error {
					raw, _, rerr := tx.Base().Read("count.txt")
					if rerr != nil {
						return rerr
					}
					n, perr := strconv.Atoi(strings.TrimSpace(string(raw)))
					if perr != nil {
						return perr
					}
					tx.Write("count.txt", []byte(strconv.Itoa(n+1)+"\n"))
					tx.Write(fmt.Sprintf("w%d/step-%d.md", w, i), []byte("done\n"))
					return nil
				}, gitfs.CommitOpts{Message: fmt.Sprintf("soak w%d #%d", w, i), Retry: soakRetry})
				if err != nil {
					errCh <- fmt.Errorf("worker %d mutate %d: %w", w, i, err)
					return
				}
			}
		}(w)
	}
	writers.Wait()
	close(done)
	readers.Wait()
	close(errCh)
	for err := range errCh {
		t.Fatal(err)
	}

	// Every mutate landed exactly once — the counter proves a serialized order.
	count, _, err := fx.Engine.ReadFile(ctx, fx.Ref, "", "count.txt")
	if err != nil || strings.TrimSpace(string(count)) != strconv.Itoa(total) {
		t.Fatalf("count.txt = (%q, %v), want %d", count, err, total)
	}
	// Origin history is linear: seed + one commit per successful mutate, no merges.
	if got := gitOut(t, fx.Origin.Dir(), "rev-list", "--count", "refs/heads/main"); got != strconv.Itoa(total+1) {
		t.Fatalf("origin commit count = %s, want %d", got, total+1)
	}
	if got := gitOut(t, fx.Origin.Dir(), "rev-list", "--min-parents=2", "--count", "refs/heads/main"); got != "0" {
		t.Fatalf("origin has %s merge commits, want linear history", got)
	}
	// The shared mirror's object DB survived the hammering intact.
	gitOut(t, mirrorGitDir(t, fx), "fsck", "--strict")
}

// TestCrashMidCloneNeverHalfPopulatesCanonicalPath kills the clone mid-op
// (ctx cancel through the exec hook) and asserts the canonical mirror path
// was never created — only tmp/ staging is ever touched — and that the next
// operation self-heals by re-cloning.
func TestCrashMidCloneNeverHalfPopulatesCanonicalPath(t *testing.T) {
	fx := workspacetest.New(t, seedFiles())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	gitfs.SetExecHook(fx.Engine, func(args, env []string) {
		if subcommand(args) == "clone" {
			cancel() // the "crash": the clone child is killed mid-flight
		}
	})
	if _, err := fx.Engine.Head(ctx, fx.Ref, ""); err == nil {
		t.Fatal("Head survived a killed clone, want error")
	}
	gitfs.SetExecHook(fx.Engine, nil)

	if _, err := os.Stat(mirrorGitDir(t, fx)); !os.IsNotExist(err) {
		t.Fatalf("canonical mirror path exists after crashed clone (err=%v) — must only ever hold a complete mirror", err)
	}

	// Self-heal: the next call re-clones and serves reads.
	sha := mustHead(t, fx, "")
	if sha != fx.Origin.HeadSHA(t) {
		t.Fatalf("post-heal Head = %s, want origin tip", sha)
	}
}

// TestTrashRepoThenRecloneCleanly: TrashRepo is the O(1) two-phase-delete
// front — the canonical path frees instantly and the next op re-clones.
func TestTrashRepoThenRecloneCleanly(t *testing.T) {
	fx := workspacetest.New(t, seedFiles())
	ctx := context.Background()
	sha := mustHead(t, fx, "")
	if err := fx.Engine.Ensure(ctx, fx.Ref, sha); err != nil {
		t.Fatalf("Ensure: %v", err)
	}

	if err := fx.Engine.TrashRepo(ctx, fx.Ref); err != nil {
		t.Fatalf("TrashRepo: %v", err)
	}
	repoDir, err := gitfs.RepoDir(fx.Engine.Root(), fx.Ref)
	if err != nil {
		t.Fatalf("RepoDir: %v", err)
	}
	if _, err := os.Stat(repoDir); !os.IsNotExist(err) {
		t.Fatalf("repo dir still at canonical path after trash (err=%v)", err)
	}
	entries, err := os.ReadDir(gitfs.TrashDir(fx.Engine.Root()))
	if err != nil || len(entries) != 1 {
		t.Fatalf("trash entries = (%v, %v), want exactly one renamed subtree", entries, err)
	}
	// The whole subtree moved intact — mirror + snapshot live in trash.
	trashed := filepath.Join(gitfs.TrashDir(fx.Engine.Root()), entries[0].Name())
	if _, err := os.Stat(filepath.Join(trashed, "git", "HEAD")); err != nil {
		t.Fatalf("trashed mirror incomplete: %v", err)
	}
	if _, err := os.Stat(filepath.Join(trashed, "snapshots", sha, "README.md")); err != nil {
		t.Fatalf("trashed snapshot incomplete: %v", err)
	}

	// Idempotent on a missing subtree.
	if err := fx.Engine.TrashRepo(ctx, fx.Ref); err != nil {
		t.Fatalf("TrashRepo(missing): %v", err)
	}
	// Ops on the trashed repo re-clone cleanly.
	content, _, err := fx.Engine.ReadFile(ctx, fx.Ref, "", "README.md")
	if err != nil || string(content) != "hello\n" {
		t.Fatalf("post-trash read = (%q, %v), want a clean re-clone", content, err)
	}
}

func TestTrashOrgMovesWholeOrgSubtree(t *testing.T) {
	fx := workspacetest.New(t, seedFiles())
	ctx := context.Background()
	mustHead(t, fx, "")

	// A second repo of the same org (the _skills layout goes through the
	// same deriver).
	skillsRef := workspacetest.RefFor(fx.Origin, workspacetest.DefaultOrg, "_skills", "org-skills")
	if _, err := fx.Engine.Head(ctx, skillsRef, ""); err != nil {
		t.Fatalf("Head(skills): %v", err)
	}

	if err := fx.Engine.TrashOrg(ctx, workspacetest.DefaultOrg); err != nil {
		t.Fatalf("TrashOrg: %v", err)
	}
	orgDir, err := gitfs.OrgDir(fx.Engine.Root(), workspacetest.DefaultOrg)
	if err != nil {
		t.Fatalf("OrgDir: %v", err)
	}
	if _, err := os.Stat(orgDir); !os.IsNotExist(err) {
		t.Fatalf("org dir still present after TrashOrg (err=%v)", err)
	}
	entries, err := os.ReadDir(gitfs.TrashDir(fx.Engine.Root()))
	if err != nil || len(entries) != 1 {
		t.Fatalf("trash entries = (%v, %v), want the one org subtree", entries, err)
	}
	// Both repos of the org travelled together.
	trashed := filepath.Join(gitfs.TrashDir(fx.Engine.Root()), entries[0].Name())
	for _, rel := range []string{
		filepath.Join(workspacetest.DefaultProject, workspacetest.DefaultSlug, "git", "HEAD"),
		filepath.Join("_skills", "org-skills", "git", "HEAD"),
	} {
		if _, err := os.Stat(filepath.Join(trashed, rel)); err != nil {
			t.Fatalf("trashed org subtree missing %s: %v", rel, err)
		}
	}
	// Idempotent on a missing org.
	if err := fx.Engine.TrashOrg(ctx, workspacetest.DefaultOrg); err != nil {
		t.Fatalf("TrashOrg(missing): %v", err)
	}
}
