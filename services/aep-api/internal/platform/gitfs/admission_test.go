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
