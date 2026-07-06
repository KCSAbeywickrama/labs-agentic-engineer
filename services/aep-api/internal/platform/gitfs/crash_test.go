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

// Crash-between-commit-tree-and-push idempotency (design §11 / §17.2), for
// BOTH write paths: the process dies after the local commit/tag object exists
// but before the push runs. Origin must be untouched, the mirror's refs must
// not claim un-pushed state (loose objects are merely GC-able debris), and a
// clean re-run must succeed. The "crash" is a ctx cancellation injected via
// the exec hook the moment the push is about to spawn — the push never
// executes, exactly the §17.2 window.

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/platform/gitfs"
	"github.com/wso2/aep/aep-api/internal/platform/gitfs/workspacetest"
)

func TestMutateCrashBetweenCommitTreeAndPush(t *testing.T) {
	fx := workspacetest.New(t, seedFiles())
	base := fx.Origin.HeadSHA(t)
	write := func(tx gitfs.Tx) error {
		tx.Write("specs/requirements/requirements.md", []byte("crashed write\n"))
		return nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	gitfs.SetExecHook(fx.Engine, func(args, env []string) {
		if subcommand(args) == "push" {
			cancel() // the "crash": commit-tree ran, the push never will
		}
	})
	if _, err := fx.Engine.Mutate(ctx, fx.Ref, write, gitfs.CommitOpts{Message: "crash", Retry: fastRetry}); err == nil {
		t.Fatal("Mutate survived a killed push, want error")
	}
	gitfs.SetExecHook(fx.Engine, nil)

	// Origin untouched.
	if head := fx.Origin.HeadSHA(t); head != base {
		t.Fatalf("origin tip moved to %s after a crashed push, want %s", head, base)
	}
	// The mirror's local ref never advanced (update-ref runs only AFTER the
	// push lands) — committed-local ≡ committed-remote at rest.
	mirror := mirrorGitDir(t, fx)
	if got := gitOut(t, mirror, "rev-parse", "refs/heads/main"); got != base {
		t.Fatalf("mirror ref = %s after a crashed push, want unmoved %s", got, base)
	}
	// The orphaned loose commit is unreachable (GC-able debris), and fsck
	// exits clean — no corruption.
	if out := gitOut(t, mirror, "fsck", "--unreachable"); !strings.Contains(out, "unreachable commit") {
		t.Errorf("expected an unreachable loose commit in the mirror, fsck says:\n%s", out)
	}

	// Re-run with a live ctx succeeds and lands the same content.
	res, err := fx.Engine.Mutate(context.Background(), fx.Ref, write, gitfs.CommitOpts{Message: "retry after crash", Retry: fastRetry})
	if err != nil {
		t.Fatalf("re-run Mutate: %v", err)
	}
	if !res.Changed {
		t.Fatalf("re-run result = %+v, want a real commit", res)
	}
	if head := fx.Origin.HeadSHA(t); head != res.CommitSHA {
		t.Fatalf("origin tip = %s, want re-run commit %s", head, res.CommitSHA)
	}
	if got := fx.Origin.FileAt(t, "main", "specs/requirements/requirements.md"); got != "crashed write\n" {
		t.Fatalf("origin content = %q after re-run", got)
	}
	gitOut(t, mirror, "fsck", "--strict", "--connectivity-only")
}

func TestTagCrashBetweenTagAndPushSelfHeals(t *testing.T) {
	fx := workspacetest.New(t, seedFiles())
	target := fx.Origin.HeadSHA(t)
	spec := gitfs.TagSpec{Name: "v1", Target: target, Message: "Requirements v1"}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	gitfs.SetExecHook(fx.Engine, func(args, env []string) {
		if subcommand(args) == "push" {
			cancel() // the "crash": the local tag object exists, the push never runs
		}
	})
	err := fx.Engine.Tag(ctx, fx.Ref, spec)
	if err == nil {
		t.Fatal("Tag survived a killed push, want error")
	}
	if errors.Is(err, gitfs.ErrTagAlreadyExists) {
		t.Fatalf("a crashed push must not masquerade as a collision: %v", err)
	}
	gitfs.SetExecHook(fx.Engine, nil)

	// Origin untouched — no partial tag state.
	if tags := fx.Origin.Tags(t); len(tags) != 0 {
		t.Fatalf("origin tags = %v after a crashed tag push, want none", tags)
	}

	// Re-run with a live ctx succeeds: the fetch (--prune, explicit tag
	// refspec) drops any lingering local tag the crashed rollback missed, so
	// the precheck passes and the tag lands on origin.
	if err := fx.Engine.Tag(context.Background(), fx.Ref, spec); err != nil {
		t.Fatalf("re-run Tag: %v", err)
	}
	origin := fx.Origin.Dir()
	if got := gitOut(t, origin, "rev-parse", "v1^{commit}"); got != target {
		t.Fatalf("origin v1 peels to %s, want %s", got, target)
	}
	mirror := mirrorGitDir(t, fx)
	if got := gitOut(t, mirror, "rev-parse", "v1^{commit}"); got != target {
		t.Fatalf("mirror v1 peels to %s, want %s", got, target)
	}
	gitOut(t, mirror, "fsck", "--strict", "--connectivity-only")
}
