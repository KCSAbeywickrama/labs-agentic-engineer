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

package codingagent

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/organization"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

func strPtr(s string) *string { return &s }

type fakeOrgRepo struct {
	org *organization.Organization
}

func (f fakeOrgRepo) ListByNames(context.Context, []string) ([]organization.Organization, error) {
	return nil, nil
}
func (f fakeOrgRepo) GetByName(context.Context, string) (*organization.Organization, error) {
	return f.org, nil
}
func (f fakeOrgRepo) Create(context.Context, *organization.Organization) error { return nil }
func (f fakeOrgRepo) SetThunderOrgUUID(context.Context, string, uuid.UUID) error {
	return nil
}

// fakeCodingKey stands in for the organization domain's answer to "which
// Anthropic credential does this org's coding run bill". WHICH key that is —
// the coding override or the default — is decided and tested in the
// organization package (TestResolveCodingSecretRef_*); dispatch's job is only
// to mount whatever it is handed, and to abort when nothing can be handed to it.
type fakeCodingKey struct {
	ref organization.SecretRefTriplet
	err error
}

func (f fakeCodingKey) ResolveCodingSecretRef(context.Context, string) (organization.SecretRefTriplet, error) {
	return f.ref, f.err
}

type fakeGitHubCreds struct {
	row *organization.OrgCredential
}

func (f fakeGitHubCreds) GetByOrg(context.Context, string) (*organization.OrgCredential, error) {
	return f.row, nil
}
func (f fakeGitHubCreds) GetByInstallationID(context.Context, int64) (*organization.OrgCredential, error) {
	return nil, nil
}
func (f fakeGitHubCreds) UpdateColumns(context.Context, string, map[string]any) error { return nil }
func (f fakeGitHubCreds) ListActiveRows(context.Context) ([]organization.OrgCredential, error) {
	return nil, nil
}
func (f fakeGitHubCreds) ListBoundInstallations(context.Context) ([]organization.BoundInstallation, error) {
	return nil, nil
}
func (f fakeGitHubCreds) OrgIDByRepoURL(context.Context, string) (string, error) { return "", nil }
func (f fakeGitHubCreds) Tx(context.Context, func(organization.OrgCredentialTx) error) error {
	return nil
}

func fullSecretRefs() (fakeCodingKey, *organization.OrgCredential) {
	return fakeCodingKey{ref: organization.SecretRefTriplet{
			Name:     "acme-anthropic-secrets",
			KVPath:   "user-app-secrets/wc-acme/acme-anthropic-secrets",
			Property: "api-key",
		}}, &organization.OrgCredential{
			SecretRefName:      strPtr("acme-github-pat-secrets"),
			SecretRefKVPath:    strPtr("user-app-secrets/wc-acme/acme-github-pat-secrets"),
			SecretRefProperty:  strPtr("token"),
			SMAPISecretRefName: strPtr("acme-github-pat-secrets"),
			SMAPIKVPath:        strPtr("user-app-secrets/wc-acme/acme-github-pat-secrets"),
			SMAPIProperty:      strPtr("token"),
		}
}

func newCodingDispatchExecutor(anthropic fakeCodingKey, github *organization.OrgCredential, k8sJob *K8sJobDispatcher, proxyConfigured bool) *CodingExecutor {
	orgUUID := uuid.MustParse("d3adbeef-1234-4321-abcd-c0ffee123456")
	e := NewCodingExecutor(
		nil,
		fakeRepos{repo: &sourcecontrol.GitRepository{RepoURL: "https://github.com/acme/widgets", RepoSlug: "acme-widgets"}},
		fakeIdentities{},
		nil,
		fakeTokens{},
		newFakeExecRepo(),
		"http://git",
		"http://platform",
		fakeOrgRepo{org: &organization.Organization{Name: "acme", UUID: orgUUID}},
		anthropic,
		fakeGitHubCreds{row: github},
		nil,
	)
	e.runnerImage = "runner:1"
	e.clusterSecretStore = "default"
	if proxyConfigured {
		e.proxy = &Dispatcher{}
	}
	if k8sJob != nil {
		e.WithK8sJobDispatch(k8sJob)
	}
	return e
}

func codingMilestoneDispatch() delivery.MilestoneDispatch {
	return delivery.MilestoneDispatch{
		OrgID: "acme", ProjectID: "widgets",
		MilestoneNumber: 1, MilestoneTitle: "v1",
		Kind:    delivery.CycleKindCoding,
		RunID:   "run-1",
		CycleID: "11111111-1111-1111-1111-111111111111",
	}
}

// A run whose Anthropic credential cannot be resolved must not quietly take the
// direct-k8s path instead: that path delivers no secrets at all, so "fall back"
// would mean launching an agent with no key rather than reporting the problem.
func TestDispatch_ProxyConfigured_UnresolvableAnthropicKey_ErrorsNoFallback(t *testing.T) {
	_, github := fullSecretRefs()
	anthropic := fakeCodingKey{err: errors.New(
		"coding-agent Anthropic key for org \"acme\" is configured but secret_ref_kv_path is not populated")}
	e := newCodingDispatchExecutor(anthropic, github, &K8sJobDispatcher{}, true)

	_, err := e.Dispatch(context.Background(), codingMilestoneDispatch())
	if err == nil {
		t.Fatal("expected error when the anthropic secret ref cannot be resolved")
	}
	if !strings.Contains(err.Error(), "Anthropic") || !strings.Contains(err.Error(), "secret_ref_kv_path") {
		t.Fatalf("error must carry the resolver's diagnosis, got: %v", err)
	}
}

func TestDispatch_ProxyConfigured_MissingGitHubRef_ErrorsNoFallback(t *testing.T) {
	anthropic, github := fullSecretRefs()
	github.SecretRefName = nil
	github.SMAPISecretRefName = nil
	e := newCodingDispatchExecutor(anthropic, github, &K8sJobDispatcher{}, true)

	_, err := e.Dispatch(context.Background(), codingMilestoneDispatch())
	if err == nil {
		t.Fatal("expected error when github secret ref is missing")
	}
	if !strings.Contains(err.Error(), "github") {
		t.Fatalf("error must name missing github ref, got: %v", err)
	}
}

func TestDispatch_K8sJobOnly_ErrorsSecretDeliveryRemoved(t *testing.T) {
	anthropic, github := fullSecretRefs()
	rec := newRecordingK8sClient()
	k8s := NewK8sJobDispatcher(rec, "http://platform", "runner:1")
	e := newCodingDispatchExecutor(anthropic, github, k8s, false)

	_, err := e.Dispatch(context.Background(), codingMilestoneDispatch())
	if err == nil {
		t.Fatal("expected error when only k8s-job path is configured")
	}
	if !strings.Contains(err.Error(), "plaintext secret delivery removed") {
		t.Fatalf("error must refuse k8s-job secret delivery, got: %v", err)
	}
	if len(rec.ops) != 0 {
		t.Fatalf("k8s-job dispatch must not write Secret/ExternalSecret, saw ops: %+v", rec.ops)
	}
}
