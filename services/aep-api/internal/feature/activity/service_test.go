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

	gotLimit int // limit last passed to ListByProject
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
func (f *fakeRepo) ListByProject(_ context.Context, _ string, _ string, limit int, _ time.Time, _ string) ([]models.ActivityEvent, error) {
	f.gotLimit = limit
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
	repo := &fakeRepo{}
	svc := NewService(repo, NewHub())

	if _, err := svc.List(context.Background(), "org1", "proj1", 0, time.Time{}, ""); err != nil {
		t.Fatalf("List(0): %v", err)
	}
	if repo.gotLimit != defaultLimit {
		t.Fatalf("List(0): repo got limit %d, want defaultLimit %d", repo.gotLimit, defaultLimit)
	}

	if _, err := svc.List(context.Background(), "org1", "proj1", 10_000, time.Time{}, ""); err != nil {
		t.Fatalf("List(10000): %v", err)
	}
	if repo.gotLimit != maxLimit {
		t.Fatalf("List(10000): repo got limit %d, want maxLimit %d", repo.gotLimit, maxLimit)
	}

	if _, err := svc.List(context.Background(), "org1", "proj1", 25, time.Time{}, ""); err != nil {
		t.Fatalf("List(25): %v", err)
	}
	if repo.gotLimit != 25 {
		t.Fatalf("List(25): repo got limit %d, want 25 (in-range passthrough)", repo.gotLimit)
	}
}
