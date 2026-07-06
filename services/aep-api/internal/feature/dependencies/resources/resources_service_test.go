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

package resources

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/contracts"
	"github.com/wso2/aep/aep-api/models"
)

// ---- fakes ------------------------------------------------------------------

type fakeDesignReader struct {
	comps []models.DesignComponent
	err   error
}

func (f *fakeDesignReader) ReadDesignComponents(_ context.Context, _, _ string) ([]models.DesignComponent, error) {
	return f.comps, f.err
}

type fakePlatformProvisioner struct {
	called        int
	deprovisioned int
	gotType       string
	gotParams     map[string]string
	gotEnvs       []string
	result        *PlatformProvisionResult
	err           error
}

func (f *fakePlatformProvisioner) Provision(_ context.Context, _, _, _, resourceType string, params map[string]string, envs []string) (*PlatformProvisionResult, error) {
	f.called++
	f.gotType, f.gotParams, f.gotEnvs = resourceType, params, envs
	return f.result, f.err
}

func (f *fakePlatformProvisioner) Deprovision(_ context.Context, _, _, _ string, _ []string) error {
	f.deprovisioned++
	return f.err
}

func componentsWithPlatformResource(compName, depName, resourceType string) []models.DesignComponent {
	return []models.DesignComponent{
		{
			Name: compName,
			Dependencies: []models.Dependency{
				{Kind: models.DependencyKindPlatformResource, Name: depName, ResourceType: resourceType},
			},
		},
	}
}

// ---- tests ------------------------------------------------------------------

// TestResourceService_Provision_MarksTaskViaContractsEvent: Provision authors
// the OC model once, then moves the matching PENDING resource-provisioning
// task pending→building through the contracts TaskEventProvisionStarted event
// applied via the TaskCompleter (the projector) — NEVER a direct status write,
// and NEVER straight to deployed (readiness is the watcher's job).
func TestResourceService_Provision_MarksTaskViaContractsEvent(t *testing.T) {
	t.Parallel()

	prov := &fakePlatformProvisioner{result: &PlatformProvisionResult{ResourceName: "proj-db", BindingByEnv: map[string]string{"development": "proj-db-development"}}}
	reader := &fakeDesignReader{comps: componentsWithPlatformResource("api", "db", "postgres-cnpg")}
	tasks := &fakeTaskStore{tasks: []models.ComponentTask{
		{ID: "t-other", Type: models.TaskTypeComponent, ComponentName: "api", Status: string(models.TaskStatusOnHold)},
		{ID: "t-built", Type: models.TaskTypeResourceProvisioning, ResourceName: "db", Status: string(models.TaskStatusBuilding)},
		{ID: "t-prov", Type: models.TaskTypeResourceProvisioning, ResourceName: "db", Status: string(models.TaskStatusPending)},
	}}
	completer := &fakeTaskCompleter{}

	svc := NewResourceService(reader, prov, tasks, completer)
	err := svc.Provision(context.Background(), "default", "proj", "api", "db",
		map[string]string{"storage": "10Gi"}, []string{"development"})
	if err != nil {
		t.Fatalf("Provision: %v", err)
	}

	if prov.called != 1 {
		t.Errorf("Provisioner.Provision called %d times, want 1", prov.called)
	}
	if prov.gotType != "postgres-cnpg" {
		t.Errorf("resourceType passed to provisioner = %q, want postgres-cnpg", prov.gotType)
	}
	if completer.calls != 1 {
		t.Fatalf("want exactly 1 ApplyBuildResult call, got %d", completer.calls)
	}
	if completer.taskID != "t-prov" || completer.event != contracts.TaskEventProvisionStarted || completer.errMsg != "" {
		t.Errorf("ApplyBuildResult(%q, %q, %q); want (t-prov, provision_started, \"\")",
			completer.taskID, completer.event, completer.errMsg)
	}
}

// TestResourceService_Provision_CompleterIsBestEffort: provisioning already
// succeeded, so a projector failure must not fail the call.
func TestResourceService_Provision_CompleterIsBestEffort(t *testing.T) {
	t.Parallel()

	prov := &fakePlatformProvisioner{result: &PlatformProvisionResult{}}
	reader := &fakeDesignReader{comps: componentsWithPlatformResource("api", "db", "postgres-cnpg")}
	tasks := &fakeTaskStore{tasks: []models.ComponentTask{
		{ID: "t-prov", Type: models.TaskTypeResourceProvisioning, ResourceName: "db", Status: string(models.TaskStatusPending)},
	}}
	completer := &fakeTaskCompleter{err: errors.New("projector down")}

	svc := NewResourceService(reader, prov, tasks, completer)
	if err := svc.Provision(context.Background(), "default", "proj", "api", "db", nil, []string{"development"}); err != nil {
		t.Fatalf("completer failure must be best-effort: %v", err)
	}
	if completer.calls != 1 {
		t.Fatalf("completer should still have been attempted, calls = %d", completer.calls)
	}
}

func TestResourceService_Provision_MissingDep(t *testing.T) {
	t.Parallel()

	reader := &fakeDesignReader{comps: componentsWithPlatformResource("api", "cache", "redis")}
	svc := NewResourceService(reader, &fakePlatformProvisioner{}, &fakeTaskStore{}, &fakeTaskCompleter{})

	err := svc.Provision(context.Background(), "default", "proj", "api", "db", nil, []string{"development"})
	if !errors.Is(err, ErrDepNotFound) {
		t.Errorf("expected ErrDepNotFound, got %v", err)
	}
}

func TestResourceService_Provision_NoDesign(t *testing.T) {
	t.Parallel()

	svc := NewResourceService(&fakeDesignReader{}, &fakePlatformProvisioner{}, &fakeTaskStore{}, &fakeTaskCompleter{})
	err := svc.Provision(context.Background(), "default", "proj", "api", "db", nil, []string{"development"})
	if !errors.Is(err, ErrDepNotFound) {
		t.Errorf("expected ErrDepNotFound for a project without a design, got %v", err)
	}
}

// TestResourceService_Provision_WrongKind: the dep exists but is not a
// platform-resource — the DISTINCT ErrDepWrongKind sentinel (HTTP 400, not
// 404), whose message names both the actual and the applicable kind.
func TestResourceService_Provision_WrongKind(t *testing.T) {
	t.Parallel()

	reader := &fakeDesignReader{comps: []models.DesignComponent{
		{
			Name:         "api",
			Dependencies: []models.Dependency{{Kind: models.DependencyKindExternal, Name: "db"}},
		},
	}}
	prov := &fakePlatformProvisioner{}
	svc := NewResourceService(reader, prov, &fakeTaskStore{}, &fakeTaskCompleter{})

	err := svc.Provision(context.Background(), "default", "proj", "api", "db", nil, []string{"development"})
	if !errors.Is(err, ErrDepWrongKind) {
		t.Fatalf("expected ErrDepWrongKind, got %v", err)
	}
	if errors.Is(err, ErrDepNotFound) {
		t.Error("wrong kind must NOT be conflated with not-found")
	}
	for _, want := range []string{models.DependencyKindExternal, models.DependencyKindPlatformResource} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error must name kind %q: %v", want, err)
		}
	}
	if prov.called != 0 {
		t.Error("provisioner must not run for a wrong-kind dep")
	}
}

func TestResourceService_Provision_ProvisionerFail(t *testing.T) {
	t.Parallel()

	reader := &fakeDesignReader{comps: componentsWithPlatformResource("api", "db", "postgres-cnpg")}
	prov := &fakePlatformProvisioner{err: errors.New("OC 503")}
	completer := &fakeTaskCompleter{}
	svc := NewResourceService(reader, prov, &fakeTaskStore{}, completer)

	err := svc.Provision(context.Background(), "default", "proj", "api", "db", nil, []string{"development"})
	if !errors.Is(err, ErrProvisionFailed) {
		t.Errorf("expected ErrProvisionFailed, got %v", err)
	}
	if completer.calls != 0 {
		t.Error("task must not be marked when provisioning failed")
	}
}

func TestResourceService_TaskStatus(t *testing.T) {
	t.Parallel()

	t.Run("returns the resource-provisioning task status", func(t *testing.T) {
		t.Parallel()
		tasks := &fakeTaskStore{tasks: []models.ComponentTask{
			{Type: models.TaskTypeResourceProvisioning, ResourceName: "db", Status: string(models.TaskStatusBuilding)},
		}}
		svc := NewResourceService(&fakeDesignReader{}, &fakePlatformProvisioner{}, tasks, &fakeTaskCompleter{})
		if got := svc.TaskStatus(context.Background(), "default", "proj", "db"); got != string(models.TaskStatusBuilding) {
			t.Errorf("TaskStatus = %q, want building", got)
		}
	})

	t.Run("falls back to pending when no task matches", func(t *testing.T) {
		t.Parallel()
		svc := NewResourceService(&fakeDesignReader{}, &fakePlatformProvisioner{}, &fakeTaskStore{}, &fakeTaskCompleter{})
		if got := svc.TaskStatus(context.Background(), "default", "proj", "db"); got != "pending" {
			t.Errorf("TaskStatus = %q, want pending fallback", got)
		}
	})

	t.Run("falls back to pending on a list error (polling-resilient)", func(t *testing.T) {
		t.Parallel()
		tasks := &fakeTaskStore{listErr: errors.New("db transient")}
		svc := NewResourceService(&fakeDesignReader{}, &fakePlatformProvisioner{}, tasks, &fakeTaskCompleter{})
		if got := svc.TaskStatus(context.Background(), "default", "proj", "db"); got != "pending" {
			t.Errorf("TaskStatus = %q, want pending fallback", got)
		}
	})
}
