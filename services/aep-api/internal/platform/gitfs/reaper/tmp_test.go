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
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/platform/gitfs"
)

func TestReclaimTmpPurgesAgedSkipsAskpass(t *testing.T) {
	cfg := testCfg()
	cfg.TrashMaxAge = time.Hour // tmp TTL binding: same as production default
	r, root := newSyntheticReaper(t, cfg, staticLister(nil))
	tmp := gitfs.TmpDir(root)
	aged := filepath.Join(tmp, "clone-old")
	if err := os.MkdirAll(aged, 0o755); err != nil {
		t.Fatal(err)
	}
	mkFile(t, filepath.Join(aged, "x"), 8)
	chtimes(t, aged, time.Now().Add(-2*time.Hour))

	fresh := filepath.Join(tmp, "clone-fresh")
	if err := os.MkdirAll(fresh, 0o755); err != nil {
		t.Fatal(err)
	}
	askpass := filepath.Join(tmp, "askpass.sh")
	if err := os.WriteFile(askpass, []byte("#!/bin/sh\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	chtimes(t, askpass, time.Now().Add(-48*time.Hour)) // aged but protected

	if err := r.reclaimTmp(context.Background()); err != nil {
		t.Fatalf("reclaimTmp: %v", err)
	}
	mustNotExist(t, aged)
	mustExist(t, fresh)
	mustExist(t, askpass)
}

func TestRunStartupSweepBeforeTicker(t *testing.T) {
	cfg := testCfg()
	cfg.ReapInterval = time.Hour // ticker must not fire in this test
	cfg.TrashMaxAge = time.Nanosecond
	r, root := newSyntheticReaper(t, cfg, staticLister(nil))
	r.diskUsage = fakeDisk(1000, 900)

	oldTrash := filepath.Join(gitfs.TrashDir(root),
		fmt.Sprintf("%016x-dead", uint64(time.Now().Add(-time.Hour).UnixNano())))
	mkFile(t, filepath.Join(oldTrash, "payload"), 4)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		r.Run(ctx)
		close(done)
	}()

	deadline := time.After(2 * time.Second)
	for {
		if _, err := os.Stat(oldTrash); os.IsNotExist(err) {
			break
		}
		select {
		case <-deadline:
			t.Fatal("startup sweep did not reclaim aged trash before first tick")
		case <-time.After(20 * time.Millisecond):
		}
	}
	cancel()
	<-done
}
