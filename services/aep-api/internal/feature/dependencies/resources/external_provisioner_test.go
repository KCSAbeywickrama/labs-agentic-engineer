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
	"encoding/json"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
	"github.com/wso2/aep/aep-api/models"
)

// newFakeRC returns a ResourceClientMock whose GetResource already reports a
// cut ResourceRelease named latest — the provisioner's poll loop resolves on
// the first tick.
func newFakeRC(latest string) *ocmocks.ResourceClientMock {
	return &ocmocks.ResourceClientMock{
		EnsureResourceTypeFunc: func(_ context.Context, _ string, rt *openchoreo.ResourceType) (*openchoreo.ResourceType, error) {
			return rt, nil
		},
		ApplyResourceFunc: func(_ context.Context, _ string, r *openchoreo.Resource) (*openchoreo.Resource, error) {
			return r, nil
		},
		GetResourceFunc: func(_ context.Context, _, name string) (*openchoreo.Resource, error) {
			return &openchoreo.Resource{
				Metadata: openchoreo.OCObjectMeta{Name: name},
				Status:   &openchoreo.ResourceStatus{LatestRelease: &openchoreo.ResourceLatestRelease{Name: latest}},
			}, nil
		},
		EnsureBindingFunc: func(_ context.Context, _ string, b *openchoreo.ResourceReleaseBinding) (*openchoreo.ResourceReleaseBinding, error) {
			return b, nil
		},
		DeleteBindingFunc:  func(_ context.Context, _, _ string) error { return nil },
		DeleteResourceFunc: func(_ context.Context, _, _ string) error { return nil },
	}
}

// fakeSecretWriter records SM-API writes per entity name.
type fakeSecretWriter struct {
	disabled bool
	wrote    map[string]map[string]string
}

func (s *fakeSecretWriter) Enabled() bool { return !s.disabled }

func (s *fakeSecretWriter) WriteExternalResourceSecret(_ context.Context, _, _, entityName string, data map[string]string) (string, string, error) {
	if s.wrote == nil {
		s.wrote = map[string]map[string]string{}
	}
	s.wrote[entityName] = data
	return "user-app-secrets/wc-org/cred-" + entityName, "cred-" + entityName, nil
}

// fakeLookup serves one registered external resource by name.
type fakeLookup struct{ er *models.ExternalResource }

func (f *fakeLookup) Get(_ context.Context, _, name string) (*models.ExternalResource, error) {
	if f.er != nil && f.er.Name == name {
		return f.er, nil
	}
	return nil, nil
}

func newTestProvisioner(lookup externalResourceLookup, rc openchoreo.ResourceClient, sm SecretWriter) *ExternalResourceProvisioner {
	p := NewExternalResourceProvisioner(lookup, rc, sm)
	p.pollInterval = time.Millisecond
	p.pollTimeout = time.Second
	return p
}

func TestProvision_OrchestratesResourceModel(t *testing.T) {
	t.Parallel()

	rc := newFakeRC("openweather-proj-abc123")
	sw := &fakeSecretWriter{}
	p := newTestProvisioner(nil, rc, sw)

	er := &models.ExternalResource{
		Name:             "openweather",
		ResourceTypeName: "openweather",
		ConfigKeys: []models.ConfigKey{
			{Key: "OPENWEATHER_BASE_URL", Secret: false},
			{Key: "OPENWEATHER_API_KEY", Secret: true},
		},
	}
	byEnv := map[string]EnvValues{
		"development": {
			Plain:  map[string]string{"OPENWEATHER_BASE_URL": "https://api.openweathermap.org"},
			Secret: map[string]string{"OPENWEATHER_API_KEY": "k123"},
		},
	}

	res, err := p.Provision(context.Background(), "default", "oc-org-1", "weatherproj", er, byEnv)
	if err != nil {
		t.Fatalf("provision: %v", err)
	}

	// ResourceType built from the schema + ensured, under the version-pinned name.
	wantRT := openchoreo.ExternalResourceRTName("openweather")
	rtCalls := rc.EnsureResourceTypeCalls()
	if len(rtCalls) != 1 || rtCalls[0].Rt.Metadata.Name != wantRT {
		t.Fatalf("resourcetype not ensured under %q: %+v", wantRT, rtCalls)
	}
	// Resource: project-prefixed name, owner, type ref points at the versioned RT.
	applied := rc.ApplyResourceCalls()
	if len(applied) != 1 {
		t.Fatalf("want 1 ApplyResource call, got %d", len(applied))
	}
	if applied[0].R.Metadata.Name != "weatherproj-openweather" {
		t.Errorf("resource name = %q", applied[0].R.Metadata.Name)
	}
	if applied[0].R.Spec.Owner.ProjectName != "weatherproj" || applied[0].R.Spec.Type.Name != wantRT {
		t.Errorf("resource spec wrong: %+v", applied[0].R.Spec)
	}
	if res.LatestRelease != "openweather-proj-abc123" {
		t.Errorf("latestRelease = %q", res.LatestRelease)
	}

	// Secret written under the per-env "extres-" entity.
	if _, ok := sw.wrote["extres-openweather-development"]; !ok {
		t.Fatalf("secret not written per-env: %v", sw.wrote)
	}

	// One binding, pinned, with plain value + secretStorePath in env configs.
	bindings := rc.EnsureBindingCalls()
	if len(bindings) != 1 {
		t.Fatalf("want 1 binding, got %d", len(bindings))
	}
	b := bindings[0].B
	if b.Metadata.Name != "weatherproj-openweather-development" {
		t.Errorf("binding name = %q", b.Metadata.Name)
	}
	if b.Spec.ResourceRelease != "openweather-proj-abc123" {
		t.Errorf("binding not pinned: %q", b.Spec.ResourceRelease)
	}
	if b.Spec.Owner.ResourceName != "weatherproj-openweather" || b.Spec.Environment != "development" {
		t.Errorf("binding owner/env wrong: %+v", b.Spec)
	}
	var cfg map[string]string
	if err := json.Unmarshal(b.Spec.ResourceTypeEnvironmentConfigs, &cfg); err != nil {
		t.Fatalf("env configs not json: %v", err)
	}
	if cfg["OPENWEATHER_BASE_URL"] != "https://api.openweathermap.org" {
		t.Errorf("plain value missing from env configs: %v", cfg)
	}
	if cfg[openchoreo.SecretStorePathField] == "" {
		t.Errorf("secretStorePath missing from env configs: %v", cfg)
	}
	if res.BindingByEnv["development"] != "weatherproj-openweather-development" {
		t.Errorf("BindingByEnv wrong: %+v", res.BindingByEnv)
	}
}

func TestProvision_AllPlain_NoSecretWrite(t *testing.T) {
	t.Parallel()

	rc := newFakeRC("rel-1")
	sw := &fakeSecretWriter{}
	p := newTestProvisioner(nil, rc, sw)
	er := &models.ExternalResource{
		Name: "plainsvc", ResourceTypeName: "plainsvc",
		ConfigKeys: []models.ConfigKey{{Key: "BASE_URL"}},
	}
	byEnv := map[string]EnvValues{"development": {Plain: map[string]string{"BASE_URL": "https://x"}}}
	if _, err := p.Provision(context.Background(), "default", "oc-org-1", "proj", er, byEnv); err != nil {
		t.Fatalf("provision: %v", err)
	}
	if len(sw.wrote) != 0 {
		t.Errorf("no secret should be written for an all-plain resource: %v", sw.wrote)
	}
}

func TestProvision_SecretValuesWithoutSMAPI_Fails(t *testing.T) {
	t.Parallel()

	rc := newFakeRC("rel-1")
	p := newTestProvisioner(nil, rc, &fakeSecretWriter{disabled: true})
	er := &models.ExternalResource{
		Name: "openweather", ResourceTypeName: "openweather",
		ConfigKeys: []models.ConfigKey{{Key: "OPENWEATHER_API_KEY", Secret: true}},
	}
	byEnv := map[string]EnvValues{"development": {Secret: map[string]string{"OPENWEATHER_API_KEY": "k"}}}
	if _, err := p.Provision(context.Background(), "default", "oc-org-1", "proj", er, byEnv); err == nil {
		t.Fatal("want error when SM-API is not configured but secret values exist")
	}
}

func TestProvision_Validation(t *testing.T) {
	t.Parallel()

	p := newTestProvisioner(nil, newFakeRC("rel-1"), &fakeSecretWriter{})
	if _, err := p.Provision(context.Background(), "default", "oc-org-1", "proj", nil, nil); err == nil {
		t.Error("want error on nil external resource")
	}
	er := &models.ExternalResource{Name: "x", ResourceTypeName: "x", ConfigKeys: []models.ConfigKey{{Key: "K"}}}
	if _, err := p.Provision(context.Background(), "", "oc-org-1", "proj", er, nil); err == nil {
		t.Error("want error on empty orgHandle")
	}
	if _, err := p.Provision(context.Background(), "default", "oc-org-1", "", er, nil); err == nil {
		t.Error("want error on empty projectName")
	}
}

func TestDeprovision_DeletesBindingsThenResource(t *testing.T) {
	t.Parallel()

	rc := newFakeRC("rel-1")
	p := newTestProvisioner(nil, rc, &fakeSecretWriter{})
	if err := p.Deprovision(context.Background(), "default", "proj", "openweather", []string{"development", "production"}); err != nil {
		t.Fatalf("deprovision: %v", err)
	}
	db := rc.DeleteBindingCalls()
	if len(db) != 2 || db[0].Name != "proj-openweather-development" || db[1].Name != "proj-openweather-production" {
		t.Fatalf("binding deletes wrong: %+v", db)
	}
	dr := rc.DeleteResourceCalls()
	if len(dr) != 1 || dr[0].Name != "proj-openweather" {
		t.Fatalf("resource delete wrong: %+v", dr)
	}
}

func TestResolveRunnerSecrets_ReadsBindingStorePath(t *testing.T) {
	t.Parallel()

	cfg, _ := json.Marshal(map[string]string{
		"OPENWEATHER_BASE_URL":          "https://api.openweathermap.org",
		openchoreo.SecretStorePathField: "user-app-secrets/wc-org/cred-extres-openweather-development",
	})
	rc := newFakeRC("rel-1")
	rc.GetBindingFunc = func(_ context.Context, _, name string) (*openchoreo.ResourceReleaseBinding, error) {
		if name != "proj-openweather-development" {
			return nil, nil
		}
		return &openchoreo.ResourceReleaseBinding{
			Spec: openchoreo.ResourceReleaseBindingSpec{ResourceTypeEnvironmentConfigs: cfg},
		}, nil
	}
	lookup := &fakeLookup{er: &models.ExternalResource{
		Name: "openweather", ResourceTypeName: "openweather",
		ConfigKeys: []models.ConfigKey{
			{Key: "OPENWEATHER_BASE_URL"},
			{Key: "OPENWEATHER_API_KEY", Secret: true},
		},
	}}
	p := newTestProvisioner(lookup, rc, &fakeSecretWriter{})

	got, err := p.ResolveRunnerSecrets(context.Background(), "default", "proj", "development",
		[]string{"openweather", "unregistered"})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 runner secret, got %+v", got)
	}
	if got[0].KVPath != "user-app-secrets/wc-org/cred-extres-openweather-development" {
		t.Errorf("KVPath = %q", got[0].KVPath)
	}
	if len(got[0].Keys) != 1 || got[0].Keys[0] != "OPENWEATHER_API_KEY" {
		t.Errorf("Keys = %v; want only the secret keys", got[0].Keys)
	}
}

func TestResolveRunnerSecrets_SkipsAllPlainAndUnprovisioned(t *testing.T) {
	t.Parallel()

	rc := newFakeRC("rel-1")
	rc.GetBindingFunc = func(_ context.Context, _, _ string) (*openchoreo.ResourceReleaseBinding, error) {
		return nil, nil // not yet provisioned
	}
	lookup := &fakeLookup{er: &models.ExternalResource{
		Name:       "plainsvc",
		ConfigKeys: []models.ConfigKey{{Key: "BASE_URL"}},
	}}
	p := newTestProvisioner(lookup, rc, &fakeSecretWriter{})
	got, err := p.ResolveRunnerSecrets(context.Background(), "default", "proj", "development", []string{"plainsvc"})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("all-plain resource must be skipped, got %+v", got)
	}
}
