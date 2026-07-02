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

package organization

// UNIT tier (bff-component-testing.md §2): the DB-FREE branches of the org
// service and its pure error-mapping helpers, exercised with a mocked
// NamespaceClient. The SQL-shaped behaviour of EnsureForOuHandle (verify →
// backfill → cache/singleflight over real rows) lives at the dbtest tier in
// organization_dbtest_test.go; here we cover only what the service decides
// BEFORE it touches the database — the empty-namespace short-circuit, the
// client-error translation, the required-handle guard, and the cache hot path
// (a warm entry with no UUID backfill does zero I/O). Those all run under
// `make test` with no Docker.

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
	"github.com/wso2/aep/aep-api/models"
)

// statusOf casts a huma error to its wire status, failing the test if the
// mapper returned something that is not a huma.StatusError.
func statusOf(t *testing.T, err error) int {
	t.Helper()
	se, ok := err.(huma.StatusError)
	if !ok {
		t.Fatalf("expected a huma.StatusError, got %T (%v)", err, err)
	}
	return se.GetStatus()
}

// TestMapOrganizationError pins the handler-facing status mapping: only an OC
// 401 becomes a 401 (so an upstream auth failure isn't masked); every other OC
// sentinel and any opaque error are an opaque 500 whose body carries a fixed
// message (never the underlying error, so internals can't leak). The 401
// distinction is the deliberate coarseness of the read-only List contract.
func TestMapOrganizationError(t *testing.T) {
	t.Parallel()

	if got := statusOf(t, mapOrganizationError(openchoreo.ErrUnauthorized)); got != 401 {
		t.Fatalf("oc unauthorized → %d, want 401", got)
	}
	// Wrapped unauthorized still maps to 401 (errors.Is chain).
	if got := statusOf(t, mapOrganizationError(fmt.Errorf("list: %w", openchoreo.ErrUnauthorized))); got != 401 {
		t.Fatalf("wrapped oc unauthorized → %d, want 401", got)
	}
	// Every other OC sentinel and any opaque error collapse to an opaque 500.
	for _, err := range []error{openchoreo.ErrForbidden, openchoreo.ErrNotFound, errors.New("pg down")} {
		e := mapOrganizationError(err)
		if got := statusOf(t, e); got != 500 {
			t.Fatalf("%v → %d, want 500", err, got)
		}
		if e.Error() != "failed to list organizations" {
			t.Fatalf("500 must carry the fixed message, got %q", e.Error())
		}
	}
}

// TestList_EmptyNamespacesShortCircuits proves the len==0 fast path: an empty
// namespace list returns an empty (non-nil) item slice WITHOUT touching the DB —
// which is why this test can run with a nil *gorm.DB. If the short-circuit were
// removed the nil DB would panic, so this also guards that branch's existence.
func TestList_EmptyNamespacesShortCircuits(t *testing.T) {
	t.Parallel()
	nsCli := &ocmocks.NamespaceClientMock{
		ListNamespacesFunc: func(context.Context) ([]models.OrganizationView, error) {
			return nil, nil
		},
	}
	svc := NewOrganizationService(nil, nsCli) // nil DB: the short-circuit must not reach it.

	list, err := svc.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if list == nil || list.Items == nil || len(list.Items) != 0 {
		t.Fatalf("empty namespaces must yield a non-nil empty slice, got %+v", list)
	}
}

// TestList_PropagatesClientError proves List surfaces a NamespaceClient failure
// as the RAW OC sentinel (the huma edge classifies it) and returns BEFORE any DB
// access (nil DB). The 401 status mapping is proven at the mapper + component
// tiers; this pins that the service does not swallow or mislabel the OC error.
func TestList_PropagatesClientError(t *testing.T) {
	t.Parallel()
	nsCli := &ocmocks.NamespaceClientMock{
		ListNamespacesFunc: func(context.Context) ([]models.OrganizationView, error) {
			return nil, openchoreo.ErrUnauthorized
		},
	}
	svc := NewOrganizationService(nil, nsCli)

	_, err := svc.List(context.Background())
	if !errors.Is(err, openchoreo.ErrUnauthorized) {
		t.Fatalf("List should surface the raw OC 401, got %v", err)
	}
}

// TestEnsureForOuHandle_EmptyHandleGuard pins the required-arg guard: an empty
// ouHandle is rejected before any verify, so the NamespaceClient is never
// touched (its funcs are nil and would panic if called).
func TestEnsureForOuHandle_EmptyHandleGuard(t *testing.T) {
	t.Parallel()
	nsCli := &ocmocks.NamespaceClientMock{} // no funcs → any call panics
	svc := NewOrganizationService(nil, nsCli)

	if err := svc.EnsureForOuHandle(context.Background(), "", "any-uuid"); err == nil {
		t.Fatal("empty ouHandle must error")
	}
	if got := len(nsCli.GetNamespaceCalls()); got != 0 {
		t.Fatalf("empty handle must not verify against OC, got %d GetNamespace calls", got)
	}
}

// TestEnsureForOuHandle_WarmCacheDoesZeroIO proves the hot path the auth
// middleware hits on every authenticated request: a cache entry inside the TTL,
// with no thunderOrgUUID to backfill, resolves with NO OC verify and NO DB
// access (nil DB, nil client funcs — both would blow up if reached). This is the
// per-request cost the cache exists to eliminate.
func TestEnsureForOuHandle_WarmCacheDoesZeroIO(t *testing.T) {
	t.Parallel()
	nsCli := &ocmocks.NamespaceClientMock{} // any call panics
	svc := NewOrganizationService(nil, nsCli)
	svc.ensureCache["acme"] = time.Now() // fresh entry, well inside the TTL

	if err := svc.EnsureForOuHandle(context.Background(), "acme", ""); err != nil {
		t.Fatalf("warm cache should resolve nil, got %v", err)
	}
	if got := len(nsCli.GetNamespaceCalls()); got != 0 {
		t.Fatalf("warm cache must not re-verify against OC, got %d GetNamespace calls", got)
	}
}
