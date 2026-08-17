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

// The SecretReference must be authored in the ReleaseBinding's namespace —
// ocOrgID, passed through unmodified — never a namespace derived from the vault
// path. secretsprovider.SecretLocation.CPNamespace states the rule, and this
// file got it wrong twice in opposite directions: `wc-default-…` (did not
// exist, create 500'd) and then the vault key's segment 1, `wc-019f40d1-…`
// (existed, create SUCCEEDED, and the ReleaseBinding in `default` could not see
// it — OpenChoreo failed the whole render with `SecretReference
// "ai-agent-model-access" not found` and the agent never got MODEL_*).
//
// The second failure is why this test asserts on the namespace rather than on
// the call succeeding: a create that succeeds proves the namespace EXISTS, not
// that the consumer can see it.
func TestUpsertModelAccessSecretReference_UsesTheReleaseBindingNamespace(t *testing.T) {
	var gotNS []string
	sr := &namespaceCapturingSecretRefClient{seen: &gotNS}
	oc := &ocmocks.ComponentClientMock{
		UpdateComponentWorkflowEnvVarsFunc: func(context.Context, string, string, string, []openchoreo.WorkflowEnvVarRef) error {
			return nil
		},
	}
	files := map[string]string{
		spec.DesignRootFile:                  "# Overview\n",
		"components/hotel-agent/design.json": agentDesignJSON("hotel-agent"),
	}
	svc := NewComponentService(oc, nil, modelAccessStore(files), nil, nil,
		fakeKeyResolver{triplet: organization.SecretRefTriplet{
			// The vault path's org segment is DELIBERATELY different from the
			// control-plane namespace here — that difference is the bug.
			KVPath:   "user-app-secrets/wc-019f40d1-b04b186b/anthropic-secrets",
			Property: "api-key",
		}}, sr)

	if err := svc.SyncProjectModelAccess(context.Background(), "default", "hotels"); err != nil {
		t.Fatalf("SyncProjectModelAccess: %v", err)
	}
	for _, ns := range gotNS {
		if ns != "default" {
			t.Fatalf("SecretReference authored in %q, want the ReleaseBinding's namespace %q — a vault-path-derived namespace makes the CR invisible to its consumer", ns, "default")
		}
	}
	if len(gotNS) == 0 {
		t.Fatal("no SecretReference upsert attempted")
	}
}

// namespaceCapturingSecretRefClient records the namespace of every upsert.
type namespaceCapturingSecretRefClient struct{ seen *[]string }

func (c *namespaceCapturingSecretRefClient) GetSecretReference(_ context.Context, ns, _ string) (*secretmanagersvc.SecretReference, error) {
	*c.seen = append(*c.seen, ns)
	return nil, secretmanagersvc.ErrNotFound
}
func (c *namespaceCapturingSecretRefClient) CreateSecretReference(_ context.Context, ns string, _ secretmanagersvc.CreateSecretReferenceRequest) (*secretmanagersvc.SecretReference, error) {
	*c.seen = append(*c.seen, ns)
	return &secretmanagersvc.SecretReference{}, nil
}
func (c *namespaceCapturingSecretRefClient) UpdateSecretReference(_ context.Context, ns, _ string, _ secretmanagersvc.CreateSecretReferenceRequest) (*secretmanagersvc.SecretReference, error) {
	*c.seen = append(*c.seen, ns)
	return &secretmanagersvc.SecretReference{}, nil
}
func (c *namespaceCapturingSecretRefClient) DeleteSecretReference(context.Context, string, string) error {
	return nil
}
