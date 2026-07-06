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
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/contracts"
	"github.com/wso2/aep/aep-api/models"
)

type fakeTaskStore struct {
	tasks   []models.ComponentTask
	listErr error
}

func (f *fakeTaskStore) ListByProjectID(_ context.Context, _, _ string) ([]models.ComponentTask, error) {
	return f.tasks, f.listErr
}

// fakeTaskCompleter captures the contracts event application — the migrated
// replacement for the source's direct status UPDATE. Its method signature
// mirrors task.Projector.ApplyBuildResult so the composition root can wire the
// projector directly.
type fakeTaskCompleter struct {
	taskID string
	event  contracts.TaskEvent
	errMsg string
	calls  int
	err    error
}

func (f *fakeTaskCompleter) ApplyBuildResult(_ context.Context, taskID string, event contracts.TaskEvent, errMsg string) error {
	f.calls++
	f.taskID, f.event, f.errMsg = taskID, event, errMsg
	return f.err
}

func openWeatherResource() *models.ExternalResource {
	return &models.ExternalResource{
		Name: "openweather", ResourceTypeName: "openweather",
		ConfigKeys: []models.ConfigKey{
			{Key: "OPENWEATHER_BASE_URL", Secret: false},
			{Key: "OPENWEATHER_API_KEY", Secret: true},
		},
	}
}

func TestSaveValues_ProvisionsCompletesAndCascades(t *testing.T) {
	t.Parallel()

	rc := newFakeRC("rel-1")
	prov := newTestProvisioner(nil, rc, &fakeSecretWriter{})
	store := &fakeTaskStore{tasks: []models.ComponentTask{
		{ID: "t-other", Type: models.TaskTypeComponent, ComponentName: "weather-api", Status: string(models.TaskStatusOnHold)},
		{ID: "t-done", Type: models.TaskTypeConfigCollection, ExternalResourceName: "openweather", Status: string(models.TaskStatusDeployed)},
		{ID: "t-cfg", Type: models.TaskTypeConfigCollection, ExternalResourceName: "openweather", Status: string(models.TaskStatusPending)},
	}}
	completer := &fakeTaskCompleter{}
	var redispatched bool
	vs := NewValueService(&fakeLookup{er: openWeatherResource()}, prov, store, completer,
		func(_ context.Context, _, _ string) error { redispatched = true; return nil })

	err := vs.SaveValues(context.Background(), "default", "oc-org-1", "weatherproj", "openweather",
		map[string]map[string]string{
			"development": {"OPENWEATHER_BASE_URL": "https://api.openweathermap.org", "OPENWEATHER_API_KEY": "k"},
		})
	if err != nil {
		t.Fatalf("SaveValues: %v", err)
	}
	// Provisioned: one pinned binding authored.
	bindings := rc.EnsureBindingCalls()
	if len(bindings) != 1 || bindings[0].B.Spec.ResourceRelease != "rel-1" {
		t.Fatalf("resource not provisioned: %+v", bindings)
	}
	// config-collection task completed via the contracts event — never a raw
	// status write: the matching NOT-yet-deployed task, TaskEventValuesProvisioned.
	if completer.calls != 1 {
		t.Fatalf("want exactly 1 ApplyBuildResult call, got %d", completer.calls)
	}
	if completer.taskID != "t-cfg" || completer.event != contracts.TaskEventValuesProvisioned || completer.errMsg != "" {
		t.Errorf("ApplyBuildResult(%q, %q, %q); want (t-cfg, values_provisioned, \"\")",
			completer.taskID, completer.event, completer.errMsg)
	}
	// Cascade fired.
	if !redispatched {
		t.Error("redispatch not called")
	}
}

func TestSaveValues_UnregisteredResource(t *testing.T) {
	t.Parallel()

	vs := NewValueService(&fakeLookup{}, newTestProvisioner(nil, newFakeRC("rel-1"), &fakeSecretWriter{}),
		&fakeTaskStore{}, &fakeTaskCompleter{}, nil)
	err := vs.SaveValues(context.Background(), "default", "oc-org-1", "proj", "ghost",
		map[string]map[string]string{"development": {"K": "v"}})
	if !errors.Is(err, ErrNotRegistered) {
		t.Fatalf("want ErrNotRegistered, got %v", err)
	}
}

func TestSaveValues_CompleterAndRedispatchAreBestEffort(t *testing.T) {
	t.Parallel()

	rc := newFakeRC("rel-1")
	prov := newTestProvisioner(nil, rc, &fakeSecretWriter{})
	store := &fakeTaskStore{tasks: []models.ComponentTask{
		{ID: "t-cfg", Type: models.TaskTypeConfigCollection, ExternalResourceName: "openweather", Status: string(models.TaskStatusPending)},
	}}
	completer := &fakeTaskCompleter{err: errors.New("projector down")}
	vs := NewValueService(&fakeLookup{er: openWeatherResource()}, prov, store, completer,
		func(_ context.Context, _, _ string) error { return errors.New("dispatch down") })

	err := vs.SaveValues(context.Background(), "default", "oc-org-1", "weatherproj", "openweather",
		map[string]map[string]string{"development": {"OPENWEATHER_BASE_URL": "u", "OPENWEATHER_API_KEY": "k"}})
	if err != nil {
		t.Fatalf("completion/redispatch failures must not fail SaveValues (provisioning already succeeded): %v", err)
	}
	if completer.calls != 1 {
		t.Fatalf("completer should still have been attempted, calls = %d", completer.calls)
	}
}

func TestSaveValues_ProvisionFailureIsFatal(t *testing.T) {
	t.Parallel()

	rc := newFakeRC("rel-1")
	rc.ApplyResourceFunc = func(_ context.Context, _ string, _ *openchoreo.Resource) (*openchoreo.Resource, error) {
		return nil, errors.New("boom")
	}
	completer := &fakeTaskCompleter{}
	vs := NewValueService(&fakeLookup{er: openWeatherResource()},
		newTestProvisioner(nil, rc, &fakeSecretWriter{}), &fakeTaskStore{}, completer, nil)

	err := vs.SaveValues(context.Background(), "default", "oc-org-1", "weatherproj", "openweather",
		map[string]map[string]string{"development": {"OPENWEATHER_BASE_URL": "u"}})
	if err == nil {
		t.Fatal("want provision failure surfaced to the caller")
	}
	if completer.calls != 0 {
		t.Fatal("task must not be completed when provisioning failed")
	}
}

func TestSplitBySchema(t *testing.T) {
	t.Parallel()

	schema := []models.ConfigKey{{Key: "URL"}, {Key: "TOKEN", Secret: true}}
	ev := splitBySchema(schema, map[string]string{"URL": "u", "TOKEN": "t", "UNKNOWN": "x"})
	if ev.Plain["URL"] != "u" || ev.Plain["UNKNOWN"] != "x" {
		t.Errorf("plain wrong: %+v", ev.Plain)
	}
	if ev.Secret["TOKEN"] != "t" {
		t.Errorf("secret wrong: %+v", ev.Secret)
	}
	if _, ok := ev.Secret["URL"]; ok {
		t.Error("URL should not be secret")
	}
}
