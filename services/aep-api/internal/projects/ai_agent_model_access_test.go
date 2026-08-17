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

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
	"github.com/wso2/aep/aep-api/internal/clients/secretmanagersvc"
	"github.com/wso2/aep/aep-api/internal/organization"
	"github.com/wso2/aep/aep-api/internal/spec"
	"github.com/wso2/aep/aep-api/internal/spec/artifactstest"
)

// The model-access SecretReference must land in the SAME org namespace every
// other SecretReference for that org already lives in. That namespace is
// derived from the org's Thunder UUID, never from the OpenChoreo org handle —
// deriving it from the handle produced `wc-default-…`, a namespace that does
// not exist, so the create 500'd and agents deployed with no MODEL_*.
//
// Reading it out of the vault key the org's own row carries cannot disagree
// with where the key actually lives, in local or cloud.
func TestOrgNamespaceFromVaultKey(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		kvPath  string
		want    string
		wantErr bool
	}{
		{
			name:   "reads the org namespace a real key carries",
			kvPath: "user-app-secrets/wc-019f40d1-b04b186b/anthropic-secrets",
			want:   "wc-019f40d1-b04b186b",
		},
		{
			name:   "tolerates a leading slash",
			kvPath: "/user-app-secrets/wc-019f40d1-b04b186b/anthropic-secrets",
			want:   "wc-019f40d1-b04b186b",
		},
		{
			name:    "rejects a key with no namespace segment",
			kvPath:  "user-app-secrets/anthropic-secrets",
			wantErr: true,
		},
		{
			name:    "rejects a key under a different prefix",
			kvPath:  "some-other-store/wc-019f40d1-b04b186b/anthropic-secrets",
			wantErr: true,
		},
		{
			name:    "rejects an empty key",
			kvPath:  "",
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := orgNamespaceFromVaultKey(tc.kvPath)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("orgNamespaceFromVaultKey(%q) = %q, nil; want an error", tc.kvPath, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("orgNamespaceFromVaultKey(%q): unexpected error: %v", tc.kvPath, err)
			}
			if got != tc.want {
				t.Errorf("orgNamespaceFromVaultKey(%q) = %q; want %q", tc.kvPath, got, tc.want)
			}
		})
	}
}

// The handle-derived namespace the bug produced must never be what we compute.
func TestOrgNamespaceFromVaultKey_isNotHandleDerived(t *testing.T) {
	t.Parallel()
	got, err := orgNamespaceFromVaultKey("user-app-secrets/wc-019f40d1-b04b186b/anthropic-secrets")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got == "wc-default-37a8eec1" {
		t.Fatalf("computed the handle-derived namespace %q — that namespace does not exist", got)
	}
}

// --- SyncProjectModelAccess (the builds-green sweep) --------------------------

// fakeKeyResolver serves a canned org key triplet.
type fakeKeyResolver struct{ triplet organization.SecretRefTriplet }

func (f fakeKeyResolver) DefaultKeyRef(context.Context, string) (organization.SecretRefTriplet, error) {
	return f.triplet, nil
}

// fakeSecretRefClient accepts any SecretReference upsert. GetSecretReference
// reports not-found so the create branch runs.
type fakeSecretRefClient struct{}

func (fakeSecretRefClient) GetSecretReference(context.Context, string, string) (*secretmanagersvc.SecretReference, error) {
	return nil, secretmanagersvc.ErrNotFound
}
func (fakeSecretRefClient) CreateSecretReference(context.Context, string, secretmanagersvc.CreateSecretReferenceRequest) (*secretmanagersvc.SecretReference, error) {
	return &secretmanagersvc.SecretReference{}, nil
}
func (fakeSecretRefClient) UpdateSecretReference(context.Context, string, string, secretmanagersvc.CreateSecretReferenceRequest) (*secretmanagersvc.SecretReference, error) {
	return &secretmanagersvc.SecretReference{}, nil
}
func (fakeSecretRefClient) DeleteSecretReference(context.Context, string, string) error { return nil }

func modelAccessStore(files map[string]string) *spec.ArtifactStore {
	return spec.NewArtifactStore(&artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return files, nil
		},
	})
}

func agentDesignJSON(name string) string {
	return "{\n  \"name\": \"" + name + "\",\n  \"type\": \"" + spec.ComponentTypeAIAgent +
		"\",\n  \"description\": \"Agent.\",\n  \"dependencies\": []\n}\n"
}

// THE REGRESSION. The write target is the ReleaseBinding, which does not exist
// until a build has produced a workload — so the pre-build EnsureComponent pass
// reaches nothing on a first deploy and the agent comes up with no MODEL_* at
// all. This sweep runs at builds-green, when the binding exists. If it stops
// writing MODEL_*, every agent's first deploy 500s on every chat request again.
func TestSyncProjectModelAccess_WritesModelEnvForEveryAIAgent(t *testing.T) {
	var wrote []openchoreo.WorkflowEnvVarRef
	var wroteFor []string
	oc := &ocmocks.ComponentClientMock{
		UpdateComponentWorkflowEnvVarsFunc: func(_ context.Context, _, _, componentName string, envVars []openchoreo.WorkflowEnvVarRef) error {
			wroteFor = append(wroteFor, componentName)
			wrote = append(wrote, envVars...)
			return nil
		},
	}
	files := map[string]string{
		spec.DesignRootFile:                  "# Overview\n",
		"components/hotel-agent/design.json": agentDesignJSON("hotel-agent"),
		"components/hotel-api/design.json":   "{\n  \"name\": \"hotel-api\",\n  \"type\": \"service\",\n  \"description\": \"API.\",\n  \"dependencies\": []\n}\n",
	}
	svc := NewComponentService(oc, nil, modelAccessStore(files), nil, nil,
		fakeKeyResolver{triplet: organization.SecretRefTriplet{
			KVPath:   "user-app-secrets/wc-abc123/anthropic-secrets",
			Property: "apiKey",
		}}, fakeSecretRefClient{})

	if err := svc.SyncProjectModelAccess(context.Background(), "acme", "hotels"); err != nil {
		t.Fatalf("SyncProjectModelAccess: %v", err)
	}

	// Only the ai-agent — a service has no model access to grant.
	if len(wroteFor) != 1 || wroteFor[0] != "hotel-agent" {
		t.Fatalf("wrote env for %v, want exactly [hotel-agent]", wroteFor)
	}
	got := map[string]bool{}
	for _, e := range wrote {
		got[e.Key] = true
	}
	for _, want := range []string{modelEndpointEnvVar, modelNameEnvVar, modelAPIKeyEnvVar} {
		if !got[want] {
			t.Errorf("missing %s — the agent starts with 'missing config' and 500s on every request", want)
		}
	}
	// MODEL_API_KEY must be a secret reference, never a literal.
	for _, e := range wrote {
		if e.Key != modelAPIKeyEnvVar {
			continue
		}
		if e.Value != "" {
			t.Errorf("MODEL_API_KEY carried a literal value — it must ride a SecretKeyRef")
		}
		if e.ValueFrom == nil || e.ValueFrom.SecretKeyRef == nil || e.ValueFrom.SecretKeyRef.Key != "apiKey" {
			t.Errorf("MODEL_API_KEY secretKeyRef wrong: %+v", e.ValueFrom)
		}
	}
}

// A project with no ai-agent costs no OpenChoreo round trip at all.
func TestSyncProjectModelAccess_NoAgentIsANoOp(t *testing.T) {
	calls := 0
	oc := &ocmocks.ComponentClientMock{
		UpdateComponentWorkflowEnvVarsFunc: func(context.Context, string, string, string, []openchoreo.WorkflowEnvVarRef) error {
			calls++
			return nil
		},
	}
	files := map[string]string{
		spec.DesignRootFile:                "# Overview\n",
		"components/hotel-api/design.json": "{\n  \"name\": \"hotel-api\",\n  \"type\": \"service\",\n  \"description\": \"API.\",\n  \"dependencies\": []\n}\n",
	}
	svc := NewComponentService(oc, nil, modelAccessStore(files), nil, nil,
		fakeKeyResolver{}, fakeSecretRefClient{})

	if err := svc.SyncProjectModelAccess(context.Background(), "acme", "hotels"); err != nil {
		t.Fatalf("SyncProjectModelAccess: %v", err)
	}
	if calls != 0 {
		t.Errorf("a design with no ai-agent must make no env write, got %d", calls)
	}
}
