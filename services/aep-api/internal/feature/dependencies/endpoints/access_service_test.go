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

package endpoints

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/models"
)

// --- fakes at the consumer-side ports -----------------------------------------

// fakeStore is an in-memory AccessRequest store. updateErrs injects per-id
// UpdateStatus failures so the grant/reject best-effort isolation is testable.
type fakeStore struct {
	rows       []*models.AccessRequest
	updateErrs map[string]error
	listErr    error
}

func (r *fakeStore) FindOpenForTarget(_ context.Context, orgID, providerProject, providerComponent string) (*models.AccessRequest, error) {
	for _, ar := range r.rows {
		if ar.OrgID == orgID && ar.ProviderProjectID == providerProject &&
			ar.ProviderComponentName == providerComponent &&
			(ar.Status == models.AccessRequestStatusRequested || ar.Status == models.AccessRequestStatusInProgress) {
			return ar, nil
		}
	}
	return nil, nil
}

func (r *fakeStore) Create(_ context.Context, ar *models.AccessRequest) error {
	if ar.ID == "" {
		ar.ID = "ar-" + ar.ConsumerProjectID + "-" + ar.ConsumerComponentName
	}
	r.rows = append(r.rows, ar)
	return nil
}

func (r *fakeStore) ListByProviderTask(_ context.Context, providerTaskID string) ([]models.AccessRequest, error) {
	if r.listErr != nil {
		return nil, r.listErr
	}
	var out []models.AccessRequest
	for _, ar := range r.rows {
		if ar.ProviderTaskID == providerTaskID {
			out = append(out, *ar)
		}
	}
	return out, nil
}

func (r *fakeStore) ListByConsumerProject(_ context.Context, orgID, projectID string) ([]models.AccessRequest, error) {
	var out []models.AccessRequest
	for _, ar := range r.rows {
		if ar.OrgID == orgID && ar.ConsumerProjectID == projectID {
			out = append(out, *ar)
		}
	}
	return out, nil
}

func (r *fakeStore) UpdateStatus(_ context.Context, id, status string) error {
	if err := r.updateErrs[id]; err != nil {
		return err
	}
	for _, ar := range r.rows {
		if ar.ID == id {
			ar.Status = status
			return nil
		}
	}
	return fmt.Errorf("not found: %s", id)
}

// fakeIssue records issues created + closed; returns a fixed issue result.
type fakeIssue struct {
	created   []gitrepo.CreateIssueRequest
	closed    []int
	nextNum   int
	createErr error
}

func (f *fakeIssue) CreateIssue(_ context.Context, _, _ string, req gitrepo.CreateIssueRequest) (*gitrepo.IssueResult, error) {
	if f.createErr != nil {
		return nil, f.createErr
	}
	f.created = append(f.created, req)
	f.nextNum++
	return &gitrepo.IssueResult{Number: f.nextNum, URL: "https://github.com/acme/repo/issues/1", NodeID: "n"}, nil
}

func (f *fakeIssue) CloseIssue(_ context.Context, _, _ string, number int, _ string) error {
	f.closed = append(f.closed, number)
	return nil
}

// fakeTasks records created tasks and assigns a stable ID.
type fakeTasks struct{ created []*models.ComponentTask }

func (f *fakeTasks) Create(_ context.Context, t *models.ComponentTask) error {
	t.ID = "task-1"
	f.created = append(f.created, t)
	return nil
}

// fakeDesign returns a project's authored components, keyed by project name.
type fakeDesign struct {
	byProject map[string][]models.DesignComponent
	err       error
}

func (d *fakeDesign) ReadDesignComponents(_ context.Context, _, projectID string) ([]models.DesignComponent, error) {
	if d.err != nil {
		return nil, d.err
	}
	return d.byProject[projectID], nil
}

// fakeMarker records org-published durability writes.
type fakeMarker struct {
	calls   []string
	markErr error
}

func (m *fakeMarker) SetComponentOrgPublished(_ context.Context, _, _, componentName string) error {
	m.calls = append(m.calls, componentName)
	return m.markErr
}

// --- fixtures -----------------------------------------------------------------

func sampleCatalog() *Catalog {
	return NewCatalog(&ocmocks.ResourceClientMock{
		ListWorkloadEndpointsFunc: func(_ context.Context, _ string) ([]openchoreo.WorkloadEndpointInfo, error) {
			return []openchoreo.WorkloadEndpointInfo{
				// OC component name = `<project>-<logical>`; published project-only.
				{Project: "hr-directory", Component: "hr-directory-employee-api",
					Workload: "hr-directory-employee-api-wl", Name: "http", Type: "HTTP",
					Port: 8080, Visibility: []string{"external"}},
			}, nil
		},
	})
}

// consumerDesign wires a consumer project "store-front"/"other" whose components
// depend (org-service) on the provider, plus the provider project's design (for
// app-path lookup).
func consumerDesign() *fakeDesign {
	orgServiceDep := models.Dependency{Kind: models.DependencyKindOrgService, Name: "hr-directory-employee-api"}
	return &fakeDesign{byProject: map[string][]models.DesignComponent{
		"store-front": {{Name: "checkout", Dependencies: []models.Dependency{orgServiceDep}}},
		"other":       {{Name: "viewer", Dependencies: []models.Dependency{orgServiceDep}}},
		"hr-directory": {{Name: "employee-api", AppPath: "/services/employee-api",
			ExposesAPI: &models.ExposesAPI{Managed: true}}},
	}}
}

func newTestSvc(store accessStore, cat providerCatalog, design designReader, iss issueOps, tasks taskCreator, marker orgPublishedMarker) *AccessService {
	return NewAccessService(store, cat, design, iss, tasks, marker)
}

// --- RequestAccess ------------------------------------------------------------

func TestRequestAccess_CreatesProviderTaskAndIssue(t *testing.T) {
	t.Parallel()
	store, iss, tasks := &fakeStore{}, &fakeIssue{}, &fakeTasks{}
	svc := newTestSvc(store, sampleCatalog(), consumerDesign(), iss, tasks, &fakeMarker{})

	ar, err := svc.RequestAccess(context.Background(), RequestAccessInput{
		OrgHandle: "acme", ConsumerProject: "store-front", ConsumerComponent: "checkout",
		DepName: "hr-directory-employee-api",
	})
	if err != nil {
		t.Fatalf("RequestAccess: %v", err)
	}
	if ar.ProviderProjectID != "hr-directory" {
		t.Fatalf("providerProject = %q, want hr-directory", ar.ProviderProjectID)
	}
	if ar.ProviderComponentName != "employee-api" {
		t.Fatalf("providerComponent = %q, want employee-api (logical)", ar.ProviderComponentName)
	}
	if ar.ProviderTaskID != "task-1" || ar.ProviderIssueNumber != 1 {
		t.Fatalf("provider task/issue not linked: %+v", ar)
	}
	if len(tasks.created) != 1 || tasks.created[0].Type != models.TaskTypeOrgPublish {
		t.Fatalf("want one org-publish task, got %+v", tasks.created)
	}
	if tasks.created[0].ComponentName != "employee-api" {
		t.Fatalf("task must target the logical provider component, got %q", tasks.created[0].ComponentName)
	}
	if len(iss.created) != 1 {
		t.Fatalf("want one issue created, got %d", len(iss.created))
	}
	// The app path from the provider design is threaded into the issue body.
	if body := iss.created[0].Body; !contains(body, "services/employee-api/workload.yaml") {
		t.Fatalf("issue body missing provider app path:\n%s", body)
	}
	hasLabel := false
	for _, l := range iss.created[0].Labels {
		if l == "access-request" {
			hasLabel = true
		}
	}
	if !hasLabel {
		t.Fatalf("issue missing access-request label: %v", iss.created[0].Labels)
	}
}

func TestRequestAccess_IdempotentDedupe(t *testing.T) {
	t.Parallel()
	store, iss, tasks := &fakeStore{}, &fakeIssue{}, &fakeTasks{}
	svc := newTestSvc(store, sampleCatalog(), consumerDesign(), iss, tasks, &fakeMarker{})

	in1 := RequestAccessInput{OrgHandle: "acme", ConsumerProject: "store-front", ConsumerComponent: "checkout", DepName: "hr-directory-employee-api"}
	if _, err := svc.RequestAccess(context.Background(), in1); err != nil {
		t.Fatalf("first request: %v", err)
	}
	// Second consumer, same provider target → no new task/issue, new row riding
	// on the same provider task.
	in2 := RequestAccessInput{OrgHandle: "acme", ConsumerProject: "other", ConsumerComponent: "viewer", DepName: "hr-directory-employee-api"}
	ar2, err := svc.RequestAccess(context.Background(), in2)
	if err != nil {
		t.Fatalf("second request: %v", err)
	}
	if len(tasks.created) != 1 {
		t.Fatalf("dedupe failed: want 1 provider task, got %d", len(tasks.created))
	}
	if len(iss.created) != 1 {
		t.Fatalf("dedupe failed: want 1 issue, got %d", len(iss.created))
	}
	if ar2.ProviderTaskID != "task-1" {
		t.Fatalf("second row not linked to shared task: %q", ar2.ProviderTaskID)
	}
	if len(store.rows) != 2 {
		t.Fatalf("want 2 access-request rows, got %d", len(store.rows))
	}
}

func TestRequestAccess_ValidationErrors(t *testing.T) {
	t.Parallel()

	t.Run("unknown component is ErrDepNotFound", func(t *testing.T) {
		t.Parallel()
		svc := newTestSvc(&fakeStore{}, sampleCatalog(), consumerDesign(), &fakeIssue{}, &fakeTasks{}, &fakeMarker{})
		_, err := svc.RequestAccess(context.Background(), RequestAccessInput{
			OrgHandle: "acme", ConsumerProject: "store-front", ConsumerComponent: "ghost", DepName: "hr-directory-employee-api",
		})
		if !errors.Is(err, ErrDepNotFound) {
			t.Fatalf("want ErrDepNotFound, got %v", err)
		}
	})

	t.Run("unknown dep on known component is ErrDepNotFound", func(t *testing.T) {
		t.Parallel()
		svc := newTestSvc(&fakeStore{}, sampleCatalog(), consumerDesign(), &fakeIssue{}, &fakeTasks{}, &fakeMarker{})
		_, err := svc.RequestAccess(context.Background(), RequestAccessInput{
			OrgHandle: "acme", ConsumerProject: "store-front", ConsumerComponent: "checkout", DepName: "no-such-dep",
		})
		if !errors.Is(err, ErrDepNotFound) {
			t.Fatalf("want ErrDepNotFound, got %v", err)
		}
	})

	t.Run("wrong-kind dep is ErrDepWrongKind naming both kinds", func(t *testing.T) {
		t.Parallel()
		design := &fakeDesign{byProject: map[string][]models.DesignComponent{
			"store-front": {{Name: "checkout", Dependencies: []models.Dependency{
				{Kind: models.DependencyKindExternal, Name: "stripe"},
			}}},
		}}
		svc := newTestSvc(&fakeStore{}, sampleCatalog(), design, &fakeIssue{}, &fakeTasks{}, &fakeMarker{})
		_, err := svc.RequestAccess(context.Background(), RequestAccessInput{
			OrgHandle: "acme", ConsumerProject: "store-front", ConsumerComponent: "checkout", DepName: "stripe",
		})
		if !errors.Is(err, ErrDepWrongKind) {
			t.Fatalf("want ErrDepWrongKind, got %v", err)
		}
		for _, k := range []string{models.DependencyKindExternal, models.DependencyKindOrgService} {
			if !contains(err.Error(), k) {
				t.Errorf("error must name kind %q: %v", k, err)
			}
		}
	})

	t.Run("dep not in org catalog is ErrOrgServiceNotFound", func(t *testing.T) {
		t.Parallel()
		// Consumer design has a valid org-service dep, but the catalog knows no
		// provider component with that name.
		design := &fakeDesign{byProject: map[string][]models.DesignComponent{
			"store-front": {{Name: "checkout", Dependencies: []models.Dependency{
				{Kind: models.DependencyKindOrgService, Name: "ghost-api"},
			}}},
		}}
		svc := newTestSvc(&fakeStore{}, sampleCatalog(), design, &fakeIssue{}, &fakeTasks{}, &fakeMarker{})
		_, err := svc.RequestAccess(context.Background(), RequestAccessInput{
			OrgHandle: "acme", ConsumerProject: "store-front", ConsumerComponent: "checkout", DepName: "ghost-api",
		})
		if !errors.Is(err, ErrOrgServiceNotFound) {
			t.Fatalf("want ErrOrgServiceNotFound, got %v", err)
		}
	})
}

// --- GrantByProviderComponent -------------------------------------------------

func TestGrantByProviderComponent_FlipsAllRidersMarksAndCloses(t *testing.T) {
	t.Parallel()
	store := &fakeStore{rows: []*models.AccessRequest{
		{ID: "a", OrgID: "acme", ProviderProjectID: "hr-directory", ProviderComponentName: "employee-api",
			ProviderTaskID: "task-1", ProviderIssueNumber: 7, Status: models.AccessRequestStatusRequested},
		{ID: "b", OrgID: "acme", ProviderProjectID: "hr-directory", ProviderComponentName: "employee-api",
			ProviderTaskID: "task-1", ProviderIssueNumber: 7, Status: models.AccessRequestStatusInProgress},
		{ID: "c", OrgID: "acme", ProviderProjectID: "hr-directory", ProviderComponentName: "employee-api",
			ProviderTaskID: "task-1", ProviderIssueNumber: 7, Status: models.AccessRequestStatusGranted},
	}}
	iss, marker := &fakeIssue{}, &fakeMarker{}
	svc := newTestSvc(store, sampleCatalog(), consumerDesign(), iss, &fakeTasks{}, marker)

	if err := svc.GrantByProviderComponent(context.Background(), "acme", "hr-directory", "employee-api"); err != nil {
		t.Fatalf("GrantByProviderComponent: %v", err)
	}
	for _, ar := range store.rows {
		if ar.Status != models.AccessRequestStatusGranted {
			t.Errorf("row %s status = %q, want granted", ar.ID, ar.Status)
		}
	}
	if len(marker.calls) != 1 || marker.calls[0] != "employee-api" {
		t.Fatalf("org-published durability not persisted: %v", marker.calls)
	}
	if len(iss.closed) != 1 || iss.closed[0] != 7 {
		t.Fatalf("provider issue not closed once: %v", iss.closed)
	}
}

func TestGrantByProviderComponent_PerStepIsolation(t *testing.T) {
	t.Parallel()
	// Row "a" fails UpdateStatus; the marker also fails. Neither aborts the
	// others: row "b" still flips and the issue still closes.
	store := &fakeStore{
		rows: []*models.AccessRequest{
			{ID: "a", OrgID: "acme", ProviderProjectID: "hr-directory", ProviderComponentName: "employee-api",
				ProviderTaskID: "task-1", ProviderIssueNumber: 7, Status: models.AccessRequestStatusRequested},
			{ID: "b", OrgID: "acme", ProviderProjectID: "hr-directory", ProviderComponentName: "employee-api",
				ProviderTaskID: "task-1", ProviderIssueNumber: 7, Status: models.AccessRequestStatusRequested},
		},
		updateErrs: map[string]error{"a": errors.New("boom")},
	}
	iss, marker := &fakeIssue{}, &fakeMarker{markErr: errors.New("commit failed")}
	svc := newTestSvc(store, sampleCatalog(), consumerDesign(), iss, &fakeTasks{}, marker)

	if err := svc.GrantByProviderComponent(context.Background(), "acme", "hr-directory", "employee-api"); err != nil {
		t.Fatalf("Grant should swallow sub-step failures, got %v", err)
	}
	if store.rows[0].Status != models.AccessRequestStatusRequested {
		t.Errorf("row a should remain requested after UpdateStatus failure, got %q", store.rows[0].Status)
	}
	if store.rows[1].Status != models.AccessRequestStatusGranted {
		t.Errorf("row b should still flip to granted despite a's failure, got %q", store.rows[1].Status)
	}
	if len(iss.closed) != 1 {
		t.Errorf("issue should still close despite marker+update failures: %v", iss.closed)
	}
}

func TestGrantByProviderComponent_NoOpenRequest(t *testing.T) {
	t.Parallel()
	iss, marker := &fakeIssue{}, &fakeMarker{}
	svc := newTestSvc(&fakeStore{}, sampleCatalog(), consumerDesign(), iss, &fakeTasks{}, marker)

	if err := svc.GrantByProviderComponent(context.Background(), "acme", "hr-directory", "employee-api"); err != nil {
		t.Fatalf("Grant on normal deploy: %v", err)
	}
	if len(marker.calls) != 0 || len(iss.closed) != 0 {
		t.Fatalf("normal deploy must be a no-op: marker=%v closed=%v", marker.calls, iss.closed)
	}
}

// --- RejectByProviderTask -----------------------------------------------------

func TestRejectByProviderTask_FlipsOpenRowsOnly(t *testing.T) {
	t.Parallel()
	store := &fakeStore{rows: []*models.AccessRequest{
		{ID: "a", ProviderTaskID: "task-1", Status: models.AccessRequestStatusRequested},
		{ID: "b", ProviderTaskID: "task-1", Status: models.AccessRequestStatusInProgress},
		{ID: "c", ProviderTaskID: "task-1", Status: models.AccessRequestStatusGranted},
		{ID: "d", ProviderTaskID: "other", Status: models.AccessRequestStatusRequested},
	}}
	svc := newTestSvc(store, sampleCatalog(), consumerDesign(), &fakeIssue{}, &fakeTasks{}, &fakeMarker{})

	if err := svc.RejectByProviderTask(context.Background(), "task-1"); err != nil {
		t.Fatalf("RejectByProviderTask: %v", err)
	}
	want := map[string]string{
		"a": models.AccessRequestStatusRejected,  // open → rejected
		"b": models.AccessRequestStatusRejected,  // open → rejected
		"c": models.AccessRequestStatusGranted,   // already granted, untouched
		"d": models.AccessRequestStatusRequested, // different task, untouched
	}
	for _, ar := range store.rows {
		if ar.Status != want[ar.ID] {
			t.Fatalf("row %s status = %q, want %q", ar.ID, ar.Status, want[ar.ID])
		}
	}
}

// --- ListByConsumerProject ----------------------------------------------------

func TestListByConsumerProject(t *testing.T) {
	t.Parallel()
	store := &fakeStore{rows: []*models.AccessRequest{
		{ID: "a", OrgID: "acme", ConsumerProjectID: "store-front", Status: models.AccessRequestStatusRequested},
		{ID: "b", OrgID: "acme", ConsumerProjectID: "other", Status: models.AccessRequestStatusGranted},
	}}
	svc := newTestSvc(store, sampleCatalog(), consumerDesign(), &fakeIssue{}, &fakeTasks{}, &fakeMarker{})

	rows, err := svc.ListByConsumerProject(context.Background(), "acme", "store-front")
	if err != nil {
		t.Fatalf("ListByConsumerProject: %v", err)
	}
	if len(rows) != 1 || rows[0].ID != "a" {
		t.Fatalf("want only row a for store-front, got %+v", rows)
	}
}

func contains(s, sub string) bool { return strings.Contains(s, sub) }
