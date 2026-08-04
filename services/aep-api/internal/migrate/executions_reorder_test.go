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

package migrate_test

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/contracts/taskmeta"
	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/migrate"
	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
)

// After upgrading a DB that only has the legacy admission index, only the
// component-keyed index remains and a second active admit for the same key
// is refused.
func TestRunExecutions_LegacyIndexUpgrade_AdmissionHeld(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	if err := db.Exec(`DROP INDEX IF EXISTS ux_executions_admission_component`).Error; err != nil {
		t.Fatalf("drop new index: %v", err)
	}
	if err := db.Exec(`
		CREATE UNIQUE INDEX ux_executions_admission
		ON executions (repo, issue_number, kind)
		WHERE status IN ('queued', 'running')`).Error; err != nil {
		t.Fatalf("create legacy index: %v", err)
	}

	if err := migrate.RunExecutions(ctx, db); err != nil {
		t.Fatalf("RunExecutions: %v", err)
	}

	var hasNew, hasLegacy bool
	if err := db.Raw(`SELECT EXISTS (
		SELECT 1 FROM pg_indexes WHERE indexname = 'ux_executions_admission_component')`).
		Scan(&hasNew).Error; err != nil {
		t.Fatalf("check new index: %v", err)
	}
	if err := db.Raw(`SELECT EXISTS (
		SELECT 1 FROM pg_indexes WHERE indexname = 'ux_executions_admission')`).
		Scan(&hasLegacy).Error; err != nil {
		t.Fatalf("check legacy index: %v", err)
	}
	if !hasNew {
		t.Fatal("want ux_executions_admission_component after upgrade")
	}
	if hasLegacy {
		t.Fatal("legacy ux_executions_admission must be dropped after upgrade")
	}

	repo := delivery.NewExecutionRepository(db, nil)
	first := &delivery.Execution{
		OrgID:       "orga",
		ProjectID:   "proj",
		Repo:        "acme/repo",
		IssueNumber: 42,
		Kind:        string(taskmeta.KindCoding),
		Component:   "web",
	}
	ok, _, err := repo.TryAdmit(ctx, first)
	if err != nil || !ok {
		t.Fatalf("TryAdmit(first) = (%v, %v), want admitted", ok, err)
	}
	second := &delivery.Execution{
		OrgID:       "orga",
		ProjectID:   "proj",
		Repo:        "acme/repo",
		IssueNumber: 42,
		Kind:        string(taskmeta.KindCoding),
		Component:   "web",
	}
	ok, _, err = repo.TryAdmit(ctx, second)
	if err != nil {
		t.Fatalf("TryAdmit(second): %v", err)
	}
	if ok {
		t.Fatal("TryAdmit(second) admitted — component admission mutex not enforced")
	}
}

// Concurrent TryAdmit during the CREATE→DROP upgrade window must never
// double-admit. A sleep between the two statements widens the window so the
// race is observable; CREATE-then-DROP keeps a covering unique index for the
// whole gap (DROP-then-CREATE would leave none).
func TestRunExecutions_CreateThenDrop_NoDoubleAdmitUnderConcurrentTryAdmit(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	if err := db.Exec(`DROP INDEX IF EXISTS ux_executions_admission_component`).Error; err != nil {
		t.Fatalf("drop new index: %v", err)
	}
	if err := db.Exec(`
		CREATE UNIQUE INDEX ux_executions_admission
		ON executions (repo, issue_number, kind)
		WHERE status IN ('queued', 'running')`).Error; err != nil {
		t.Fatalf("create legacy index: %v", err)
	}

	stmts := migrate.ExecutionsAdmissionStatements()
	done := make(chan struct{})
	go func() {
		defer close(done)
		if err := db.WithContext(ctx).Exec(stmts[0]).Error; err != nil {
			t.Errorf("CREATE: %v", err)
			return
		}
		time.Sleep(200 * time.Millisecond) // widen CREATE→DROP window
		if err := db.WithContext(ctx).Exec(stmts[1]).Error; err != nil {
			t.Errorf("DROP: %v", err)
		}
	}()

	repo := delivery.NewExecutionRepository(db, nil)
	var admits atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-done:
					return
				default:
				}
				e := &delivery.Execution{
					OrgID:       "orga",
					ProjectID:   "proj",
					Repo:        "acme/race",
					IssueNumber: 99,
					Kind:        string(taskmeta.KindCoding),
					Component:   "web",
				}
				ok, _, err := repo.TryAdmit(ctx, e)
				if err != nil {
					continue // unique violations / transient — keep spinning
				}
				if ok {
					admits.Add(1)
				}
			}
		}()
	}
	<-done
	wg.Wait()

	if n := admits.Load(); n != 1 {
		t.Fatalf("admits during CREATE-then-DROP window = %d, want exactly 1", n)
	}
}
