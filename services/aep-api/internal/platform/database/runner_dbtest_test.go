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

package database_test

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/platform/database"
	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
)

// Two concurrent Run calls against one DB must serialize: the loser's first
// step must not start until the winner's last step has finished.
func TestRun_SerializesConcurrentCallersWithAdvisoryLock(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t) // already migrated; we only exercise the lock wrapper

	var concurrent atomic.Int32
	var maxConcurrent atomic.Int32
	step := func(ctx context.Context) error {
		cur := concurrent.Add(1)
		for {
			old := maxConcurrent.Load()
			if cur <= old || maxConcurrent.CompareAndSwap(old, cur) {
				break
			}
		}
		time.Sleep(150 * time.Millisecond)
		concurrent.Add(-1)
		return nil
	}
	steps := []database.Step{{Name: "probe", Run: step}}

	var wg sync.WaitGroup
	errCh := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errCh <- database.Run(context.Background(), db, steps)
		}()
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		if err != nil {
			t.Fatalf("Run: %v", err)
		}
	}
	if maxConcurrent.Load() != 1 {
		t.Fatalf("max concurrent steps = %d, want 1 (advisory lock must serialize)", maxConcurrent.Load())
	}
}
