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
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/organization"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// chainRecorder is the OC create-chain fake under the brief's name so the
// path-selection tests read clearly. Same package as fakeOCSurface.
type chainRecorder = fakeOCSurface

func (r *chainRecorder) client() OCJobSurface { return r }

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

type fakeAnthropicCreds struct {
	row *organization.OrgAnthropicCredential
}

func (f fakeAnthropicCreds) GetByOrg(context.Context, string) (*organization.OrgAnthropicCredential, error) {
	return f.row, nil
}
func (f fakeAnthropicCreds) UpdateColumns(context.Context, string, map[string]any) error { return nil }
func (f fakeAnthropicCreds) Tx(context.Context, func(organization.OrgAnthropicTx) error) error {
	return nil
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

func fullSecretRefs() (*organization.OrgAnthropicCredential, *organization.OrgCredential) {
	return &organization.OrgAnthropicCredential{
			SecretRefName:      strPtr("acme-anthropic-secrets"),
			SecretRefKVPath:    strPtr("user-app-secrets/wc-acme/acme-anthropic-secrets"),
			SecretRefProperty:  strPtr("api-key"),
			SMAPISecretRefName: strPtr("acme-anthropic-secrets"),
			SMAPIKVPath:        strPtr("user-app-secrets/wc-acme/acme-anthropic-secrets"),
			SMAPIProperty:      strPtr("api-key"),
		}, &organization.OrgCredential{
			SecretRefName:      strPtr("acme-github-pat-secrets"),
			SecretRefKVPath:    strPtr("user-app-secrets/wc-acme/acme-github-pat-secrets"),
			SecretRefProperty:  strPtr("token"),
			SMAPISecretRefName: strPtr("acme-github-pat-secrets"),
			SMAPIKVPath:        strPtr("user-app-secrets/wc-acme/acme-github-pat-secrets"),
			SMAPIProperty:      strPtr("token"),
		}
}

func newCodingDispatchExecutor(anthropic *organization.OrgAnthropicCredential, github *organization.OrgCredential) *CodingExecutor {
	orgUUID := uuid.MustParse("d3adbeef-1234-4321-abcd-c0ffee123456")
	return NewCodingExecutor(
		nil,
		fakeRepos{repo: &sourcecontrol.GitRepository{RepoURL: "https://github.com/acme/widgets", RepoSlug: "acme-widgets"}},
		fakeIdentities{},
		fakeTokens{},
		newFakeExecRepo(),
		"http://git",
		"http://platform",
		fakeOrgRepo{org: &organization.Organization{Name: "acme", UUID: orgUUID}},
		fakeAnthropicCreds{row: anthropic},
		fakeGitHubCreds{row: github},
		nil,
	)
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

func newOCDispatchExecutor(rec *chainRecorder) *CodingExecutor {
	anthropic, github := fullSecretRefs()
	e := newCodingDispatchExecutor(anthropic, github)
	e.WithOCDispatch(NewOCDispatcher(rec.client()).WithImage("ghcr.io/wso2/aep/remote-worker:latest"))
	return e
}

// TestDispatch_OCPathDispatchesThroughOpenChoreo pins the only dispatch path:
// a milestone cycle goes through OpenChoreo.
func TestDispatch_OCPathDispatchesThroughOpenChoreo(t *testing.T) {
	rec := &chainRecorder{}
	e := newOCDispatchExecutor(rec)

	runName, err := e.Dispatch(context.Background(), codingMilestoneDispatch())
	if err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	if !strings.HasPrefix(runName, "ca-") {
		t.Errorf("run name = %q, want the ca- prefix (the watcher discriminator)", runName)
	}
	if len(rec.calls) == 0 {
		t.Fatal("the OC chain was never walked")
	}
	if rec.create.Name != runName {
		t.Errorf("component name %q != returned run name %q", rec.create.Name, runName)
	}
}

// TestDispatch_ValidationCycleDispatchesOnOCPath: validation carries task kind
// and deadline through the OpenChoreo Component path.
func TestDispatch_ValidationCycleDispatchesOnOCPath(t *testing.T) {
	rec := &chainRecorder{}
	e := newOCDispatchExecutor(rec)

	req := codingMilestoneDispatch()
	req.Kind = delivery.CycleKindValidation
	req.IssueNumber = 77

	if _, err := e.Dispatch(context.Background(), req); err != nil {
		t.Fatalf("a validation cycle must dispatch on the OC path: %v", err)
	}
	var kind string
	for _, ev := range rec.load.Env {
		if ev.Key == "AEP_TASK_KIND" {
			kind = ev.Value
		}
	}
	if kind != validationTaskKind {
		t.Errorf("AEP_TASK_KIND = %q, want %q", kind, validationTaskKind)
	}
	if rec.create.Parameters["activeDeadlineSeconds"] != int(validationDeadlineSeconds) {
		t.Errorf("validation deadline = %v, want %d", rec.create.Parameters["activeDeadlineSeconds"], validationDeadlineSeconds)
	}
	if rec.create.DisplayName != "Validation cycle — milestone #1 v1" {
		t.Errorf("displayName = %q", rec.create.DisplayName)
	}
}

// TestDispatch_OCPathStillRequiresTheOrgsSecretRefs: refs-only means the run
// cannot start without them, and the message must name which one is missing.
func TestDispatch_OCPathStillRequiresTheOrgsSecretRefs(t *testing.T) {
	rec := &chainRecorder{}
	anthropic, github := fullSecretRefs()
	anthropic.SecretRefName = nil
	anthropic.SMAPISecretRefName = nil
	e := newCodingDispatchExecutor(anthropic, github)
	e.WithOCDispatch(NewOCDispatcher(rec.client()).WithImage("runner:1"))

	_, err := e.Dispatch(context.Background(), codingMilestoneDispatch())
	if err == nil {
		t.Fatal("expected an error when the anthropic secret ref is missing")
	}
	if !strings.Contains(err.Error(), "anthropic") {
		t.Errorf("error must name the missing credential, got %v", err)
	}
	if len(rec.calls) != 0 {
		t.Errorf("nothing may be created before the refs resolve, saw %v", rec.calls)
	}
}
