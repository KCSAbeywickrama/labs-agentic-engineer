# Agent Activity Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the console's client-side-derived "Agent Activity" feed (issue #239) with a real, append-only backend activity-event stream — recorded at SDLC choke points, served paginated + live over SSE, and rendered from structured facts by the frontend.

**Architecture:** A new `activity_events` Postgres table (append-only, deduped by a deterministic key) is written best-effort at five choke points (spec publish, plan derived, task started/deployed/failed). A narrow `activity.Recorder` service does the insert and wakes an in-process project-scoped hub. Two contract-first endpoints serve it: `GET /projects/{p}/activity` (newest-first, cursor-paginated) and `GET /projects/{p}/activity/stream` (SSE tail). The frontend swaps the derived feed for a TanStack Query read + a `parseAs:"stream"` SSE tail, rendering the sentence (including viewer-relative "You") from structured fields.

**Tech Stack:** Go 1.26 (BFF, GORM/Postgres, Temporal, oapi-codegen strict server), OpenAPI 3.0.3 (hand-authored contract), React 19 + TypeScript + TanStack Query + openapi-fetch + Oxygen UI (console).

**Decisions of record:** issue #239 comment (grilling). Key ones baked into this plan: Option A (dedicated store) · structured facts, frontend renders · actor reuses `ChatAuthor{id:email,displayName}` · discrete milestones · deployed = per-task terminal · best-effort emission · deterministic dedup key · SSE in v1 · clean frontend cutover.

---

## Prerequisites & conventions

- All backend commands run from `services/aep-api/` unless noted. Contract edits: edit `packages/contracts/api/v1/openapi.yaml`, then `make gen-api` (Go) + `make gen` at repo root (or `pnpm --filter @aep/console gen`) to refresh console types. CI enforces both via `gen-api-check`.
- Go tests: `go test ./internal/feature/activity/...`, `go test ./repositories/...`. DB-backed tests use the `dbtest` harness (Postgres testcontainer) and are named `*_dbtest_test.go`.
- Console: `cd apps/console && pnpm exec vitest run <file>` for a single test, `pnpm exec tsc --noEmit` to typecheck.
- Commit after every green step. Branch is already `aep-rewrite-latest` (issue #239 work).

## File structure (what each new/changed file owns)

**Milestone 1 — store + service (no external behavior yet):**
- Create `services/aep-api/models/activity_event.go` — the GORM row + type/actor constants.
- Create `services/aep-api/internal/feature/activity/ports.go` — `Event`, `Repository` port, `Recorder` interface.
- Create `services/aep-api/internal/feature/activity/hub.go` — project-scoped notify hub (copy of task-stream hub, keyed by org+project).
- Create `services/aep-api/internal/feature/activity/service.go` — `Service` (Record best-effort, List, Subscribe).
- Create `services/aep-api/internal/feature/activity/service_test.go` — unit tests with a fake repo.
- Create `services/aep-api/repositories/activity_event_repository.go` — concrete GORM repo (Insert ON CONFLICT DO NOTHING, ListByProject cursor).
- Create `services/aep-api/repositories/activity_event_repository_dbtest_test.go` — DB tests.
- Modify `services/aep-api/cmd/aep-api/main.go` — AutoMigrate list.
- Modify `services/aep-api/internal/platform/dbtest/dbtest.go` — `baseModels` mirror.
- Modify `services/aep-api/internal/api/deps.go` — add `ActivitySvc` field.
- Modify `services/aep-api/internal/app/app.go` — construct repo+hub+service, wire into `Deps`.

**Milestone 2 — producers (events start flowing):**
- Modify `services/aep-api/internal/feature/design/...` is NOT the path — see M2 correction. Producers:
- Modify `services/aep-api/internal/api/handlers_build.go` — emit `spec_published` (real user actor).
- Modify `services/aep-api/internal/feature/devflow/activities.go` — new `RecordActivity` activity + `ActivityRecorder` dep.
- Modify `services/aep-api/internal/feature/devflow/workflow_dev.go` — dispatch `plan_derived` after planning.
- Modify `services/aep-api/internal/feature/devflow/workflow_task.go` — dispatch `task_started/deployed/failed` at phase transitions.
- Modify `services/aep-api/internal/app/app.go` — inject recorder into `devflow.Deps`.

**Milestone 3 — read endpoint:**
- Modify `packages/contracts/api/v1/openapi.yaml` — `GET /projects/{projectName}/activity` + `ActivityEvent`/`ActivityFeed` schemas.
- Create `services/aep-api/internal/api/handlers_activity.go` — the read handler.
- Create `services/aep-api/internal/api/handlers_activity_test.go` — component test.

**Milestone 4 — SSE stream:**
- Modify `packages/contracts/api/v1/openapi.yaml` — `GET /projects/{projectName}/activity/stream`.
- Create `services/aep-api/internal/feature/activity/stream.go` — the connection loop (replay + tail).
- Modify `services/aep-api/internal/api/handlers_activity.go` — the stream handler + Visit response.

**Milestone 5 — frontend cutover:**
- Create `apps/console/src/features/activity/api/keys.ts` — query keys.
- Create `apps/console/src/features/activity/api/queries.ts` — `useProjectActivity` read hook.
- Create `apps/console/src/features/activity/api/stream.ts` — SSE opener.
- Create `apps/console/src/features/activity/lib/render.tsx` — type → sentence + tone (moved from `projectActivity.ts`).
- Create `apps/console/src/features/activity/hooks/useActivityFeed.ts` — query + SSE fold.
- Modify `apps/console/src/features/projects/components/AgentActivity.tsx` — consume the real feed.
- Delete `agentActivity()` + `PLACEHOLDER_TIMES` from `apps/console/src/features/projects/lib/projectActivity.ts`.
- Update `apps/console/src/mocks/handlers/` + fixtures for the new endpoints.

---

## Milestone 1 — Activity event store + service

Ships a tested, injected store. Nothing emits or reads yet. **Note on indexing:** the dedup uniqueness is a *full* composite unique index `(org_id, project_id, dedup_key)` and the feed read index is `(org_id, project_id, occurred_at desc)` — both are expressible by GORM `AutoMigrate` via struct tags, so (unlike `workflow_runs`' *partial* index) **no `internal/database/migrations/` file is needed**.

### Task 1.1: The `ActivityEvent` model

**Files:**
- Create: `services/aep-api/models/activity_event.go`

- [ ] **Step 1: Write the model** (no standalone test — exercised by the repo dbtest in Task 1.3)

```go
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

package models

import "time"

// Activity event types — the v1 taxonomy (issue #239). Plain string constants,
// matching the model convention (canonical values here, no enum package).
const (
	ActivityTypeSpecPublished = "spec_published"
	ActivityTypePlanDerived   = "plan_derived"
	ActivityTypeTaskStarted   = "task_started"
	ActivityTypeTaskDeployed  = "task_deployed"
	ActivityTypeTaskFailed    = "task_failed"

	ActivityActorUser  = "user"
	ActivityActorAgent = "agent"
)

// ActivityEvent is one row of the project activity feed (issue #239): an
// append-only, best-effort record of an SDLC milestone. The console renders the
// human sentence from these structured facts (type + actor + target), so no
// rendered message is stored, and no tone (the console maps type → tone). "You"
// is viewer-relative, so the actor is stored as a stable identity (email for a
// user) and the console decides "You" vs a name.
//
// DedupKey makes emission idempotent under Temporal activity retry and GitHub
// webhook redelivery: the (org_id, project_id, dedup_key) unique index turns a
// re-emit into a no-op (INSERT ... ON CONFLICT DO NOTHING). Both indexes are
// full (non-partial) composite indexes, so AutoMigrate creates them from these
// tags — no hand-written migration is needed.
type ActivityEvent struct {
	ID string `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`

	OrgID     string `gorm:"not null;uniqueIndex:ux_activity_events_dedup,priority:1;index:idx_activity_events_feed,priority:1" json:"-"`
	ProjectID string `gorm:"not null;uniqueIndex:ux_activity_events_dedup,priority:2;index:idx_activity_events_feed,priority:2" json:"-"`

	Type string `gorm:"not null" json:"type"` // spec_published | plan_derived | task_started | task_deployed | task_failed

	// Actor identity — reuses the chat ChatAuthor model (#130). For a user:
	// kind=user, id=email, name=display name (denormalized at emission — there
	// is no user directory and JWT identity is request-time only). For an agent:
	// kind=agent, id='build-agent'|'plan-agent', name='Build agent'|'Plan agent'.
	ActorKind string `gorm:"not null" json:"actorKind"`
	ActorID   string `gorm:"type:text" json:"actorId,omitempty"`
	ActorName string `gorm:"type:text;not null" json:"actorName"`

	// Target references — each type populates the subset it needs; the console
	// renders them into the line. Flat columns (DevflowRun style), not a JSON blob.
	Issue       int    `json:"issue,omitempty"`
	Title       string `gorm:"type:text" json:"title,omitempty"`
	Component   string `gorm:"type:text" json:"component,omitempty"`
	Environment string `gorm:"type:text" json:"environment,omitempty"`
	Tag         string `gorm:"type:text" json:"tag,omitempty"`

	// DedupKey — deterministic per logical event (e.g. "exec:{id}:deployed").
	DedupKey string `gorm:"type:text;not null;uniqueIndex:ux_activity_events_dedup,priority:3" json:"-"`

	// OccurredAt is the real event time; the feed orders by it, newest first.
	OccurredAt time.Time `gorm:"not null;index:idx_activity_events_feed,priority:3,sort:desc" json:"occurredAt"`
	CreatedAt  time.Time `json:"-"`
}

// TableName pins the table name.
func (ActivityEvent) TableName() string { return "activity_events" }
```

- [ ] **Step 2: Verify it compiles**

Run: `go build ./models/...`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add services/aep-api/models/activity_event.go
git commit -m "feat(aep-api): activity_events model for the project activity feed (#239)"
```

### Task 1.2: Register the model with AutoMigrate (prod + test harness)

**Files:**
- Modify: `services/aep-api/cmd/aep-api/main.go:54-62`
- Modify: `services/aep-api/internal/platform/dbtest/dbtest.go:209-217`

- [ ] **Step 1: Add to the production AutoMigrate list**

In `cmd/aep-api/main.go`, the `database.Open(...)` variadic list currently ends at `&models.DevflowRun{},`. Add the new model:

```go
	db, err := database.Open(cfg.DatabaseURL,
		&models.ComponentConfig{},
		&models.WebhookDelivery{},
		&models.WebhookPayload{},
		&models.Organization{},
		&models.Execution{},
		&models.AgentTurn{},
		&models.DevflowRun{},
		&models.ActivityEvent{},
	)
```

- [ ] **Step 2: Add to the dbtest mirror** (kept in sync per the comment above it)

In `internal/platform/dbtest/dbtest.go`, append to `baseModels`:

```go
var baseModels = []any{
	&models.ComponentConfig{},
	&models.WebhookDelivery{},
	&models.WebhookPayload{},
	&models.Organization{},
	&models.Execution{},
	&models.AgentTurn{},
	&models.DevflowRun{},
	&models.ActivityEvent{},
}
```

- [ ] **Step 3: Verify it compiles**

Run: `go build ./...`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add services/aep-api/cmd/aep-api/main.go services/aep-api/internal/platform/dbtest/dbtest.go
git commit -m "feat(aep-api): register ActivityEvent with AutoMigrate (prod + dbtest)"
```

### Task 1.3: The concrete repository (dbtest-first)

**Files:**
- Create: `services/aep-api/internal/feature/activity/ports.go` (the `Repository` port the test/service compile against — written here first because the repo must satisfy it)
- Create: `services/aep-api/repositories/activity_event_repository.go`
- Test: `services/aep-api/repositories/activity_event_repository_dbtest_test.go`

- [ ] **Step 1: Write the port** (minimal — the `Event`/`Recorder` parts land in Task 1.5; keeping `Repository` here lets the repo + its test compile now)

Create `internal/feature/activity/ports.go`:

```go
// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
// ... (standard Apache header) ...

package activity

import (
	"context"
	"time"

	"github.com/wso2/aep/aep-api/models"
)

// Repository is the storage port the activity Service depends on — narrow
// enough to fake in unit tests without a database. The concrete
// repositories.ActivityEventRepository satisfies it structurally.
type Repository interface {
	// Insert appends an event, ignoring a duplicate (org_id, project_id,
	// dedup_key) via ON CONFLICT DO NOTHING. inserted is false on a duplicate
	// no-op, so the caller can skip a redundant live-tail notify.
	Insert(ctx context.Context, row *models.ActivityEvent) (inserted bool, err error)

	// ListByProject returns a project's events newest-first (occurred_at DESC,
	// id DESC), at most limit. When beforeTime is non-zero it returns only rows
	// strictly older than the (beforeTime, beforeID) cursor — the "show more" page.
	ListByProject(ctx context.Context, orgID, projectID string, limit int, beforeTime time.Time, beforeID string) ([]models.ActivityEvent, error)
}
```

- [ ] **Step 2: Write the failing dbtest**

Create `repositories/activity_event_repository_dbtest_test.go`. (Follow the existing `*_dbtest_test.go` harness usage — `dbtest.NewDB(t)` returns a migrated `*gorm.DB`; check `repositories/workflow_run_repository_dbtest_test.go` if present for the exact helper name, else `dbtest.New(t)`.)

```go
// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
// ... (standard Apache header) ...

package repositories_test

import (
	"context"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

func TestActivityEventRepository_InsertDedupAndList(t *testing.T) {
	db := dbtest.NewDB(t) // adjust to the harness's actual constructor
	repo := repositories.NewActivityEventRepository(db)
	ctx := context.Background()

	base := time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC)
	mk := func(dedup string, at time.Time) *models.ActivityEvent {
		return &models.ActivityEvent{
			OrgID: "org1", ProjectID: "proj1", Type: models.ActivityTypeTaskDeployed,
			ActorKind: models.ActivityActorAgent, ActorID: "build-agent", ActorName: "Build agent",
			Issue: 10, Title: "Catalog", DedupKey: dedup, OccurredAt: at,
		}
	}

	// First insert lands.
	ins, err := repo.Insert(ctx, mk("exec:1:deployed", base))
	if err != nil || !ins {
		t.Fatalf("first insert: inserted=%v err=%v", ins, err)
	}
	// Same dedup_key is a no-op (inserted=false, no error).
	ins, err = repo.Insert(ctx, mk("exec:1:deployed", base))
	if err != nil || ins {
		t.Fatalf("dup insert: inserted=%v err=%v (want false,nil)", ins, err)
	}
	// A second distinct event, newer.
	if _, err := repo.Insert(ctx, mk("exec:2:deployed", base.Add(time.Minute))); err != nil {
		t.Fatalf("second insert: %v", err)
	}

	// Newest-first, no cursor.
	rows, err := repo.ListByProject(ctx, "org1", "proj1", 10, time.Time{}, "")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("want 2 rows, got %d", len(rows))
	}
	if !rows[0].OccurredAt.After(rows[1].OccurredAt) {
		t.Fatalf("want newest first, got %v then %v", rows[0].OccurredAt, rows[1].OccurredAt)
	}

	// Cursor after the newest returns only the older row.
	page, err := repo.ListByProject(ctx, "org1", "proj1", 10, rows[0].OccurredAt, rows[0].ID)
	if err != nil {
		t.Fatalf("list page: %v", err)
	}
	if len(page) != 1 || page[0].ID != rows[1].ID {
		t.Fatalf("cursor page wrong: %+v", page)
	}

	// Other-org isolation.
	other, _ := repo.ListByProject(ctx, "org2", "proj1", 10, time.Time{}, "")
	if len(other) != 0 {
		t.Fatalf("cross-org leak: %d rows", len(other))
	}
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `go test ./repositories/ -run TestActivityEventRepository_InsertDedupAndList`
Expected: FAIL — `undefined: repositories.NewActivityEventRepository`.

- [ ] **Step 4: Write the repository**

Create `repositories/activity_event_repository.go`:

```go
// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
// ... (standard Apache header) ...

package repositories

import (
	"context"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/wso2/aep/aep-api/models"
)

// ActivityEventRepository is the append-only store behind the project activity
// feed (issue #239). Writes are deduped on (org_id, project_id, dedup_key);
// reads are newest-first with a keyset (occurred_at, id) cursor.
type ActivityEventRepository struct{ db *gorm.DB }

// NewActivityEventRepository returns a repository backed by db.
func NewActivityEventRepository(db *gorm.DB) *ActivityEventRepository {
	return &ActivityEventRepository{db: db}
}

// Insert appends the row, treating a duplicate dedup key as a no-op. inserted
// reflects whether a new row landed (RowsAffected), so a retried/redelivered
// event does not trigger a redundant live-tail notify.
func (r *ActivityEventRepository) Insert(ctx context.Context, row *models.ActivityEvent) (bool, error) {
	res := r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "org_id"}, {Name: "project_id"}, {Name: "dedup_key"}},
		DoNothing: true,
	}).Create(row)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// ListByProject returns a project's events newest-first, at most limit. A
// non-zero beforeTime pages to rows strictly older than (beforeTime, beforeID)
// — a keyset cursor stable under concurrent inserts.
func (r *ActivityEventRepository) ListByProject(ctx context.Context, orgID, projectID string, limit int, beforeTime time.Time, beforeID string) ([]models.ActivityEvent, error) {
	q := r.db.WithContext(ctx).
		Where("org_id = ? AND project_id = ?", orgID, projectID).
		Order("occurred_at DESC, id DESC").
		Limit(limit)
	if !beforeTime.IsZero() {
		// Row-value comparison gives a correct keyset page even when several
		// events share an occurred_at.
		q = q.Where("(occurred_at, id) < (?, ?)", beforeTime, beforeID)
	}
	var rows []models.ActivityEvent
	if err := q.Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `go test ./repositories/ -run TestActivityEventRepository_InsertDedupAndList`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/aep-api/internal/feature/activity/ports.go services/aep-api/repositories/activity_event_repository.go services/aep-api/repositories/activity_event_repository_dbtest_test.go
git commit -m "feat(aep-api): activity_events repository (dedup insert + keyset list)"
```

### Task 1.4: The project-scoped notify hub

**Files:**
- Create: `services/aep-api/internal/feature/activity/hub.go`

- [ ] **Step 1: Write the hub** (a copy of `execution/task_stream_hub.go`, keyed by org+project instead of repo+issue)

```go
// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
// ... (standard Apache header) ...

package activity

import "sync"

// Hub is the in-process change bus behind the activity live-tail: a notify-only
// broker keyed by (org, project). It carries no payload and buffers no history
// — it only wakes attached SSE connections to re-read the newest events. Same
// design as execution.TaskStreamHub. Single-replica assumption (aep-api runs
// one replica); the known evolution when the BFF scales out is LISTEN/NOTIFY.
type Hub struct {
	mu   sync.Mutex
	subs map[string]map[chan struct{}]struct{}
}

// NewHub builds an empty hub.
func NewHub() *Hub {
	return &Hub{subs: map[string]map[chan struct{}]struct{}{}}
}

func hubKey(orgID, projectID string) string { return orgID + "/" + projectID }

// Subscribe registers a listener for (org, project). The returned channel is
// signalled (coalesced) on every Notify; cancel deregisters it and is
// idempotent. Buffered(1) so a notify never blocks the writer and repeated
// notifies collapse into one wake-up.
func (h *Hub) Subscribe(orgID, projectID string) (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	key := hubKey(orgID, projectID)

	h.mu.Lock()
	if h.subs[key] == nil {
		h.subs[key] = map[chan struct{}]struct{}{}
	}
	h.subs[key][ch] = struct{}{}
	h.mu.Unlock()

	var once sync.Once
	cancel := func() {
		once.Do(func() {
			h.mu.Lock()
			if m := h.subs[key]; m != nil {
				delete(m, ch)
				if len(m) == 0 {
					delete(h.subs, key)
				}
			}
			h.mu.Unlock()
		})
	}
	return ch, cancel
}

// Notify wakes every listener attached to (org, project). Nil-safe — writers
// hold the hub unconditionally, so an unwired hub is a silent no-op.
// Non-blocking: a full listener buffer is left alone (it re-reads on next drain).
func (h *Hub) Notify(orgID, projectID string) {
	if h == nil {
		return
	}
	key := hubKey(orgID, projectID)
	h.mu.Lock()
	chans := make([]chan struct{}, 0, len(h.subs[key]))
	for ch := range h.subs[key] {
		chans = append(chans, ch)
	}
	h.mu.Unlock()
	for _, ch := range chans {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}
```

- [ ] **Step 2: Verify it compiles**

Run: `go build ./internal/feature/activity/...`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add services/aep-api/internal/feature/activity/hub.go
git commit -m "feat(aep-api): project-scoped activity notify hub"
```

### Task 1.5: The service (Record best-effort, List, Subscribe)

**Files:**
- Modify: `services/aep-api/internal/feature/activity/ports.go` (add `Event` + `Recorder`)
- Create: `services/aep-api/internal/feature/activity/service.go`
- Test: `services/aep-api/internal/feature/activity/service_test.go`

- [ ] **Step 1: Add `Event` and `Recorder` to ports.go**

Append to `internal/feature/activity/ports.go`:

```go
// Event is the input to Record — one activity to append. The service stamps it
// into a models.ActivityEvent row. Producers set OccurredAt from a real clock
// (in a Temporal workflow: workflow.Now(ctx), passed into the recording activity).
type Event struct {
	OrgID     string
	ProjectID string
	Type      string
	ActorKind string
	ActorID   string
	ActorName string

	Issue       int
	Title       string
	Component   string
	Environment string
	Tag         string

	DedupKey   string
	OccurredAt time.Time
}

// Recorder is what event producers call to append an activity (best-effort:
// implementations never return an error — a storage failure is logged and
// swallowed so it can never fail the SDLC operation that produced it).
type Recorder interface {
	Record(ctx context.Context, e Event)
}
```

- [ ] **Step 2: Write the failing service test**

Create `internal/feature/activity/service_test.go`:

```go
// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
// ... (standard Apache header) ...

package activity

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/models"
)

type fakeRepo struct {
	inserted []*models.ActivityEvent
	insErr   error
	dup      bool // when true, Insert reports a no-op (inserted=false)
}

func (f *fakeRepo) Insert(_ context.Context, row *models.ActivityEvent) (bool, error) {
	if f.insErr != nil {
		return false, f.insErr
	}
	if f.dup {
		return false, nil
	}
	f.inserted = append(f.inserted, row)
	return true, nil
}
func (f *fakeRepo) ListByProject(context.Context, string, string, int, time.Time, string) ([]models.ActivityEvent, error) {
	return nil, nil
}

func TestService_Record_swallowsErrorAndSkipsNotifyOnFailure(t *testing.T) {
	repo := &fakeRepo{insErr: errors.New("db down")}
	hub := NewHub()
	ch, cancel := hub.Subscribe("org1", "proj1")
	defer cancel()
	svc := NewService(repo, hub)

	// Must not panic / must not propagate the error (Record returns nothing).
	svc.Record(context.Background(), Event{OrgID: "org1", ProjectID: "proj1", Type: models.ActivityTypePlanDerived, ActorName: "Plan agent", OccurredAt: time.Now()})

	select {
	case <-ch:
		t.Fatal("failed insert must not notify the hub")
	default:
	}
}

func TestService_Record_notifiesOnlyOnRealInsert(t *testing.T) {
	// Real insert → notify.
	repo := &fakeRepo{}
	hub := NewHub()
	ch, cancel := hub.Subscribe("org1", "proj1")
	defer cancel()
	NewService(repo, hub).Record(context.Background(), Event{OrgID: "org1", ProjectID: "proj1", Type: models.ActivityTypeTaskStarted, ActorName: "Build agent", OccurredAt: time.Now()})
	select {
	case <-ch:
	default:
		t.Fatal("real insert should have notified")
	}

	// Duplicate no-op → no notify.
	dupRepo := &fakeRepo{dup: true}
	hub2 := NewHub()
	ch2, cancel2 := hub2.Subscribe("org1", "proj1")
	defer cancel2()
	NewService(dupRepo, hub2).Record(context.Background(), Event{OrgID: "org1", ProjectID: "proj1", Type: models.ActivityTypeTaskStarted, ActorName: "Build agent", OccurredAt: time.Now()})
	select {
	case <-ch2:
		t.Fatal("duplicate no-op must not notify")
	default:
	}
}

func TestService_List_clampsLimit(t *testing.T) {
	svc := NewService(&fakeRepo{}, NewHub())
	// Out-of-range limits fall back to the default; this asserts no panic and a
	// clean call path (the fake returns nil,nil).
	if _, err := svc.List(context.Background(), "org1", "proj1", 0, time.Time{}, ""); err != nil {
		t.Fatalf("List(0): %v", err)
	}
	if _, err := svc.List(context.Background(), "org1", "proj1", 10_000, time.Time{}, ""); err != nil {
		t.Fatalf("List(10000): %v", err)
	}
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `go test ./internal/feature/activity/ -run TestService`
Expected: FAIL — `undefined: NewService`.

- [ ] **Step 4: Write the service**

Create `internal/feature/activity/service.go`:

```go
// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
// ... (standard Apache header) ...

package activity

import (
	"context"
	"log/slog"
	"time"

	"github.com/wso2/aep/aep-api/models"
)

// Read-page bounds for the feed endpoint.
const (
	defaultLimit = 50
	maxLimit     = 200
)

// Service records activity events (best-effort) and serves the feed. It also
// owns the live-tail hub so callers need only one dependency.
type Service struct {
	repo Repository
	hub  *Hub
}

// NewService wires the store-backed service.
func NewService(repo Repository, hub *Hub) *Service {
	return &Service{repo: repo, hub: hub}
}

// Record appends the event best-effort: a storage failure is logged and
// swallowed — recording activity must never fail or delay the SDLC operation
// that produced it. On a real (non-duplicate) insert it wakes the project's
// live-tail subscribers. Satisfies Recorder.
func (s *Service) Record(ctx context.Context, e Event) {
	if s == nil || s.repo == nil {
		return
	}
	if e.OccurredAt.IsZero() {
		e.OccurredAt = time.Now().UTC() // fallback only; producers pass a real time
	}
	row := &models.ActivityEvent{
		OrgID: e.OrgID, ProjectID: e.ProjectID, Type: e.Type,
		ActorKind: e.ActorKind, ActorID: e.ActorID, ActorName: e.ActorName,
		Issue: e.Issue, Title: e.Title, Component: e.Component,
		Environment: e.Environment, Tag: e.Tag,
		DedupKey: e.DedupKey, OccurredAt: e.OccurredAt,
	}
	inserted, err := s.repo.Insert(ctx, row)
	if err != nil {
		slog.WarnContext(ctx, "activity: record failed",
			"type", e.Type, "project", e.ProjectID, "error", err)
		return
	}
	if inserted {
		s.hub.Notify(e.OrgID, e.ProjectID)
	}
}

// List returns a project's events newest-first, at most limit (clamped to
// [1, maxLimit], default when non-positive), paged before the (beforeTime,
// beforeID) cursor.
func (s *Service) List(ctx context.Context, orgID, projectID string, limit int, beforeTime time.Time, beforeID string) ([]models.ActivityEvent, error) {
	if limit <= 0 || limit > maxLimit {
		limit = defaultLimit
	}
	return s.repo.ListByProject(ctx, orgID, projectID, limit, beforeTime, beforeID)
}

// Subscribe registers a live-tail listener for (org, project); cancel deregisters.
func (s *Service) Subscribe(orgID, projectID string) (<-chan struct{}, func()) {
	return s.hub.Subscribe(orgID, projectID)
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `go test ./internal/feature/activity/ -run TestService`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add services/aep-api/internal/feature/activity/ports.go services/aep-api/internal/feature/activity/service.go services/aep-api/internal/feature/activity/service_test.go
git commit -m "feat(aep-api): activity service (best-effort record, keyset list, live-tail)"
```

### Task 1.6: Wire the service into the composition root + Deps

**Files:**
- Modify: `services/aep-api/internal/api/deps.go:45-68`
- Modify: `services/aep-api/internal/app/app.go` (near :117 and :825-846)

- [ ] **Step 1: Add the `ActivitySvc` field to `api.Deps`**

In `internal/api/deps.go`, add the import and field. Import block — add:

```go
	"github.com/wso2/aep/aep-api/internal/feature/activity"
```

In the `Deps` struct, add (next to `TaskStream`):

```go
	ActivitySvc         *activity.Service
```

- [ ] **Step 2: Construct the repo, hub, and service in app.go**

In `internal/app/app.go`, in the `// Repositories` block (~line 117, after `workflowRunRepo`):

```go
	workflowRunRepo := repositories.NewWorkflowRunRepository(db)
	activityRepo := repositories.NewActivityEventRepository(db)
	activityHub := activity.NewHub()
	activitySvc := activity.NewService(activityRepo, activityHub)
```

Add the import at the top of app.go if not present:

```go
	"github.com/wso2/aep/aep-api/internal/feature/activity"
```

- [ ] **Step 3: Assign it into `params.Deps`**

In the `params.Deps = api.Deps{...}` literal (~line 825), add:

```go
		ActivitySvc:      activitySvc,
```

- [ ] **Step 4: Verify the whole service builds**

Run: `go build ./...`
Expected: no output, exit 0.

- [ ] **Step 5: Run the full activity + repositories test suites**

Run: `go test ./internal/feature/activity/... ./repositories/...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/aep-api/internal/api/deps.go services/aep-api/internal/app/app.go
git commit -m "feat(aep-api): wire activity service into Deps"
```

**Milestone 1 done:** a tested, injected activity store + service. `git log --oneline -6` shows the six commits. Nothing records or reads yet — that's Milestones 2–4.

---

## Milestone 2 — Event producers

Events start flowing. **Emission architecture (settled after backend survey):**
- `spec_published` → the **`BuildProject` HTTP handler** (`handlers_build.go`) — the real publish path (NOT `design.SaveAndProceed`, which has no live caller). Only here is a real user JWT in scope, so this is the one event with a **user** actor.
- `plan_derived`, `task_started`, `task_deployed`, `task_failed` → the **Temporal devflow workflows**, via one new `RecordActivity` activity. The workflow is the single authoritative place that observes every task transition (build/deploy signals resolve there); activities have real ctx + DB, workflows don't. No user JWT exists inside a workflow, so these use a hardcoded **agent** actor ("Plan agent" / "Build agent"). Deterministic timestamps via `workflow.Now(ctx)`; the dedup key makes a workflow retry a harmless no-op.

Titles for task events are resolved inside the activity (the workflow input has no title) via a narrow `TaskTitleReader` port over the existing task reads.

### Task 2.1: `RecordActivity` devflow activity + deps

**Files:**
- Modify: `services/aep-api/internal/feature/devflow/activities.go` (add deps + activity)
- Test: `services/aep-api/internal/feature/devflow/activities_test.go` (add a focused test if the file exists; else create it)

- [ ] **Step 1: Add the `ActivityRecorder` + `TaskTitleReader` ports and fields**

In `activities.go`, add near the other port interfaces:

```go
// ActivityRecorder appends a project activity event (best-effort). The devflow
// activities call it from a real activity ctx (DB-capable), never from workflow
// code. Satisfied by *activity.Service.
type ActivityRecorder interface {
	Record(ctx context.Context, e activity.Event)
}

// TaskTitleReader resolves a Task's human title for a task-* activity line
// (the workflow input carries no title). "" when unknown — the line degrades to
// just "#<issue>". Satisfied by an app-level adapter over *task.Reads.
type TaskTitleReader interface {
	TitleFor(ctx context.Context, orgID, projectID string, issue int) string
}
```

Add both to `Activities` and `Deps`, and wire them in `NewActivities`:

```go
type Activities struct {
	runs               WorkflowRunStore
	dispatcher         CodingDispatcher
	merger             PRMerger
	spec               SpecValidator
	planner            Planner
	validator          Validator
	validationResolver ValidationResolver
	provisioner        BuildProvisioner
	recorder           ActivityRecorder // may be nil (best-effort)
	titles             TaskTitleReader  // may be nil
}

type Deps struct {
	Runs               WorkflowRunStore
	Dispatcher         CodingDispatcher
	Merger             PRMerger
	Spec               SpecValidator
	Planner            Planner
	Validator          Validator
	ValidationResolver ValidationResolver
	Provisioner        BuildProvisioner
	Recorder           ActivityRecorder
	Titles             TaskTitleReader
}

func NewActivities(d Deps) *Activities {
	return &Activities{
		runs:               d.Runs,
		dispatcher:         d.Dispatcher,
		merger:             d.Merger,
		spec:               d.Spec,
		planner:            d.Planner,
		validator:          d.Validator,
		validationResolver: d.ValidationResolver,
		provisioner:        d.Provisioner,
		recorder:           d.Recorder,
		titles:             d.Titles,
	}
}
```

Add the import: `"github.com/wso2/aep/aep-api/internal/feature/activity"`.

- [ ] **Step 2: Add the activity input + method**

```go
// RecordActivityInput is a workflow → activity payload for one project activity
// event. OccurredAtUnix is workflow.Now(ctx).Unix() so the row's time is
// deterministic across workflow replay. DedupKey makes a retry a no-op.
type RecordActivityInput struct {
	Type          string `json:"type"`
	OrgID         string `json:"orgId"`
	ProjectID     string `json:"projectId"`
	Tag           string `json:"tag,omitempty"`
	Issue         int    `json:"issue,omitempty"`
	Component     string `json:"component,omitempty"`
	Count         int    `json:"count,omitempty"` // plan_derived: number of tasks
	ActorKind     string `json:"actorKind"`
	ActorID       string `json:"actorId,omitempty"`
	ActorName     string `json:"actorName"`
	DedupKey      string `json:"dedupKey"`
	OccurredAtUnix int64 `json:"occurredAtUnix"`
}

// RecordActivity appends one project activity event (best-effort). Resolves the
// Task title for task-* events when Issue > 0. Never returns an error that
// should fail the workflow — recording is observational.
func (a *Activities) RecordActivity(ctx context.Context, in RecordActivityInput) error {
	if a.recorder == nil {
		return nil
	}
	title := ""
	if in.Issue > 0 && a.titles != nil {
		title = a.titles.TitleFor(ctx, in.OrgID, in.ProjectID, in.Issue)
	}
	a.recorder.Record(ctx, activity.Event{
		OrgID:     in.OrgID,
		ProjectID: in.ProjectID,
		Type:      in.Type,
		ActorKind: in.ActorKind,
		ActorID:   in.ActorID,
		ActorName: in.ActorName,
		Issue:     in.Issue,
		Title:     title,
		Component: in.Component,
		Tag:       in.Tag,
		DedupKey:  in.DedupKey,
		OccurredAt: time.Unix(in.OccurredAtUnix, 0).UTC(),
	})
	return nil
}
```

Add `"time"` to imports if not present.

- [ ] **Step 2b: Write a focused test** (fake recorder captures the mapped Event)

```go
func TestRecordActivity_mapsAndResolvesTitle(t *testing.T) {
	rec := &captureRecorder{}
	acts := NewActivities(Deps{
		Recorder: rec,
		Titles:   titleReaderFunc(func(_ context.Context, _, _ string, issue int) string { return "Catalog" }),
	})
	err := acts.RecordActivity(context.Background(), RecordActivityInput{
		Type: models.ActivityTypeTaskDeployed, OrgID: "o", ProjectID: "p", Tag: "v1-1",
		Issue: 10, ActorKind: models.ActivityActorAgent, ActorID: "build-agent",
		ActorName: "Build agent", DedupKey: "task:repo#10:v1-1:deployed", OccurredAtUnix: 1_700_000_000,
	})
	if err != nil {
		t.Fatalf("RecordActivity: %v", err)
	}
	if len(rec.got) != 1 || rec.got[0].Title != "Catalog" || rec.got[0].Type != models.ActivityTypeTaskDeployed {
		t.Fatalf("unexpected recorded event: %+v", rec.got)
	}
}

type captureRecorder struct{ got []activity.Event }
func (c *captureRecorder) Record(_ context.Context, e activity.Event) { c.got = append(c.got, e) }
type titleReaderFunc func(context.Context, string, string, int) string
func (f titleReaderFunc) TitleFor(ctx context.Context, o, p string, i int) string { return f(ctx, o, p, i) }
```

- [ ] **Step 3: Run to verify** (fails first — no `RecordActivity` — then passes after Step 1-2)

Run: `go test ./internal/feature/devflow/ -run TestRecordActivity`
Expected: PASS after implementation.

- [ ] **Step 4: Commit**

```bash
git add services/aep-api/internal/feature/devflow/activities.go services/aep-api/internal/feature/devflow/activities_test.go
git commit -m "feat(aep-api): RecordActivity devflow activity + recorder/title deps"
```

### Task 2.2: Dispatch `plan_derived` from the dev workflow

**Files:**
- Modify: `services/aep-api/internal/feature/devflow/workflow_dev.go` (after planning, ~line 165)

- [ ] **Step 1: Dispatch the activity after a successful plan**

Immediately after the `RunPlan` result is validated (after the dep-cycle check, ~line 168), add:

```go
	// Record the plan_derived milestone (best-effort, deduped by tag so a
	// workflow retry is a no-op). Uses a short activity option — recording must
	// not gate the build.
	_ = workflow.ExecuteActivity(recordActivityOpts(ctx), (*Activities).RecordActivity, RecordActivityInput{
		Type:      models.ActivityTypePlanDerived,
		OrgID:     in.OrgID,
		ProjectID: in.ProjectID,
		Tag:       reqTag,
		Count:     len(tasks),
		ActorKind: models.ActivityActorAgent,
		ActorID:   "plan-agent",
		ActorName: "Plan agent",
		DedupKey:  "plan:" + in.ProjectID + ":" + reqTag + ":derived",
		OccurredAtUnix: workflow.Now(ctx).Unix(),
	}).Get(ctx, nil)
```

Define `recordActivityOpts` next to the existing `planActivityOpts`/`countsActivityOpts` (a short-timeout, retryable ActivityOptions — mirror `countsActivityOpts`):

```go
// recordActivityOpts: short, best-effort activity for appending a project
// activity event. A failure never fails the build (the caller ignores the error).
func recordActivityOpts(ctx workflow.Context) workflow.Context {
	return workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		RetryPolicy:         &temporal.RetryPolicy{MaximumAttempts: 3},
	})
}
```

(Import `go.temporal.io/sdk/temporal` and `"github.com/wso2/aep/aep-api/models"` if not present — check the existing `*ActivityOpts` for the exact style and reuse it.)

- [ ] **Step 2: Verify it compiles**

Run: `go build ./internal/feature/devflow/...`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add services/aep-api/internal/feature/devflow/workflow_dev.go
git commit -m "feat(aep-api): emit plan_derived activity after planning"
```

### Task 2.3: Dispatch `task_started` / `task_deployed` / `task_failed` from the task workflow

**Files:**
- Modify: `services/aep-api/internal/feature/devflow/workflow_task.go`

- [ ] **Step 1: Add a small workflow-local helper** at the top of `TaskFlowWorkflow` (captures `in` + `ctx`)

```go
	recordTask := func(evType, dedupSuffix string) {
		_ = workflow.ExecuteActivity(recordActivityOpts(ctx), (*Activities).RecordActivity, RecordActivityInput{
			Type:      evType,
			OrgID:     in.OrgID,
			ProjectID: in.ProjectID,
			Tag:       in.Tag,
			Issue:     in.Issue,
			ActorKind: models.ActivityActorAgent,
			ActorID:   "build-agent",
			ActorName: "Build agent",
			DedupKey:  fmt.Sprintf("task:%s#%d:%s:%s", in.Repo, in.Issue, in.Tag, dedupSuffix),
			OccurredAtUnix: workflow.Now(ctx).Unix(),
		}).Get(ctx, nil)
	}
```

- [ ] **Step 2: Call it at the three transitions**

- In the `fail` closure (before it returns), add `recordTask(models.ActivityTypeTaskFailed, "failed")`.
- Right after the coding phase is entered (after the `GateStartCoding` await passes / before `runCodingPhase`), add `recordTask(models.ActivityTypeTaskStarted, "started")`.
- At the success path (just before `return TaskFlowResult{Issue: in.Issue, Outcome: OutcomeSucceeded}`), add `recordTask(models.ActivityTypeTaskDeployed, "deployed")`.

(Add `"fmt"` and `"github.com/wso2/aep/aep-api/models"` imports if absent.)

- [ ] **Step 3: Verify it compiles**

Run: `go build ./internal/feature/devflow/...`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add services/aep-api/internal/feature/devflow/workflow_task.go
git commit -m "feat(aep-api): emit task_started/deployed/failed activities"
```

### Task 2.4: Emit `spec_published` from the BuildProject handler

**Files:**
- Modify: `services/aep-api/internal/api/handlers_build.go:41-55`

- [ ] **Step 1: Record after a successful build start** (real user actor)

Replace the success tail of `BuildProject` so it records before returning the tag. The actor is the signed-in user (id = email so the console can render "You"):

```go
	tag, failures, err := s.deps.BuildSvc.Run(ctx, org, request.ProjectName, inputs)
	if err != nil {
		return nil, mapBuildRunError(err)
	}
	if len(failures) > 0 {
		return apigen.BuildProject200JSONResponse(apigen.BuildResponse{Failures: toInputFailures(failures)}), nil
	}
	// spec_published: the user published a spec version and kicked off the build.
	// Best-effort; the ActivitySvc swallows storage errors. Actor = the signed-in
	// user (email id → the console renders "You" for the author).
	if s.deps.ActivitySvc != nil && tag != "" {
		email, name := userIdentityFromContext(ctx)
		s.deps.ActivitySvc.Record(ctx, activity.Event{
			OrgID:     org,
			ProjectID: request.ProjectName,
			Type:      models.ActivityTypeSpecPublished,
			ActorKind: models.ActivityActorUser,
			ActorID:   email,
			ActorName: name,
			Tag:       tag,
			DedupKey:  "spec:" + request.ProjectName + ":" + tag + ":published",
			OccurredAt: time.Now().UTC(),
		})
	}
	return apigen.BuildProject200JSONResponse(apigen.BuildResponse{Tag: tag}), nil
```

- [ ] **Step 2: Add the `userIdentityFromContext` helper**

The collab handlers already extract display identity via `requirements.ParseDisplayIdentity(authHeader)`; the strict handler has the claims in ctx. Add a small helper (place in `handlers_build.go` or a shared `handlers.go`). Prefer claims from ctx; fall back to `auth.ActorFromContext`:

```go
// userIdentityFromContext returns (email, displayName) for the signed-in user,
// for stamping a user-actor activity event. Falls back to the JWT subject when
// name/email claims are absent. The email doubles as the stable actor id (it is
// what the console's #130 "You" comparison keys on).
func userIdentityFromContext(ctx context.Context) (email, name string) {
	if c := auth.ClaimsFromContext(ctx); c != nil {
		email = c.Email
		name = c.Name
		if email == "" {
			email = c.Subject
		}
		if name == "" {
			name = email
		}
		return email, name
	}
	return "", "You"
}
```

Verify the actual `auth.Claims` field names (`Email`/`Name`/`Subject`) in `internal/platform/auth/` and adjust; if claims lack Email/Name, wire `requirements.ParseDisplayIdentity` the way `handlers_collab.go` does (it reads the Authorization header off the request). Add imports: `activity`, `models`, `auth`, `time`.

- [ ] **Step 3: Verify it compiles + run the build handler component test**

Run: `go build ./... && go test ./internal/api/ -run BuildProject`
Expected: exit 0; existing BuildProject tests still pass (they pass a nil `ActivitySvc`, so the guard skips emission).

- [ ] **Step 4: Commit**

```bash
git add services/aep-api/internal/api/handlers_build.go
git commit -m "feat(aep-api): emit spec_published on build start (user actor)"
```

### Task 2.5: Wire the recorder + title reader into devflow at the composition root

**Files:**
- Modify: `services/aep-api/internal/app/app.go` (the `devflow.NewActivities(devflow.Deps{...})` literal ~line 1095)
- Modify: `services/aep-api/internal/app/devflow_adapters.go` (add the title-reader adapter)

- [ ] **Step 1: Add a `TaskTitleReader` adapter over the existing task reads**

In `devflow_adapters.go`, add (mirroring the existing `devflowPlanner` adapter which already wraps `*task.Reads`):

```go
// devflowTitles resolves a Task's title for activity lines, over task.Reads.
type devflowTitles struct{ reads *task.Reads }

func (t devflowTitles) TitleFor(ctx context.Context, orgID, projectID string, issue int) string {
	d, err := t.reads.Get(ctx, orgID, projectID, issue) // use the existing single-task read; adjust name to the real method
	if err != nil || d == nil {
		return ""
	}
	return d.Title
}
```

(Confirm the single-task read method on `*task.Reads` — the plan's Milestone-1 survey noted `TaskDetail`/`buildView`; use whatever returns a title for one issue. If only a list read exists, filter it.)

- [ ] **Step 2: Inject both into `devflow.Deps`**

In `app.go`, extend the `devflow.NewActivities(devflow.Deps{...})` literal:

```go
		devflowActs := devflow.NewActivities(devflow.Deps{
			Runs:               workflowRunRepo,
			Dispatcher:         codingDispatcher{funnel: funnel, execs: executionRepo},
			Merger:             prMerger{issues: issueService},
			Spec:               devflowSpecValidator{art: artifactSvcGit},
			Planner:            devflowPlanner{plan: taskPlan, reads: taskReads},
			Validator:          devflowValidator{store: artifactStore, comp: componentService},
			ValidationResolver: devflowValidationResolver{svc: validationSvc, art: artifactSvcGit},
			Provisioner:        buildProvisioner{design: designService, prov: provisioningSvc},
			Recorder:           activitySvc,
			Titles:             devflowTitles{reads: taskReads},
		})
```

- [ ] **Step 3: Verify the whole service builds + the devflow suite passes**

Run: `go build ./... && go test ./internal/feature/devflow/...`
Expected: exit 0, PASS.

- [ ] **Step 4: Commit**

```bash
git add services/aep-api/internal/app/app.go services/aep-api/internal/app/devflow_adapters.go
git commit -m "feat(aep-api): wire activity recorder + title reader into devflow"
```

**Milestone 2 done:** the five v1 events are recorded at their choke points, deduped and best-effort. Verify manually against a real build if a dev environment is available (publish a spec → a build → watch rows appear: `SELECT type, actor_name, issue, occurred_at FROM activity_events ORDER BY occurred_at DESC LIMIT 10;`).

---

## Milestone 3 — Read endpoint (`GET /projects/{p}/activity`)

Contract-first. The wire shape is a feed object `{ items: ActivityEvent[], nextBefore?: {occurredAt, id} }` so the console has a cursor for "show more" without parsing rows.

### Task 3.1: Add the contract

**Files:**
- Modify: `packages/contracts/api/v1/openapi.yaml`

- [ ] **Step 1: Add the path** under `paths:` (alongside `/projects/{projectName}/tasks`), following the `list-tasks` shape with `limit`/`before` query params:

```yaml
  /projects/{projectName}/activity:
    get:
      operationId: list-activity
      parameters:
      - description: Project name (DNS-label slug)
        in: path
        name: projectName
        required: true
        schema:
          description: Project name (DNS-label slug)
          type: string
      - description: Max events to return (default 50, max 200).
        explode: false
        in: query
        name: limit
        schema:
          description: Max events to return (default 50, max 200).
          format: int64
          type: integer
      - description: 'Keyset cursor: return events strictly older than this occurredAt (RFC3339); pair with beforeId.'
        explode: false
        in: query
        name: before
        schema:
          description: 'Keyset cursor: occurredAt of the last event seen.'
          type: string
      - description: 'Keyset cursor tiebreak: the id of the last event seen (pair with before).'
        explode: false
        in: query
        name: beforeId
        schema:
          type: string
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ActivityFeed'
          description: OK
        default:
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
          description: Error
      security:
      - userJWT: []
      summary: List a project's activity events (newest first, cursor-paginated)
      tags:
      - Projects
```

- [ ] **Step 2: Add the schemas** under `components: schemas:`:

```yaml
    ActivityEvent:
      additionalProperties: false
      description: One project activity event (issue #239). The console renders the line from these structured facts; tone is derived client-side from type.
      properties:
        id:
          type: string
        type:
          enum: [spec_published, plan_derived, task_started, task_deployed, task_failed]
          type: string
          x-go-type: string
        actorKind:
          enum: [user, agent]
          type: string
          x-go-type: string
        actorId:
          type: string
        actorName:
          type: string
        issue:
          format: int64
          type: integer
        title:
          type: string
        component:
          type: string
        environment:
          type: string
        tag:
          type: string
        occurredAt:
          format: date-time
          type: string
      required:
      - id
      - type
      - actorKind
      - actorName
      - occurredAt
      type: object
    ActivityFeed:
      additionalProperties: false
      description: A page of activity events plus the cursor for the next (older) page.
      properties:
        items:
          items:
            $ref: '#/components/schemas/ActivityEvent'
          type: array
          nullable: true
        nextBefore:
          description: occurredAt cursor for the next page; absent when there are no older events.
          type: string
        nextBeforeId:
          description: id cursor tiebreak for the next page.
          type: string
      required:
      - items
      type: object
```

- [ ] **Step 3: Regenerate + verify**

Run: `cd services/aep-api && make gen-api && cd ../.. && make gen`
Expected: `apigen/server_gen.go` gains `ListActivity` on the `ServerInterface`; console types refresh. `git diff --stat` shows the generated files changed.

Then: `cd services/aep-api && go build ./...`
Expected: **FAIL** — `*apiServer` no longer satisfies `apigen.ServerInterface` (missing `ListActivity`). This compile error is expected and drives Task 3.2.

- [ ] **Step 4: Commit the contract + generated code**

```bash
git add packages/contracts/api/v1/openapi.yaml services/aep-api/internal/api/apigen/ apps/console/src/generated/aep-api.d.ts
git commit -m "feat(contracts): GET /projects/{p}/activity + ActivityEvent/ActivityFeed"
```

### Task 3.2: The read handler

**Files:**
- Create: `services/aep-api/internal/api/handlers_activity.go`
- Test: `services/aep-api/internal/api/handlers_activity_test.go`

- [ ] **Step 1: Write the failing component test** (mirrors `handlers_task` tests — a fake ActivitySvc, assert JSON shape)

```go
// ... Apache header ...
package api

import (
	"context"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/api/apigen"
	"github.com/wso2/aep/aep-api/models"
)

func TestListActivity_returnsNewestFirstWithCursor(t *testing.T) {
	now := time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC)
	svc := newTestActivityService(t, []models.ActivityEvent{
		{ID: "b", Type: models.ActivityTypeTaskDeployed, ActorKind: "agent", ActorName: "Build agent", Issue: 10, Title: "Catalog", OccurredAt: now},
		{ID: "a", Type: models.ActivityTypeSpecPublished, ActorKind: "user", ActorName: "You", Tag: "v1-1", OccurredAt: now.Add(-time.Minute)},
	})
	s := &apiServer{deps: Deps{ActivitySvc: svc}}
	ctx := withBoundOrg(context.Background(), "org1") // use the test helper the other handler tests use

	resp, err := s.ListActivity(ctx, apigen.ListActivityRequestObject{ProjectName: "proj1"})
	if err != nil {
		t.Fatalf("ListActivity: %v", err)
	}
	body, ok := resp.(listActivityJSONResponse)
	if !ok {
		t.Fatalf("wrong response type %T", resp)
	}
	if len(body.Items) != 2 || body.Items[0].Id != "b" {
		t.Fatalf("want newest first, got %+v", body.Items)
	}
}
```

(`newTestActivityService` / `withBoundOrg` — use the harness the sibling `handlers_*_test.go` files already use to build a service over an in-memory/dbtest store and to bind an org onto ctx. If none exists for activity, construct `activity.NewService` over a `dbtest` repo.)

- [ ] **Step 2: Run to verify it fails**

Run: `go test ./internal/api/ -run TestListActivity`
Expected: FAIL — `s.ListActivity` undefined.

- [ ] **Step 3: Write the handler**

```go
// ... Apache header ...
package api

import (
	"context"
	"net/http"
	"time"

	"github.com/wso2/aep/aep-api/internal/api/apigen"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
)

// ListActivity serves GET /projects/{projectName}/activity: a project's
// activity feed, newest first, cursor-paginated. The body is the feature's own
// view (models.ActivityEvent marshaled verbatim) via a hand-written Visit —
// same escape hatch as ListTasks, so optional fields stay clean on the wire.
func (s *apiServer) ListActivity(ctx context.Context, request apigen.ListActivityRequestObject) (apigen.ListActivityResponseObject, error) {
	if s.deps.ActivitySvc == nil {
		return nil, errServiceUnavailable("activity not configured")
	}
	org := tenant.BoundOrgFromContext(ctx)

	limit := 0
	if request.Params.Limit != nil {
		limit = int(*request.Params.Limit)
	}
	var beforeTime time.Time
	beforeID := ""
	if request.Params.Before != "" {
		if t, err := time.Parse(time.RFC3339Nano, request.Params.Before); err == nil {
			beforeTime = t
			beforeID = request.Params.BeforeId
		}
	}

	rows, err := s.deps.ActivitySvc.List(ctx, org, request.ProjectName, limit, beforeTime, beforeID)
	if err != nil {
		return nil, errInternal("failed to load activity")
	}
	return activityFeedResponse(rows), nil
}

// activityFeedResponse marshals the feed + next-page cursor. The cursor is the
// oldest row returned when the page is full-ish (the client asks for more with it).
type listActivityJSONResponse struct {
	Items        []models.ActivityEvent `json:"items"`
	NextBefore   string                 `json:"nextBefore,omitempty"`
	NextBeforeId string                 `json:"nextBeforeId,omitempty"`
}

func activityFeedResponse(rows []models.ActivityEvent) listActivityJSONResponse {
	out := listActivityJSONResponse{Items: rows}
	if n := len(rows); n > 0 {
		last := rows[n-1]
		out.NextBefore = last.OccurredAt.UTC().Format(time.RFC3339Nano)
		out.NextBeforeId = last.ID
	}
	return out
}

func (r listActivityJSONResponse) VisitListActivityResponse(w http.ResponseWriter) error {
	return writeJSONBody(w, http.StatusOK, r)
}
```

- [ ] **Step 4: Run to verify it passes + full build**

Run: `go build ./... && go test ./internal/api/ -run TestListActivity`
Expected: exit 0, PASS.

- [ ] **Step 5: Commit**

```bash
git add services/aep-api/internal/api/handlers_activity.go services/aep-api/internal/api/handlers_activity_test.go
git commit -m "feat(aep-api): GET /projects/{p}/activity read handler"
```

**Milestone 3 done:** the feed is readable. `curl` (with a userJWT) `GET /api/v1/projects/<p>/activity` returns the newest events.

---

## Milestone 4 — SSE live tail (`GET /projects/{p}/activity/stream`)

Replay the recent page, then tail the hub. Reuses `sseStream` + the Milestone-1 hub. Frame format: one `data:` JSON `ActivityEvent` per line, `id: <occurredAt>|<id>`, `: keep-alive` comments, no `[DONE]` (the feed never "settles" — the client tails until it navigates away).

### Task 4.1: Add the stream contract

**Files:**
- Modify: `packages/contracts/api/v1/openapi.yaml`

- [ ] **Step 1: Add the path** (SSE, mirroring `stream-task-log`; the frame schema is the same `ActivityEvent`):

```yaml
  /projects/{projectName}/activity/stream:
    get:
      operationId: stream-activity
      parameters:
      - description: Project name (DNS-label slug)
        in: path
        name: projectName
        required: true
        schema:
          description: Project name (DNS-label slug)
          type: string
      - description: 'SSE resume cursor: the last frame id seen (occurredAt|id). Replay resumes after it.'
        in: header
        name: Last-Event-ID
        schema:
          type: string
      responses:
        '200':
          content:
            text/event-stream:
              schema:
                $ref: '#/components/schemas/ActivityEvent'
          description: 'SSE stream of the project''s activity feed: an initial replay of recent events (newest first is reversed to oldest-first on the wire so the client appends in order), then a live tail as new events are recorded. One data: JSON ActivityEvent per frame, id: occurredAt|id. Reconnect-safe: the client dedups by id.'
        default:
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
          description: Error
      security:
      - userJWT: []
      summary: Stream a project's activity feed (replay + live tail) as SSE
      tags:
      - Projects
```

- [ ] **Step 2: Regenerate + commit**

Run: `cd services/aep-api && make gen-api && cd ../.. && make gen`
Then build (expect the missing-`StreamActivity` compile error), then:

```bash
git add packages/contracts/api/v1/openapi.yaml services/aep-api/internal/api/apigen/ apps/console/src/generated/aep-api.d.ts
git commit -m "feat(contracts): GET /projects/{p}/activity/stream (SSE)"
```

### Task 4.2: The stream connection loop

**Files:**
- Create: `services/aep-api/internal/feature/activity/stream.go`
- Test: `services/aep-api/internal/feature/activity/stream_test.go`

- [ ] **Step 1: Write the failing test** (a subscribe→notify→re-read cycle emits a frame)

```go
// ... Apache header ...
package activity

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/models"
)

func TestOpenStream_replaysThenTails(t *testing.T) {
	repo := &fakeRepo{}
	// seed one existing event
	repo.inserted = append(repo.inserted, &models.ActivityEvent{ID: "a", Type: models.ActivityTypeSpecPublished, ActorKind: "user", ActorName: "You", OccurredAt: time.Now()})
	svc := NewService(repo, NewHub())

	var sb strings.Builder
	ctx, cancel := context.WithCancel(context.Background())
	run := svc.OpenStream(ctx, "org1", "proj1", "")
	go run(&sb, func() {})
	// give the replay a beat, then stop
	time.Sleep(50 * time.Millisecond)
	cancel()
	if !strings.Contains(sb.String(), `"id":"a"`) {
		t.Fatalf("replay frame missing: %q", sb.String())
	}
}
```

(Adjust `fakeRepo.ListByProject` to return `repo.inserted` filtered/ordered so the replay has data.)

- [ ] **Step 2: Run to verify it fails**

Run: `go test ./internal/feature/activity/ -run TestOpenStream`
Expected: FAIL — `svc.OpenStream` undefined.

- [ ] **Step 3: Write the stream loop** (mirrors the task-stream connection contract: subscribe, replay from cursor, then drain the hub with a keep-alive tick)

```go
// ... Apache header ...
package activity

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/wso2/aep/aep-api/models"
)

const keepAlive = 20 * time.Second

// OpenStream returns a connection loop (for sseStream): replay the recent feed
// oldest-first from the resume cursor, then tail the hub — re-reading and
// emitting any events newer than the last one sent — until the ctx is canceled
// (client disconnect). Reconnect-safe: the client dedups by id.
func (s *Service) OpenStream(ctx context.Context, orgID, projectID, lastEventID string) func(w io.Writer, flush func()) {
	return func(w io.Writer, flush func()) {
		ch, cancel := s.Subscribe(orgID, projectID)
		defer cancel()

		lastTime, lastID := parseCursor(lastEventID)

		emitNewer := func() {
			// Read a page newest-first, reverse to oldest-first, emit those
			// strictly newer than (lastTime, lastID).
			rows, err := s.repo.ListByProject(ctx, orgID, projectID, defaultLimit, time.Time{}, "")
			if err != nil {
				return
			}
			for i := len(rows) - 1; i >= 0; i-- {
				r := rows[i]
				if !newer(r, lastTime, lastID) {
					continue
				}
				writeFrame(w, r)
				lastTime, lastID = r.OccurredAt, r.ID
			}
			flush()
		}

		emitNewer() // initial replay
		ticker := time.NewTicker(keepAlive)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ch:
				emitNewer()
			case <-ticker.C:
				_, _ = io.WriteString(w, ": keep-alive\n\n")
				flush()
			}
		}
	}
}

func writeFrame(w io.Writer, r models.ActivityEvent) {
	b, err := json.Marshal(r)
	if err != nil {
		return
	}
	fmt.Fprintf(w, "id: %s|%s\n", r.OccurredAt.UTC().Format(time.RFC3339Nano), r.ID)
	fmt.Fprintf(w, "data: %s\n\n", b)
}

func newer(r models.ActivityEvent, lastTime time.Time, lastID string) bool {
	if lastTime.IsZero() {
		return true
	}
	if r.OccurredAt.After(lastTime) {
		return true
	}
	return r.OccurredAt.Equal(lastTime) && r.ID > lastID
}

func parseCursor(lastEventID string) (time.Time, string) {
	if lastEventID == "" {
		return time.Time{}, ""
	}
	for i := 0; i < len(lastEventID); i++ {
		if lastEventID[i] == '|' {
			if t, err := time.Parse(time.RFC3339Nano, lastEventID[:i]); err == nil {
				return t, lastEventID[i+1:]
			}
			break
		}
	}
	return time.Time{}, ""
}
```

Note: `s.repo` is used directly here — it is already a field on `Service`. (If you prefer to keep `repo` private-and-unused-elsewhere, add a small `func (s *Service) recent(ctx, org, proj)` wrapper; either compiles.)

- [ ] **Step 4: Run to verify + build**

Run: `go build ./... && go test ./internal/feature/activity/ -run TestOpenStream`
Expected: exit 0, PASS.

- [ ] **Step 5: Commit**

```bash
git add services/aep-api/internal/feature/activity/stream.go services/aep-api/internal/feature/activity/stream_test.go
git commit -m "feat(aep-api): activity SSE stream loop (replay + hub tail)"
```

### Task 4.3: The stream handler

**Files:**
- Modify: `services/aep-api/internal/api/handlers_activity.go`

- [ ] **Step 1: Add the handler + Visit response** (mirrors `StreamTaskLog` / `taskLogStreamResponse`)

```go
// StreamActivity serves GET /projects/{projectName}/activity/stream: the
// project's activity feed as SSE (replay + live tail). The loop runs inside
// the Visit method after the handler returns (the request ctx stays alive until
// the client disconnects).
func (s *apiServer) StreamActivity(ctx context.Context, request apigen.StreamActivityRequestObject) (apigen.StreamActivityResponseObject, error) {
	if s.deps.ActivitySvc == nil {
		return nil, errServiceUnavailable("activity not configured")
	}
	org := tenant.BoundOrgFromContext(ctx)
	lastEventID := ""
	if request.Params.LastEventID != nil {
		lastEventID = *request.Params.LastEventID
	}
	run := s.deps.ActivitySvc.OpenStream(ctx, org, request.ProjectName, lastEventID)
	return activityStreamResponse{run: run}, nil
}

type activityStreamResponse struct {
	run func(w io.Writer, flush func())
}

func (r activityStreamResponse) VisitStreamActivityResponse(w http.ResponseWriter) error {
	return sseStream(w, r.run)
}
```

(Add the `io` import. The generated `request.Params.LastEventID` name follows oapi-codegen's header-param naming — confirm from `server_gen.go` after gen; it may be `LastEventID` or `LastEventId`.)

- [ ] **Step 2: Build + run the api suite**

Run: `go build ./... && go test ./internal/api/...`
Expected: exit 0, PASS.

- [ ] **Step 3: Commit**

```bash
git add services/aep-api/internal/api/handlers_activity.go
git commit -m "feat(aep-api): GET /projects/{p}/activity/stream handler"
```

**Milestone 4 done:** the backend is complete. `curl -N` the stream endpoint and trigger an event — the frame appears live.

---

## Milestone 5 — Frontend cutover

Swap the derived feed for the real endpoint + SSE tail. Clean cutover: delete `agentActivity()` and `PLACEHOLDER_TIMES`. Render the sentence (viewer-relative "You") + tone client-side from `type`.

### Task 5.1: Query keys + read hook

**Files:**
- Create: `apps/console/src/features/activity/api/keys.ts`
- Create: `apps/console/src/features/activity/api/queries.ts`

- [ ] **Step 1: Keys** (root-anchored under the project detail so `projectKeys.detail(name)` invalidation cascades):

```typescript
// ... Apache header ...
export const activityKeys = {
  all: (projectName: string) =>
    ["projects", "detail", projectName, "activity"] as const,
  list: (projectName: string) =>
    [...activityKeys.all(projectName), "list"] as const,
};
```

- [ ] **Step 2: Read hook** (initial page; the SSE hook in 5.3 tails from here):

```typescript
// ... Apache header ...
import { useQuery } from "@tanstack/react-query";
import { client } from "../../../api/client";
import { apiErrorMessage } from "../../../api/errors";
import { activityKeys } from "./keys";

// Initial page of the project's activity feed. Liveness comes from the SSE tail
// (useActivityFeed), so this doesn't poll — it just seeds the list.
export function useProjectActivity(projectName: string) {
  return useQuery({
    queryKey: activityKeys.list(projectName),
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/projects/{projectName}/activity",
        { params: { path: { projectName } } },
      );
      if (error || data === undefined) {
        throw new Error(apiErrorMessage(error, "Failed to load activity"));
      }
      return data.items ?? [];
    },
  });
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `cd apps/console && pnpm exec tsc --noEmit`
Expected: exit 0. (The generated `paths` include `/projects/{projectName}/activity` from Milestone 3.)

```bash
git add apps/console/src/features/activity/api/keys.ts apps/console/src/features/activity/api/queries.ts
git commit -m "feat(console): activity feed read hook + keys"
```

### Task 5.2: The render map (type → sentence + tone)

**Files:**
- Create: `apps/console/src/features/activity/lib/render.tsx`
- Test: `apps/console/src/features/activity/lib/render.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, expect, it } from "vitest";
import { activityLine } from "./render";
import type { components } from "../../../generated/aep-api";
type ActivityEvent = components["schemas"]["ActivityEvent"];

const ev = (o: Partial<ActivityEvent>): ActivityEvent => ({
  id: "1", type: "task_deployed", actorKind: "agent", actorName: "Build agent",
  occurredAt: "2026-07-17T12:00:00Z", ...o,
});

describe("activityLine", () => {
  it("renders a deployed task line", () => {
    const l = activityLine(ev({ issue: 10, title: "Catalog" }), "me@x.com");
    expect(l.actor).toBe("Build agent");
    expect(l.text).toBe("deployed #10 Catalog");
    expect(l.tone).toBe("success");
  });
  it("renders 'You' for the viewer's own user event", () => {
    const l = activityLine(
      ev({ type: "spec_published", actorKind: "user", actorId: "me@x.com", actorName: "Kanushka", tag: "v1-1" }),
      "me@x.com",
    );
    expect(l.actor).toBe("You");
    expect(l.text).toBe("published spec v1-1 and started build");
  });
  it("renders a teammate's name for others", () => {
    const l = activityLine(
      ev({ type: "spec_published", actorKind: "user", actorId: "her@x.com", actorName: "Sam", tag: "v1-1" }),
      "me@x.com",
    );
    expect(l.actor).toBe("Sam");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/features/activity/lib/render.test.ts`
Expected: FAIL — cannot resolve `./render`.

- [ ] **Step 3: Implement the render map**

```tsx
// ... Apache header ...
import type { StatusTone } from "../../../components/StatusChip";
import type { components } from "../../../generated/aep-api";

type ActivityEvent = components["schemas"]["ActivityEvent"];

export interface ActivityLine {
  id: string;
  actor: string; // "You" | display name | agent name
  text: string;
  tone: StatusTone;
  occurredAt: string;
}

const TONE_BY_TYPE: Record<string, StatusTone> = {
  spec_published: "neutral",
  plan_derived: "neutral",
  task_started: "info",
  task_deployed: "success",
  task_failed: "error",
};

// The actor lead-in: "You" for the viewer's own user events, else the stored
// display name (teammate or agent). Mirrors #130 chat attribution (author.id ===
// currentUserId, where currentUserId is the signed-in email).
function actorLabel(e: ActivityEvent, currentUserEmail: string): string {
  if (e.actorKind === "user" && e.actorId && e.actorId === currentUserEmail) {
    return "You";
  }
  return e.actorName;
}

function issueRef(e: ActivityEvent): string {
  const n = e.issue ? `#${e.issue}` : "";
  return e.title ? `${n} ${e.title}`.trim() : n;
}

// The rest of the line (after the bold actor lead-in).
function bodyText(e: ActivityEvent): string {
  switch (e.type) {
    case "spec_published":
      return `published spec ${e.tag ?? ""} and started build`.replace(/\s+/g, " ").trim();
    case "plan_derived":
      return "derived build tasks from the architecture";
    case "task_started":
      return `started ${issueRef(e)}`.trim();
    case "task_deployed":
      return `deployed ${issueRef(e)}`.trim();
    case "task_failed":
      return `failed task ${issueRef(e)}`.trim();
    default:
      return e.type;
  }
}

export function activityLine(e: ActivityEvent, currentUserEmail: string): ActivityLine {
  return {
    id: e.id,
    actor: actorLabel(e, currentUserEmail),
    text: bodyText(e),
    tone: TONE_BY_TYPE[e.type] ?? "neutral",
    occurredAt: e.occurredAt,
  };
}
```

- [ ] **Step 4: Run to verify it passes + commit**

Run: `pnpm exec vitest run src/features/activity/lib/render.test.ts`
Expected: PASS.

```bash
git add apps/console/src/features/activity/lib/render.tsx apps/console/src/features/activity/lib/render.test.ts
git commit -m "feat(console): activity line render map (viewer-relative You + tone)"
```

### Task 5.3: SSE opener + the combined feed hook

**Files:**
- Create: `apps/console/src/features/activity/api/stream.ts`
- Create: `apps/console/src/features/activity/hooks/useActivityFeed.ts`

- [ ] **Step 1: SSE opener** (mirrors `agent-chat/api/turns.ts` `openTurnStream` — authed fetch stream, not EventSource):

```typescript
// ... Apache header ...
import { client } from "../../../api/client";

// Open the project's activity SSE stream as a raw byte stream (replay + live
// tail). Iterate with @aep/agent-stream's parseSseStream. EventSource can't
// send the Authorization header, so we use the authed openapi-fetch client.
export async function openActivityStream(
  projectName: string,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const { data, error } = await client.GET(
    "/projects/{projectName}/activity/stream",
    { params: { path: { projectName } }, parseAs: "stream", signal },
  );
  if (error || !data) throw new Error("Failed to attach to the activity stream");
  return data as ReadableStream<Uint8Array>;
}
```

- [ ] **Step 2: The combined hook** (seed from the query, tail via SSE, dedup by id, reconnect — mirrors `useTaskLog`):

```typescript
// ... Apache header ...
import { useEffect, useRef, useState } from "react";
import { parseSseStream } from "@aep/agent-stream";
import type { components } from "../../../generated/aep-api";
import { useProjectActivity } from "../api/queries";
import { openActivityStream } from "../api/stream";

type ActivityEvent = components["schemas"]["ActivityEvent"];

const RECONNECT_DELAY_MS = 3_000;

// The project's activity feed: the initial page from the query, then live SSE
// events prepended as they arrive (deduped by id). Newest-first for display.
export function useActivityFeed(projectName: string): {
  events: ActivityEvent[];
  isPending: boolean;
  isError: boolean;
} {
  const initial = useProjectActivity(projectName);
  const [live, setLive] = useState<ActivityEvent[]>([]);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    seen.current = new Set();
    setLive([]);
    const controller = new AbortController();
    let disposed = false;

    const consume = async (): Promise<"done" | "eof"> => {
      const body = await openActivityStream(projectName, controller.signal);
      const frames = parseSseStream(body);
      while (true) {
        const next = await frames.next();
        if (next.done) return next.value;
        const ev = next.value as unknown as ActivityEvent;
        if (!ev?.id || seen.current.has(ev.id)) continue;
        seen.current.add(ev.id);
        setLive((prev) => [ev, ...prev]);
      }
    };

    const run = async () => {
      while (!disposed) {
        try {
          await consume();
        } catch {
          if (disposed) return;
        }
        await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
      }
    };
    void run();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [projectName]);

  // Merge: live events (newest-first) ahead of the seeded page, deduped.
  const base = initial.data ?? [];
  const baseIds = new Set(base.map((e) => e.id));
  const merged = [...live.filter((e) => !baseIds.has(e.id)), ...base];

  return { events: merged, isPending: initial.isPending, isError: initial.isError };
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `cd apps/console && pnpm exec tsc --noEmit`
Expected: exit 0.

```bash
git add apps/console/src/features/activity/api/stream.ts apps/console/src/features/activity/hooks/useActivityFeed.ts
git commit -m "feat(console): activity SSE opener + combined feed hook"
```

### Task 5.4: Rewire `AgentActivity` + delete the derivation

**Files:**
- Modify: `apps/console/src/features/projects/components/AgentActivity.tsx`
- Modify: `apps/console/src/features/projects/lib/projectActivity.ts` (delete `agentActivity` + `PLACEHOLDER_TIMES`; keep `componentStatus`)
- Modify: the caller of `<AgentActivity tasks=...>` (likely `ProjectOverview.tsx`) to pass `projectName`
- Test: `apps/console/src/features/projects/components/AgentActivity.test.tsx` (add if none)

- [ ] **Step 1: Rewrite `AgentActivity` to consume the real feed** (keep the exact timeline markup; source items from the hook + render map; add relative-time formatting)

```tsx
// ... Apache header ...
import { Box, Typography } from "@wso2/oxygen-ui";
import { Activity } from "@wso2/oxygen-ui-icons-react";
import { EmptyState } from "../../../components/EmptyState";
import { SectionTitle } from "../../../components/SectionTitle";
import type { StatusTone } from "../../../components/StatusChip";
import { useSession } from "../../../auth/SessionContext";
import { useActivityFeed } from "../../activity/hooks/useActivityFeed";
import { activityLine } from "../../activity/lib/render";

const DOT_COLOR: Record<StatusTone, string> = {
  error: "error.main", warning: "warning.main", info: "info.main",
  success: "success.main", primary: "primary.main", neutral: "text.disabled",
};

// Compact "4 min ago" from an ISO timestamp.
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

// The overview's "agent activity" feed — a status-dotted timeline of what the
// platform's agents (and you) have done, from the real activity stream (#239).
export function AgentActivity({ projectName }: { projectName: string }) {
  const { user } = useSession();
  const { events } = useActivityFeed(projectName);
  const items = events.map((e) => activityLine(e, user.email));

  return (
    <div>
      <SectionTitle>Agent Activity</SectionTitle>
      {items.length === 0 ? (
        <EmptyState
          bordered
          icon={<Activity size={28} />}
          title="No activity yet"
          description="Publish the plan and start a build — agents report progress here as they work."
        />
      ) : (
        <Box sx={{ mt: 1 }}>
          {items.map((item, i) => {
            const last = i === items.length - 1;
            return (
              <Box key={item.id} sx={{ display: "flex", gap: 1.5 }}>
                <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                  <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: DOT_COLOR[item.tone], mt: "5px" }} />
                  {!last && <Box sx={{ flexGrow: 1, width: "2px", bgcolor: "divider", mt: 0.5 }} />}
                </Box>
                <Box sx={{ minWidth: 0, pb: last ? 0 : 2 }}>
                  <Typography variant="body2" sx={{ color: "text.primary" }}>
                    <Box component="span" sx={{ fontWeight: 600 }}>{item.actor}</Box>{" "}
                    {item.text}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {relativeTime(item.occurredAt)}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update the caller** — in `ProjectOverview.tsx`, change `<AgentActivity tasks={tasks} />` to `<AgentActivity projectName={projectName} />` (the overview already has `projectName` in scope). If `tasks` was only fetched for `AgentActivity`, leave it — `componentStatus` still uses the task list.

- [ ] **Step 3: Delete the derivation** — in `projectActivity.ts`, remove `ActivityItem`, `PLACEHOLDER_TIMES`, `TONE_RANK`, `verbFor`, and `agentActivity`. Keep `componentStatus` (still used by the components roll-up). Remove now-unused imports (`taskChip`, `StatusTone` if unused).

- [ ] **Step 4: Add a component test** (mock the feed hook + session; assert a rendered line and empty state)

```tsx
// ... Apache header ...
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentActivity } from "./AgentActivity";

vi.mock("../../../auth/SessionContext", () => ({
  useSession: () => ({ user: { email: "me@x.com", name: "Me" } }),
}));
let mockEvents: unknown[] = [];
vi.mock("../../activity/hooks/useActivityFeed", () => ({
  useActivityFeed: () => ({ events: mockEvents, isPending: false, isError: false }),
}));

describe("AgentActivity", () => {
  it("shows the empty state with no events", () => {
    mockEvents = [];
    render(<AgentActivity projectName="p" />);
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });
  it("renders a deployed line", () => {
    mockEvents = [{ id: "1", type: "task_deployed", actorKind: "agent", actorName: "Build agent", issue: 10, title: "Catalog", occurredAt: new Date().toISOString() }];
    render(<AgentActivity projectName="p" />);
    expect(screen.getByText(/deployed #10 Catalog/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Typecheck + run the affected tests**

Run: `cd apps/console && pnpm exec tsc --noEmit && pnpm exec vitest run src/features/activity src/features/projects/components/AgentActivity.test.tsx`
Expected: exit 0, PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/features/projects/components/AgentActivity.tsx apps/console/src/features/projects/lib/projectActivity.ts apps/console/src/features/projects/components/ProjectOverview.tsx apps/console/src/features/projects/components/AgentActivity.test.tsx
git commit -m "feat(console): AgentActivity consumes the real activity feed (#239)"
```

### Task 5.5: Mock layer for dev/tests

**Files:**
- Modify: `apps/console/src/mocks/handlers/` (add `activity` handlers) + `apps/console/src/mocks/fixtures/`
- Modify: whichever `handlers/index.ts` aggregates handlers

- [ ] **Step 1: Add MSW handlers** for `GET /projects/:projectName/activity` (return a fixture `ActivityFeed`) and `GET /projects/:projectName/activity/stream` (an SSE response replaying the fixture then idling). Follow the existing `handlers/project.ts` SSE mock referenced by the codebase (`grep -rn "text/event-stream" src/mocks`). Type the fixture against `components["schemas"]["ActivityEvent"]`.

- [ ] **Step 2: Verify the full console suite + typecheck**

Run: `cd apps/console && pnpm exec tsc --noEmit && pnpm exec vitest run`
Expected: exit 0, all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/mocks/
git commit -m "feat(console): mock activity feed + stream handlers"
```

**Milestone 5 done — feature complete.** Run the app in mock mode and confirm the overview feed renders real relative times and updates live; then verify end-to-end against a real backend build.

---

## Final verification (whole feature)

- [ ] Backend: `cd services/aep-api && make gen-api && go build ./... && go test ./...` — all green.
- [ ] Contract sync: `make gen` at repo root leaves no diff (CI `gen-api-check`).
- [ ] Console: `cd apps/console && pnpm exec tsc --noEmit && pnpm exec vitest run` — all green.
- [ ] Manual E2E (if a dev cluster is available): publish a spec → start a build → the overview feed shows "You published spec …", "Plan agent derived … tasks", "Build agent started/deployed/failed #N …" with real relative times, updating live without a refresh.
- [ ] Update `apps/console/PRD.md` per the feature flow (mark Agent Activity as backed by a real stream), and graduate the #239 decisions to an ADR under `apps/console/design/decisions/` if they've proven durable.

## Notes / investigation points flagged during planning

1. **`auth.Claims` field names** (Task 2.4): verify `Email`/`Name`/`Subject` exist; if the console needs display identity the collab way, mirror `handlers_collab.go`'s `requirements.ParseDisplayIdentity(authHeader)`.
2. **`task.Reads` single-issue read** (Task 2.5): confirm the method that returns one Task's title (`Get`/`TaskDetail`/`buildView`) and adapt `devflowTitles.TitleFor`.
3. **oapi-codegen param names** (Tasks 3/4): after `make gen-api`, confirm the generated `request.Params.*` field names (`Limit`, `Before`, `BeforeId`, `LastEventID`) and the `Visit*Response` method names, then adjust the handlers.
4. **dbtest constructor name** (Task 1.3): confirm `dbtest.NewDB(t)` vs `dbtest.New(t)` from an existing `*_dbtest_test.go`.
