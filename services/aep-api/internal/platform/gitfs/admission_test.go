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
	"fmt"
	"os/exec"
	"syscall"
	"testing"

	"github.com/wso2/aep/aep-api/internal/platform/gitfs"
	"github.com/wso2/aep/aep-api/internal/platform/gitfs/workspacetest"
)

func TestEnsureRefusedAtAdmissionThreshold(t *testing.T) {
	fx := workspacetest.New(t, seedFiles())
	fx.Engine.SetDiskUsagePct(90)
	sha := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	err := fx.Engine.Ensure(context.Background(), fx.Ref, sha)
	if !errors.Is(err, gitfs.ErrDiskAdmission) {
		t.Fatalf("got %v, want ErrDiskAdmission", err)
	}
}

func TestEnsureAllowsReadPathWhenSnapshotExistsAboveThreshold(t *testing.T) {
	fx := workspacetest.New(t, seedFiles())
	ctx := context.Background()
	sha := mustHead(t, fx, "")

	if err := fx.Engine.Ensure(ctx, fx.Ref, sha); err != nil {
		t.Fatalf("Ensure under threshold: %v", err)
	}

	fx.Engine.SetDiskUsagePct(95)
	if err := fx.Engine.Ensure(ctx, fx.Ref, sha); err != nil {
		t.Fatalf("Ensure existing snapshot above threshold: %v", err)
	}
}

func TestIsENOSPC(t *testing.T) {
	if !gitfs.IsENOSPC(fmt.Errorf("write: %w", syscall.ENOSPC)) {
		t.Fatal("expected detection")
	}
	if gitfs.IsENOSPC(fmt.Errorf("write: %w", syscall.EIO)) {
		t.Fatal("EIO must not match ENOSPC")
	}
	// git()/gitStream shape: ExitError in the chain, ENOSPC only in stderr text.
	exitErr := gitStyleExitError(t)
	gitErr := fmt.Errorf("git fetch --depth 1 origin sha: %w: fatal: write error: No space left on device", exitErr)
	if !gitfs.IsENOSPC(gitErr) {
		t.Fatal("git-wrapped stderr ENOSPC must be detected")
	}
	if gitfs.IsENOSPC(fmt.Errorf("git fetch: %w: fatal: unable to access", exitErr)) {
		t.Fatal("unrelated git ExitError must not match ENOSPC")
	}
}

func TestMapDiskErrTriggersOnENOSPC(t *testing.T) {
	fx := workspacetest.New(t, nil)
	called := false
	fx.Engine.SetOnENOSPC(func() { called = true })
	fx.Engine.SetDiskUsagePct(42)

	err := gitfs.MapDiskErr(fx.Engine, fmt.Errorf("publish: %w", syscall.ENOSPC))
	var diskFull *gitfs.DiskFullError
	if !errors.As(err, &diskFull) {
		t.Fatalf("got %T %v, want *DiskFullError", err, err)
	}
	if diskFull.Root != fx.Engine.Root() {
		t.Fatalf("Root = %q, want %q", diskFull.Root, fx.Engine.Root())
	}
	if diskFull.UsedPct != 42 {
		t.Fatalf("UsedPct = %d, want 42", diskFull.UsedPct)
	}
	if !errors.Is(err, gitfs.ErrDiskFull) {
		t.Fatalf("errors.Is(ErrDiskFull) = false for %v", err)
	}
	if !called {
		t.Fatal("onENOSPC was not invoked")
	}
}

func TestMapDiskErrTriggersOnGitStderrENOSPC(t *testing.T) {
	fx := workspacetest.New(t, nil)
	called := false
	fx.Engine.SetOnENOSPC(func() { called = true })
	fx.Engine.SetDiskUsagePct(91)

	// Mirrors Engine.git / gitStream: %w is *exec.ExitError (no ENOSPC errno);
	// the disk-full signal lives only in the trailing stderr fragment.
	exitErr := gitStyleExitError(t)
	gitErr := fmt.Errorf("git archive --format=tar sha: %w: fatal: unable to write loose object file: No space left on device", exitErr)

	err := gitfs.MapDiskErr(fx.Engine, gitErr)
	var diskFull *gitfs.DiskFullError
	if !errors.As(err, &diskFull) {
		t.Fatalf("got %T %v, want *DiskFullError", err, err)
	}
	if diskFull.UsedPct != 91 {
		t.Fatalf("UsedPct = %d, want 91", diskFull.UsedPct)
	}
	if !errors.Is(err, gitfs.ErrDiskFull) {
		t.Fatalf("errors.Is(ErrDiskFull) = false for %v", err)
	}
	if !called {
		t.Fatal("onENOSPC was not invoked for git stderr ENOSPC")
	}
}

// gitStyleExitError returns a real *exec.ExitError (errno not ENOSPC) the way
// Engine.git wraps child failures — ENOSPC appears only in stderr text.
func gitStyleExitError(t *testing.T) *exec.ExitError {
	t.Helper()
	err := exec.Command("false").Run()
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		t.Fatalf("false: got %T %v, want *exec.ExitError", err, err)
	}
	return exitErr
}
