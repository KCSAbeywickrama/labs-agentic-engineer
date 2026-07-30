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

package validation

import (
	"context"
	"errors"
	"testing"
)

// fakeCredProvider records the project it was asked for and returns a canned
// account, so the service test can assert the execution→project fence without
// the real mock provider.
type fakeCredProvider struct {
	gotProject string
	gotReq     CredentialRequest
	cred       TestCredential
}

func (f *fakeCredProvider) RequestCredentials(_ context.Context, _, projectID string, req CredentialRequest) (TestCredential, error) {
	f.gotProject = projectID
	f.gotReq = req
	return f.cred, nil
}

func TestRequestCredentials_ResolvesProjectAndReturnsAccount(t *testing.T) {
	prov := &fakeCredProvider{cred: TestCredential{Username: "admin", Password: "admin", Mock: true, Note: "mock"}}
	svc := NewCredentialService(locatorFor("proj"), prov)

	got, err := svc.RequestCredentials(context.Background(), theCycle, theOrg, CredentialRequest{Role: "admin"})
	if err != nil {
		t.Fatalf("RequestCredentials: %v", err)
	}
	if got.Username != "admin" || got.Password != "admin" || !got.Mock {
		t.Errorf("credential = %+v; want mock admin/admin", got)
	}
	// The provider must be fenced to the resolved project, not handed the raw
	// cycle id or org — this is the tenant fence real provisioning relies on.
	if prov.gotProject != "proj" {
		t.Errorf("provider project = %q; want %q", prov.gotProject, "proj")
	}
	if prov.gotReq.Role != "admin" {
		t.Errorf("provider role hint = %q; want %q", prov.gotReq.Role, "admin")
	}
}

func TestRequestCredentials_UnknownCycleIs404(t *testing.T) {
	prov := &fakeCredProvider{}
	svc := NewCredentialService(locatorFor("proj"), prov)

	_, err := svc.RequestCredentials(context.Background(), "cycle-nope", theOrg, CredentialRequest{})
	if !errors.Is(err, ErrCycleNotFound) {
		t.Fatalf("want ErrCycleNotFound (→ 404), got %v", err)
	}
	if prov.gotProject != "" {
		t.Errorf("provider must not be called on an unknown cycle; got project %q", prov.gotProject)
	}
}

// A credential is the most sensitive thing this surface hands out, so the tenant
// fence is asserted here too and not only on the context read.
func TestRequestCredentials_AnotherOrgsCycleIs404(t *testing.T) {
	prov := &fakeCredProvider{}
	svc := NewCredentialService(locatorFor("proj"), prov)

	_, err := svc.RequestCredentials(context.Background(), theCycle, strangeOrg, CredentialRequest{})
	if !errors.Is(err, ErrCycleNotFound) {
		t.Fatalf("want ErrCycleNotFound for another org's cycle, got %v", err)
	}
	if prov.gotProject != "" {
		t.Errorf("issued a credential for an unowned cycle; got project %q", prov.gotProject)
	}
}
