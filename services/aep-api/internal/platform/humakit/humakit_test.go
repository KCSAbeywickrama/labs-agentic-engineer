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

	"github.com/wso2/aep/aep-api/internal/platform/auth"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
)

// resolveWith runs OrgScopedInput.Resolve with the given JWT claim org and
// gate mode (stamped on the request context exactly as api.mountSurfaces
// does; "" leaves the context unstamped to exercise the ENFORCE default) and
// returns the input (with OrgHandle bound by Resolve) plus the resolver errors.
// There is no path org any more — the active org is derived solely from the
// token, so a cross-org request is unrepresentable here by construction.
func resolveWith(t *testing.T, claimOrg string, mode tenant.GateMode) (*OrgScopedInput, []error) {
	t.Helper()
	r := httptest.NewRequest("GET", "/api/v1/projects", nil)
	if claimOrg != "" {
		r = r.WithContext(auth.WithClaims(r.Context(), &auth.Claims{OuHandle: claimOrg}))
	}
	if mode != "" {
		r = r.WithContext(tenant.WithGateMode(r.Context(), mode))
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
	t.Parallel()

	// A verified token that names an org is bound onto OrgHandle and passes.
	in, errs := resolveWith(t, "acme", tenant.GateModeEnforce)
	if len(errs) != 0 {
		t.Fatalf("valid token org should pass, got %v", errs)
	}
	if in.OrgHandle != "acme" {
		t.Fatalf("Resolve must bind the token org onto OrgHandle, got %q", in.OrgHandle)
	}

	// No org claim → 401: the active org cannot be derived from the token.
	_, noClaimErrs := resolveWith(t, "", tenant.GateModeEnforce)
	if got := statusOf(t, noClaimErrs); got != 401 {
		t.Fatalf("missing org claim should 401, got %d", got)
	}
}

func TestOrgScopedResolve_UnstampedContextDefaultsToEnforce(t *testing.T) {
	t.Parallel()

	// A context nothing stamped a mode onto (a stray path that bypassed the
	// mountSurfaces middleware, or a bare test context) must fail secure:
	// GateModeFromContext defaults to ENFORCE, so no-org-claim still denies.
	_, errs := resolveWith(t, "", "")
	if got := statusOf(t, errs); got != 401 {
		t.Fatalf("unstamped context must default to ENFORCE (401), got %d", got)
	}
}

func TestOrgScopedResolve_LogModePassesThrough(t *testing.T) {
	t.Parallel()

	// Log mode observes but does not enforce the missing-org-claim deny. The
	// mode is request-scoped (stamped by mountSurfaces from TENANT_GATE_MODE),
	// so this cannot leak into any other test or handler.
	if _, errs := resolveWith(t, "", tenant.GateModeLog); len(errs) != 0 {
		t.Fatalf("log mode must pass a missing org claim through, got %v", errs)
	}
}
