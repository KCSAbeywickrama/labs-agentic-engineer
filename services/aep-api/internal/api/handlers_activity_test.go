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

package api

import (
	"context"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/api/apigen"
	"github.com/wso2/aep/aep-api/internal/feature/activity"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
	"github.com/wso2/aep/aep-api/models"
)

// fakeActivityRepo is a DB-free stand-in for activity.Repository: List
// returns canned rows (newest-first, as the real repository does); Insert is
// unused by the read path but must exist to satisfy the interface.
type fakeActivityRepo struct {
	rows []models.ActivityEvent
}

func (f *fakeActivityRepo) Insert(_ context.Context, _ *models.ActivityEvent) (bool, error) {
	return true, nil
}

func (f *fakeActivityRepo) ListByProject(_ context.Context, _, _ string, _ int, _ time.Time, _ string) ([]models.ActivityEvent, error) {
	return f.rows, nil
}

// TestListActivity_ordersItemsAndSetsNextCursor pins the handler's contract:
// items come back in exactly the order the service returned them (newest
// first), and the next-page cursor is the last (oldest) row's occurredAt/id —
// no DB, no HTTP transport, just the strict-server method directly.
func TestListActivity_ordersItemsAndSetsNextCursor(t *testing.T) {
	t.Parallel()

	newest := models.ActivityEvent{
		ID: "evt-2", Type: models.ActivityTypeTaskDeployed,
		ActorKind: models.ActivityActorAgent, ActorName: "Build agent",
		OccurredAt: time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC),
	}
	oldest := models.ActivityEvent{
		ID: "evt-1", Type: models.ActivityTypeTaskStarted,
		ActorKind: models.ActivityActorAgent, ActorName: "Build agent",
		OccurredAt: time.Date(2026, 7, 17, 11, 0, 0, 0, time.UTC),
	}
	repo := &fakeActivityRepo{rows: []models.ActivityEvent{newest, oldest}}
	svc := activity.NewService(repo, activity.NewHub())

	srv := &apiServer{deps: Deps{ActivitySvc: svc}}
	ctx := tenant.WithBoundOrg(context.Background(), "org1")

	resp, err := srv.ListActivity(ctx, apigen.ListActivityRequestObject{
		ProjectName: "proj1",
		Params:      apigen.ListActivityParams{},
	})
	if err != nil {
		t.Fatalf("ListActivity: unexpected error %v", err)
	}

	body, ok := resp.(listActivityJSONResponse)
	if !ok {
		t.Fatalf("ListActivity response type = %T, want listActivityJSONResponse", resp)
	}
	if len(body.Items) != 2 || body.Items[0].ID != "evt-2" || body.Items[1].ID != "evt-1" {
		t.Fatalf("items out of order: %+v", body.Items)
	}
	wantNextBefore := oldest.OccurredAt.UTC().Format(time.RFC3339Nano)
	if body.NextBefore != wantNextBefore {
		t.Fatalf("NextBefore = %q, want %q", body.NextBefore, wantNextBefore)
	}
	if body.NextBeforeID != oldest.ID {
		t.Fatalf("NextBeforeID = %q, want %q", body.NextBeforeID, oldest.ID)
	}
}

// TestListActivity_emptyFeed_noCursor asserts the empty-page edge: no rows
// means no next-page cursor is emitted.
func TestListActivity_emptyFeed_noCursor(t *testing.T) {
	t.Parallel()

	repo := &fakeActivityRepo{}
	svc := activity.NewService(repo, activity.NewHub())
	srv := &apiServer{deps: Deps{ActivitySvc: svc}}
	ctx := tenant.WithBoundOrg(context.Background(), "org1")

	resp, err := srv.ListActivity(ctx, apigen.ListActivityRequestObject{
		ProjectName: "proj1",
		Params:      apigen.ListActivityParams{},
	})
	if err != nil {
		t.Fatalf("ListActivity: unexpected error %v", err)
	}
	body := resp.(listActivityJSONResponse)
	if len(body.Items) != 0 {
		t.Fatalf("Items = %+v, want empty", body.Items)
	}
	if body.NextBefore != "" || body.NextBeforeID != "" {
		t.Fatalf("expected no cursor on an empty page, got NextBefore=%q NextBeforeID=%q", body.NextBefore, body.NextBeforeID)
	}
}

// TestListActivity_nilService_serviceUnavailable pins the nil-guard: an
// unconfigured ActivitySvc must 503, never panic.
func TestListActivity_nilService_serviceUnavailable(t *testing.T) {
	t.Parallel()

	srv := &apiServer{deps: Deps{}}
	ctx := tenant.WithBoundOrg(context.Background(), "org1")

	_, err := srv.ListActivity(ctx, apigen.ListActivityRequestObject{ProjectName: "proj1"})
	if err == nil {
		t.Fatal("expected an error with ActivitySvc unconfigured")
	}
	if got := statusOf(t, err); got != 503 {
		t.Fatalf("status = %d, want 503", got)
	}
}
