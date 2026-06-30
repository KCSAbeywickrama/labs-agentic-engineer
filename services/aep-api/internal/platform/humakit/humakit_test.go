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

package humakit

import (
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/humatest"

	"github.com/wso2/aep/aep-api/internal/platform/tenant"
	"github.com/wso2/aep/aep-api/middleware/jwt"
)

// resolveWith runs OrgScopedInput.Resolve with the given JWT claim org and
// returns the input (with OrgHandle bound by Resolve) plus the resolver errors.
// There is no path org any more — the active org is derived solely from the
// token, so a cross-org request is unrepresentable here by construction.
func resolveWith(t *testing.T, claimOrg string) (*OrgScopedInput, []error) {
	t.Helper()
	r := httptest.NewRequest("GET", "/api/v1/projects", nil)
	if claimOrg != "" {
		r = r.WithContext(jwt.WithClaims(r.Context(), &jwt.Claims{OuHandle: claimOrg}))
	}
	ctx := humatest.NewContext(&huma.Operation{}, r, httptest.NewRecorder())
	in := &OrgScopedInput{}
	return in, in.Resolve(ctx)
}

func statusOf(t *testing.T, errs []error) int {
	t.Helper()
	if len(errs) == 0 {
		return 0
	}
	se, ok := errs[0].(huma.StatusError)
	if !ok {
		t.Fatalf("expected a huma.StatusError, got %T (%v)", errs[0], errs[0])
	}
	return se.GetStatus()
}

func TestOrgScopedResolve_Enforce(t *testing.T) {
	SetGateMode(tenant.GateModeEnforce)
	t.Cleanup(func() { SetGateMode(tenant.GateModeEnforce) })

	// A verified token that names an org is bound onto OrgHandle and passes.
	in, errs := resolveWith(t, "acme")
	if len(errs) != 0 {
		t.Fatalf("valid token org should pass, got %v", errs)
	}
	if in.OrgHandle != "acme" {
		t.Fatalf("Resolve must bind the token org onto OrgHandle, got %q", in.OrgHandle)
	}

	// No org claim → 401: the active org cannot be derived from the token.
	_, noClaimErrs := resolveWith(t, "")
	if got := statusOf(t, noClaimErrs); got != 401 {
		t.Fatalf("missing org claim should 401, got %d", got)
	}
}

func TestOrgScopedResolve_LogModePassesThrough(t *testing.T) {
	SetGateMode(tenant.GateModeLog)
	t.Cleanup(func() { SetGateMode(tenant.GateModeEnforce) })

	// Log mode observes but does not enforce the missing-org-claim deny.
	if _, errs := resolveWith(t, ""); len(errs) != 0 {
		t.Fatalf("log mode must pass a missing org claim through, got %v", errs)
	}
}
