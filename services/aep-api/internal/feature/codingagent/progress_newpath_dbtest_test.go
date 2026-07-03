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

package codingagent

// DBTEST tier: the new-path (`ca-…` runName) branch of GetAgentProgress, which
// is DB-shaped — it reads the persisted coding_agent_logs snapshot and resolves
// the remote-worker namespace off the organizations table. Both need real
// Postgres. The cluster-gateway-proxy live-tail source is wire-faked. This pins
// the live→snapshot handoff (snapshot preferred once captured, Final flips true)
// and the NS-resolution the live tail depends on.

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
	"github.com/wso2/aep/aep-api/models"
)

func newPathTask(runName string) *models.ComponentTask {
	return &models.ComponentTask{
		ID:                     taskA,
		OrgID:                  "acme",
		Status:                 string(models.TaskStatusInProgress),
		LastCodingAgentRunName: runName,
	}
}

func TestGetAgentProgress_NewPath_PrefersSnapshotWhenCaptured(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	const run = "ca-aaaa-01"
	task := newPathTask(run)
	tr := &fakeTaskReader{byID: map[string]*models.ComponentTask{taskA: task}}
	// The task lookup is served by the fake reader, but coding_agent_logs has a
	// FK to component_tasks — seed the row so the snapshot insert is legal.
	seedTask(t, db, *task)

	// Persisted snapshot (what JobWatcher writes on terminal Job state).
	if err := db.Create(&models.CodingAgentLog{
		TaskID:     uuid.MustParse(taskA),
		RunName:    run,
		FinalPhase: "Succeeded",
		LogText: "2026-05-07T14:30:00.000000000Z first line\n" +
			"2026-05-07T14:30:01.000000000Z second line\n",
		SizeBytes: 64,
	}).Error; err != nil {
		t.Fatalf("seed snapshot: %v", err)
	}

	// The snapshot branch must short-circuit before touching the proxy; this
	// fake records any call so we can assert it stayed idle.
	state := newJobProxyState()
	svc := NewProgressService(tr, nil, nil).WithCodingAgentLogSource(newProxyClient(t, state), db)

	resp, err := svc.GetAgentProgress(ctx, taskA, 0, 0)
	if err != nil {
		t.Fatalf("agent progress: %v", err)
	}
	if !resp.Final {
		t.Fatal("snapshot present → Final must be true")
	}
	if len(resp.Lines) != 2 {
		t.Fatalf("snapshot must yield its 2 lines, got %d", len(resp.Lines))
	}
	if resp.Lines[0].Summary != "first line" || resp.Lines[1].Summary != "second line" {
		t.Fatalf("snapshot line parse: %+v", resp.Lines)
	}
	if resp.CursorMillis <= 0 {
		t.Fatalf("cursor must advance on the snapshot path, got %d", resp.CursorMillis)
	}
	// The snapshot branch must NOT touch the proxy.
	if got := state.polledJobs(); len(got) != 0 {
		t.Fatalf("snapshot path must not call the proxy, got job polls %v", got)
	}
}

func TestGetAgentProgress_NewPath_SnapshotSinceFilter(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	const run = "ca-aaaa-01"
	task := newPathTask(run)
	tr := &fakeTaskReader{byID: map[string]*models.ComponentTask{taskA: task}}
	seedTask(t, db, *task) // satisfy the coding_agent_logs FK
	if err := db.Create(&models.CodingAgentLog{
		TaskID:     uuid.MustParse(taskA),
		RunName:    run,
		FinalPhase: "Succeeded",
		LogText: "2026-05-07T14:30:00.000000000Z old line\n" +
			"2026-05-07T14:30:10.000000000Z new line\n",
		SizeBytes: 64,
	}).Error; err != nil {
		t.Fatalf("seed snapshot: %v", err)
	}
	svc := NewProgressService(tr, nil, nil).WithCodingAgentLogSource(newProxyClient(t, newJobProxyState()), db)

	// sinceMillis between the two lines → only "new line" survives the filter.
	since := time.Date(2026, 5, 7, 14, 30, 5, 0, time.UTC).UnixMilli()
	resp, err := svc.GetAgentProgress(ctx, taskA, since, 0)
	if err != nil {
		t.Fatalf("agent progress: %v", err)
	}
	if len(resp.Lines) != 1 || resp.Lines[0].Summary != "new line" {
		t.Fatalf("since filter must drop the old line, got %+v", resp.Lines)
	}
}

func TestGetAgentProgress_NewPath_LiveTailWhenNoSnapshot(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	const run = "ca-aaaa-01"
	tr := &fakeTaskReader{byID: map[string]*models.ComponentTask{taskA: newPathTask(run)}}

	// No snapshot row → live tail. Resolving the NS needs the org row.
	orgUUID := uuid.New()
	if err := db.Create(&models.Organization{UUID: orgUUID, Name: "acme"}).Error; err != nil {
		t.Fatalf("seed org: %v", err)
	}

	state := newJobProxyState()
	state.logText = "2026-05-07T14:30:00.000000000Z live tail line\n"
	svc := NewProgressService(tr, nil, nil).WithCodingAgentLogSource(newProxyClient(t, state), db)

	resp, err := svc.GetAgentProgress(ctx, taskA, 0, 0)
	if err != nil {
		t.Fatalf("agent progress: %v", err)
	}
	// Live tail: lines from the pod log, and NOT Final (no snapshot yet).
	if resp.Final {
		t.Fatal("live tail (no snapshot) must be non-Final")
	}
	if len(resp.Lines) != 1 || resp.Lines[0].Summary != "live tail line" {
		t.Fatalf("live tail lines: %+v", resp.Lines)
	}
}

func TestProgressService_ResolveNewPathNS(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	svc := NewProgressService(nil, nil, nil).WithCodingAgentLogSource(newProxyClient(t, newJobProxyState()), db)

	// Missing org row → (,false).
	if _, ok := svc.resolveNewPathNS(ctx, &models.ComponentTask{OrgID: "ghost"}); ok {
		t.Fatal("missing org must resolve false")
	}

	// Org row present → NS derived from its UUID.
	orgUUID := uuid.New()
	if err := db.Create(&models.Organization{UUID: orgUUID, Name: "acme"}).Error; err != nil {
		t.Fatalf("seed org: %v", err)
	}
	ns, ok := svc.resolveNewPathNS(ctx, &models.ComponentTask{OrgID: "acme"})
	if !ok {
		t.Fatal("present org must resolve true")
	}
	if want := tenant.RemoteWorkerNamespace(orgUUID.String()); ns != want {
		t.Fatalf("NS = %q; want %q", ns, want)
	}

	// Thunder UUID, when present, wins over the local PK.
	thunder := uuid.New()
	org2UUID := uuid.New()
	if err := db.Create(&models.Organization{UUID: org2UUID, Name: "globex", ThunderOrgUUID: &thunder}).Error; err != nil {
		t.Fatalf("seed org2: %v", err)
	}
	ns2, ok := svc.resolveNewPathNS(ctx, &models.ComponentTask{OrgID: "globex"})
	if !ok || ns2 != tenant.RemoteWorkerNamespace(thunder.String()) {
		t.Fatalf("Thunder UUID must drive NS derivation, got %q ok=%v", ns2, ok)
	}
}
