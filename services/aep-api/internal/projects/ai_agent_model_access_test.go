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

// THE REGRESSION, restated for the deployment path. Model access is granted by
// component TYPE rather than declared as a dependency (ADR-0016), so OpenChoreo
// never resolves it while rendering a release — the platform must compose it
// into the binding write itself. These values ride the deploy stage's single
// ApplyReleaseBinding call (DeploymentService.envVarsWithModelAccess), which is
// the only moment a binding is guaranteed to exist. An earlier design wrote them
// from the pre-build EnsureComponent pass and every agent's FIRST deploy came up
// with no MODEL_* at all, 503ing on /healthz and 500ing on every chat.
func TestModelAccessEnvVars_ReturnsTheThreeModelVars(t *testing.T) {
	svc := NewComponentService(
		&ocmocks.ComponentClientMock{}, nil, modelAccessStore(nil), nil, nil,
		fakeKeyResolver{triplet: organization.SecretRefTriplet{
			Name: "anthropic-default", KVPath: "user-app-secrets/acme/anthropic", Property: "api-key",
		}},
		fakeSecretRefClient{},
	).(*componentService)

	got, err := svc.ModelAccessEnvVars(context.Background(), "acme")
	if err != nil {
		t.Fatalf("ModelAccessEnvVars: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("env var count = %d, want 3: %+v", len(got), got)
	}

	byKey := map[string]openchoreo.WorkflowEnvVarRef{}
	for _, v := range got {
		byKey[v.Key] = v
	}
	if v := byKey[modelEndpointEnvVar]; v.Value != modelEndpointDefault {
		t.Errorf("%s = %q, want %q", modelEndpointEnvVar, v.Value, modelEndpointDefault)
	}
	if v := byKey[modelNameEnvVar]; v.Value != modelNameDefault {
		t.Errorf("%s = %q, want %q", modelNameEnvVar, v.Value, modelNameDefault)
	}
	// The key itself is never a literal: it is a SecretKeyRef naming the
	// org-scoped SecretReference, which ESO materialises into the consuming
	// namespace. A literal here would put the org's Anthropic key in a CR.
	key := byKey[modelAPIKeyEnvVar]
	if key.Value != "" {
		t.Errorf("%s carries a literal value %q — it must be a SecretKeyRef", modelAPIKeyEnvVar, key.Value)
	}
	if key.ValueFrom == nil || key.ValueFrom.SecretKeyRef == nil {
		t.Fatalf("%s has no SecretKeyRef: %+v", modelAPIKeyEnvVar, key)
	}
	if got, want := key.ValueFrom.SecretKeyRef.Name, modelAccessSecretRefName; got != want {
		t.Errorf("SecretKeyRef.Name = %q, want %q", got, want)
	}
	if got, want := key.ValueFrom.SecretKeyRef.Key, "api-key"; got != want {
		t.Errorf("SecretKeyRef.Key = %q, want %q (the triplet's property)", got, want)
	}
}

// An org with no connected Anthropic key is expected, not exceptional: a
// brand-new org before its first Settings visit. Yielding (nil, nil) lets the
// agent deploy and report 503 from /healthz — a state an operator can see and
// fix — where an error would fail the whole deploy and leave no agent at all.
func TestModelAccessEnvVars_NoConnectedKeyIsNotAnError(t *testing.T) {
	svc := NewComponentService(
		&ocmocks.ComponentClientMock{}, nil, modelAccessStore(nil), nil, nil,
		noKeyResolver{}, fakeSecretRefClient{},
	).(*componentService)

	got, err := svc.ModelAccessEnvVars(context.Background(), "acme")
	if err != nil {
		t.Fatalf("an org with no key must not error, got: %v", err)
	}
	if got != nil {
		t.Errorf("env vars = %+v, want nil", got)
	}
}

// noKeyResolver reports the org has no connected default key.
type noKeyResolver struct{}

func (noKeyResolver) DefaultKeyRef(context.Context, string) (organization.SecretRefTriplet, error) {
	return organization.SecretRefTriplet{}, &organization.NotFoundError{}
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
	files := map[string]string{
		spec.DesignRootFile:                  "# Overview\n",
		"components/hotel-agent/design.json": agentDesignJSON("hotel-agent"),
	}
	svc := NewComponentService(&ocmocks.ComponentClientMock{}, nil, modelAccessStore(files), nil, nil,
		fakeKeyResolver{triplet: organization.SecretRefTriplet{
			// The vault path's org segment is DELIBERATELY different from the
			// control-plane namespace here — that difference is the bug.
			KVPath:   "user-app-secrets/wc-019f40d1-b04b186b/anthropic-secrets",
			Property: "api-key",
		}}, sr)

	if _, err := svc.(*componentService).ModelAccessEnvVars(context.Background(), "default"); err != nil {
		t.Fatalf("ModelAccessEnvVars: %v", err)
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
