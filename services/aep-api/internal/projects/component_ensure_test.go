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

package projects

import (
	"context"
	"testing"

	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/organization"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
	"github.com/wso2/aep/aep-api/internal/clients/secretmanagersvc"
	"github.com/wso2/aep/aep-api/internal/spec"
	"github.com/wso2/aep/aep-api/internal/spec/artifactstest"
)

// ensureRepoSvc is a minimal sourcecontrol.RepoService — only GetRepo is exercised by
// EnsureComponent; the rest panic if reached.
type ensureRepoSvc struct{ repo *sourcecontrol.GitRepository }

func (r ensureRepoSvc) ListByOrg(context.Context, string) ([]sourcecontrol.GitRepository, error) {
	panic("ensureRepoSvc: ListByOrg not expected")
}
func (r ensureRepoSvc) GetRepo(context.Context, string, string) (*sourcecontrol.GitRepository, error) {
	return r.repo, nil
}
func (ensureRepoSvc) CreateRepo(context.Context, string, string, string, string) (*sourcecontrol.GitRepository, error) {
	panic("CreateRepo not expected")
}
func (ensureRepoSvc) EnsureBareRepo(context.Context, string, string, string) (*sourcecontrol.GitRepository, error) {
	panic("EnsureBareRepo not expected")
}
func (ensureRepoSvc) SetWebhookID(context.Context, string, string, int64) error {
	panic("SetWebhookID not expected")
}
func (ensureRepoSvc) DeleteRepo(context.Context, string, string) error {
	panic("DeleteRepo not expected")
}

func TestEnsureComponent_ProvisionsOCComponentFromDesign(t *testing.T) {
	var captured *openchoreo.CreateComponentRequest
	oc := &ocmocks.ComponentClientMock{
		CreateComponentFunc: func(_ context.Context, _, _ string, req *openchoreo.CreateComponentRequest) (*gen.Component, error) {
			captured = req
			return &gen.Component{Name: req.Name}, nil
		},
	}
	// A design with one service component named "order-service".
	files := map[string]string{
		spec.DesignRootFile: "# Overview\n",
		"components/order-service/design.json": "{\n" +
			"  \"name\": \"order-service\",\n" +
			"  \"type\": \"service\",\n" +
			"  \"description\": \"body\",\n" +
			"  \"dependencies\": []\n" +
			"}\n",
	}
	store := spec.NewArtifactStore(&artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return files, nil
		},
	})
	repo := &sourcecontrol.GitRepository{RepoURL: "https://github.com/acme/widgets", DefaultBranch: "main"}
	svc := NewComponentService(oc, nil, store, ensureRepoSvc{repo: repo}, nil, nil, nil)

	if err := svc.EnsureComponent(context.Background(), "acme", "widgets", "order-service"); err != nil {
		t.Fatalf("EnsureComponent: %v", err)
	}
	if captured == nil {
		t.Fatal("EnsureComponent must call CreateComponent")
	}
	if captured.Name != "order-service" {
		t.Errorf("component name = %q, want the k8s slug order-service", captured.Name)
	}
	if captured.Type != "deployment/service" {
		t.Errorf("component type = %q, want deployment/service", captured.Type)
	}
	// AutoBuild=false (builds are BFF-driven at the merge SHA), AutoDeploy=true.
	if captured.AutoBuild || !captured.AutoDeploy {
		t.Errorf("autoBuild/autoDeploy = %v/%v, want false/true", captured.AutoBuild, captured.AutoDeploy)
	}
	wf := captured.Workflow
	if wf == nil || wf.Name != "dockerfile-builder" || wf.Kind != "ClusterWorkflow" {
		t.Fatalf("workflow wrong: %+v", wf)
	}
	if wf.Parameters == nil || wf.Parameters.Repository == nil ||
		wf.Parameters.Repository.URL != "https://github.com/acme/widgets" ||
		wf.Parameters.Repository.Revision == nil || wf.Parameters.Repository.Revision.Branch != "main" {
		t.Fatalf("workflow repository wrong: %+v", wf.Parameters)
	}
	// No repo secretRef — build credentials are pre-staged per WorkflowRun.
	if wf.Parameters.Repository.SecretRef != "" {
		t.Errorf("repository.secretRef must be empty, got %q", wf.Parameters.Repository.SecretRef)
	}
}

// TestEnsureComponent_WebAppKind_UsesWebApplicationEntrypoint is the
// consumer-level regression for the component-kind vocabulary drift bug: a
// design.json carrying the canonical "web-application" type (OpenChoreo's own
// term, spec.ComponentTypeWebApplication) must provision an OC Component
// with the deployment/web-application entrypoint, not silently fall back to a
// plain service (which caused shared-host routing and a missing runtime
// config for the deployed SPA).
func TestEnsureComponent_WebAppKind_UsesWebApplicationEntrypoint(t *testing.T) {
	var captured *openchoreo.CreateComponentRequest
	oc := &ocmocks.ComponentClientMock{
		CreateComponentFunc: func(_ context.Context, _, _ string, req *openchoreo.CreateComponentRequest) (*gen.Component, error) {
			captured = req
			return &gen.Component{Name: req.Name}, nil
		},
	}
	files := map[string]string{
		spec.DesignRootFile: "# Overview\n",
		"components/web-ui/design.json": "{\n" +
			"  \"name\": \"web-ui\",\n" +
			"  \"type\": \"web-application\",\n" +
			"  \"description\": \"body\",\n" +
			"  \"dependencies\": []\n" +
			"}\n",
	}
	store := spec.NewArtifactStore(&artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return files, nil
		},
	})
	repo := &sourcecontrol.GitRepository{RepoURL: "https://github.com/acme/widgets", DefaultBranch: "main"}
	svc := NewComponentService(oc, nil, store, ensureRepoSvc{repo: repo}, nil, nil, nil)

	if err := svc.EnsureComponent(context.Background(), "acme", "widgets", "web-ui"); err != nil {
		t.Fatalf("EnsureComponent: %v", err)
	}
	if captured == nil {
		t.Fatal("EnsureComponent must call CreateComponent")
	}
	if captured.Type != "deployment/web-application" {
		t.Errorf("component type = %q, want deployment/web-application for a %q-typed design component", captured.Type, "web-application")
	}
}

func TestEnsureComponent_DesignMissingComponent_Errors(t *testing.T) {
	oc := &ocmocks.ComponentClientMock{
		CreateComponentFunc: func(context.Context, string, string, *openchoreo.CreateComponentRequest) (*gen.Component, error) {
			t.Error("CreateComponent must not be called when the component is absent from the design")
			return nil, nil
		},
	}
	files := map[string]string{spec.DesignRootFile: "# Overview\n"} // no component dirs
	store := spec.NewArtifactStore(&artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return files, nil
		},
	})
	svc := NewComponentService(oc, nil, store, ensureRepoSvc{repo: &sourcecontrol.GitRepository{RepoURL: "u"}}, nil, nil, nil)

	if err := svc.EnsureComponent(context.Background(), "acme", "widgets", "ghost"); err == nil {
		t.Fatal("a component absent from the design must error (no CR to build)")
	}
}

func TestEnsureComponent_NoStoreOrRepo_Errors(t *testing.T) {
	oc := &ocmocks.ComponentClientMock{}
	// No artifact store.
	if err := NewComponentService(oc, nil, nil, ensureRepoSvc{}, nil, nil, nil).
		EnsureComponent(context.Background(), "a", "p", "c"); err == nil {
		t.Error("nil artifact store must error")
	}
	// No repo service.
	store := spec.NewArtifactStore(&artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{spec.DesignRootFile: "# O\n"}, nil
		},
	})
	if err := NewComponentService(oc, nil, store, nil, nil, nil, nil).
		EnsureComponent(context.Background(), "a", "p", "c"); err == nil {
		t.Error("nil repo service must error")
	}
}

// TestEnsureComponent_ModelAccessWiring covers wireModelAccess
// (ai_agent_model_access.go) through the real EnsureComponent path: an
// ai-agent component must get MODEL_ENDPOINT/MODEL_NAME/MODEL_API_KEY and a
// model-access SecretReference; any other component type must trigger
// neither (spec.resourceTypesForDerivation's "nothing declared, nothing to
// do" discipline); an org with no connected Anthropic key must skip the
// wiring without EnsureComponent itself erroring (a component that cannot
// be created is a worse failure than one that starts unconfigured).
func TestEnsureComponent_ModelAccessWiring(t *testing.T) {
	designFiles := func(componentType string) map[string]string {
		return map[string]string{
			spec.DesignRootFile: "# Overview\n",
			"components/agent-a/design.json": "{\n" +
				"  \"name\": \"agent-a\",\n" +
				"  \"type\": \"" + componentType + "\",\n" +
				"  \"description\": \"body\",\n" +
				"  \"dependencies\": []\n" +
				"}\n",
		}
	}
	repo := &sourcecontrol.GitRepository{RepoURL: "https://github.com/acme/widgets", DefaultBranch: "main"}
	activeTriplet := organization.SecretRefTriplet{
		Name: "anthropic-default", KVPath: "user-app-secrets/acme/anthropic", Property: "api-key", EnvVar: "ANTHROPIC_API_KEY",
	}

	tests := []struct {
		name           string
		componentType  string
		resolverFunc   func(context.Context, string) (organization.SecretRefTriplet, error)
		wantSecretUp   bool // SecretReference create-or-update expected
		wantEnvVarsSet bool // UpdateComponentWorkflowEnvVars expected, with all 3 entries
	}{
		{
			name:          "ai-agent component wires MODEL_* and upserts the SecretReference",
			componentType: "ai-agent",
			resolverFunc: func(context.Context, string) (organization.SecretRefTriplet, error) {
				return activeTriplet, nil
			},
			wantSecretUp:   true,
			wantEnvVarsSet: true,
		},
		{
			name:          "service component does neither",
			componentType: "service",
			resolverFunc: func(context.Context, string) (organization.SecretRefTriplet, error) {
				t.Fatal("a non-ai-agent component must never resolve the org's Anthropic key")
				return organization.SecretRefTriplet{}, nil
			},
			wantSecretUp:   false,
			wantEnvVarsSet: false,
		},
		{
			name:          "org with no connected key skips wiring without erroring",
			componentType: "ai-agent",
			resolverFunc: func(context.Context, string) (organization.SecretRefTriplet, error) {
				return organization.SecretRefTriplet{}, &organization.NotFoundError{What: "org_anthropic_credentials.acme.default"}
			},
			wantSecretUp:   false,
			wantEnvVarsSet: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var gotEnvVars []openchoreo.WorkflowEnvVarRef
			envVarsCalled := false
			oc := &ocmocks.ComponentClientMock{
				CreateComponentFunc: func(_ context.Context, _, _ string, req *openchoreo.CreateComponentRequest) (*gen.Component, error) {
					return &gen.Component{Name: req.Name}, nil
				},
				UpdateComponentWorkflowEnvVarsFunc: func(_ context.Context, _, _, _ string, envVars []openchoreo.WorkflowEnvVarRef) error {
					envVarsCalled = true
					gotEnvVars = envVars
					return nil
				},
			}
			secretUpCalled := false
			secretRefClient := &stubSecretReferenceClient{
				GetSecretReferenceFunc: func(context.Context, string, string) (*secretmanagersvc.SecretReference, error) {
					return nil, secretmanagersvc.ErrNotFound
				},
				CreateSecretReferenceFunc: func(_ context.Context, orgNS string, req secretmanagersvc.CreateSecretReferenceRequest) (*secretmanagersvc.SecretReference, error) {
					secretUpCalled = true
					if req.Name != modelAccessSecretRefName {
						t.Errorf("SecretReference name = %q, want %q", req.Name, modelAccessSecretRefName)
					}
					if req.KVPath != activeTriplet.KVPath {
						t.Errorf("SecretReference KVPath = %q, want %q", req.KVPath, activeTriplet.KVPath)
					}
					if len(req.SecretKeys) != 1 || req.SecretKeys[0] != activeTriplet.Property {
						t.Errorf("SecretReference SecretKeys = %v, want [%q]", req.SecretKeys, activeTriplet.Property)
					}
					return &secretmanagersvc.SecretReference{Name: req.Name, Namespace: orgNS}, nil
				},
			}
			store := spec.NewArtifactStore(&artifactstest.FakeArtifactService{
				ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
					return designFiles(tc.componentType), nil
				},
			})
			resolver := &stubAnthropicKeyResolver{DefaultKeyRefFunc: tc.resolverFunc}
			svc := NewComponentService(oc, nil, store, ensureRepoSvc{repo: repo}, nil, resolver, secretRefClient)

			if err := svc.EnsureComponent(context.Background(), "acme", "widgets", "agent-a"); err != nil {
				t.Fatalf("EnsureComponent must not fail on model-access wiring: %v", err)
			}

			if secretUpCalled != tc.wantSecretUp {
				t.Errorf("SecretReference upsert called = %v, want %v", secretUpCalled, tc.wantSecretUp)
			}
			if envVarsCalled != tc.wantEnvVarsSet {
				t.Fatalf("UpdateComponentWorkflowEnvVars called = %v, want %v", envVarsCalled, tc.wantEnvVarsSet)
			}
			if !tc.wantEnvVarsSet {
				return
			}
			if len(gotEnvVars) != 3 {
				t.Fatalf("env vars = %d, want 3: %+v", len(gotEnvVars), gotEnvVars)
			}
			byKey := map[string]openchoreo.WorkflowEnvVarRef{}
			for _, ev := range gotEnvVars {
				byKey[ev.Key] = ev
			}
			if got := byKey[modelEndpointEnvVar]; got.Value != modelEndpointDefault || got.ValueFrom != nil {
				t.Errorf("%s = %+v, want literal %q", modelEndpointEnvVar, got, modelEndpointDefault)
			}
			if got := byKey[modelNameEnvVar]; got.Value != modelNameDefault || got.ValueFrom != nil {
				t.Errorf("%s = %+v, want literal %q", modelNameEnvVar, got, modelNameDefault)
			}
			apiKey := byKey[modelAPIKeyEnvVar]
			if apiKey.ValueFrom == nil || apiKey.ValueFrom.SecretKeyRef == nil ||
				apiKey.ValueFrom.SecretKeyRef.Name != modelAccessSecretRefName ||
				apiKey.ValueFrom.SecretKeyRef.Key != activeTriplet.Property {
				t.Errorf("%s wrong: %+v, want SecretKeyRef{Name: %q, Key: %q}",
					modelAPIKeyEnvVar, apiKey, modelAccessSecretRefName, activeTriplet.Property)
			}
		})
	}
}

// TestEnsureComponent_ModelAccessWiring_NotConfigured proves EnsureComponent
// never fails when the model-access ports simply aren't wired (nil
// resolver/secretRefClient) — the same "not configured" degraded mode
// buildCredSvc/repoSvc already support elsewhere in this file.
func TestEnsureComponent_ModelAccessWiring_NotConfigured(t *testing.T) {
	oc := &ocmocks.ComponentClientMock{
		CreateComponentFunc: func(_ context.Context, _, _ string, req *openchoreo.CreateComponentRequest) (*gen.Component, error) {
			return &gen.Component{Name: req.Name}, nil
		},
		UpdateComponentWorkflowEnvVarsFunc: func(context.Context, string, string, string, []openchoreo.WorkflowEnvVarRef) error {
			t.Fatal("UpdateComponentWorkflowEnvVars must not be called when model access is unconfigured")
			return nil
		},
	}
	files := map[string]string{
		spec.DesignRootFile: "# Overview\n",
		"components/agent-a/design.json": "{\n" +
			"  \"name\": \"agent-a\",\n" +
			"  \"type\": \"ai-agent\",\n" +
			"  \"description\": \"body\",\n" +
			"  \"dependencies\": []\n" +
			"}\n",
	}
	store := spec.NewArtifactStore(&artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return files, nil
		},
	})
	repo := &sourcecontrol.GitRepository{RepoURL: "https://github.com/acme/widgets", DefaultBranch: "main"}
	svc := NewComponentService(oc, nil, store, ensureRepoSvc{repo: repo}, nil, nil, nil)

	if err := svc.EnsureComponent(context.Background(), "acme", "widgets", "agent-a"); err != nil {
		t.Fatalf("EnsureComponent must not fail when model access is unconfigured: %v", err)
	}
}
