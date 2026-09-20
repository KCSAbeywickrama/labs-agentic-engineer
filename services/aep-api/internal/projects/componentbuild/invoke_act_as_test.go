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

package componentbuild

import (
	"context"
	"errors"
	"net/http"
	"testing"

	gen "github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/platform/apierr"
	"github.com/wso2/aep/aep-api/internal/platform/auth"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
	"github.com/wso2/aep/aep-api/internal/projects"
)

// recordingInvoker keeps the bearer and user id the handler chose, which is
// the whole point of actAs: WHO the relay speaks as.
type recordingInvoker struct {
	projects.ComponentService
	bearer, userID string
	calls          int
}

func (r *recordingInvoker) Invoke(_ context.Context, _, _, _ string, _ projects.InvokeCall, bearer, userID string) (projects.InvokeResult, error) {
	r.calls++
	r.bearer, r.userID = bearer, userID
	return projects.InvokeResult{Status: 200, ContentType: "application/json", Body: []byte(`{}`)}, nil
}

type stubTokens struct {
	enabled bool
	token   string
	err     error
	asked   []string
}

func (s *stubTokens) Enabled() bool { return s.enabled }
func (s *stubTokens) Mint(_ context.Context, _, _, username string) (string, error) {
	s.asked = append(s.asked, username)
	return s.token, s.err
}

func actAsRequest(user string) gen.InvokeComponentRequestObject {
	body := &gen.InvokeRequest{Method: "POST", Path: "/chat"}
	body.ActAs.TestUser = user
	return gen.InvokeComponentRequestObject{ProjectName: "workouts", ComponentName: "chat-agent", Body: body}
}

func callerCtx() context.Context {
	ctx := tenant.WithBoundOrg(context.Background(), "acme")
	ctx = auth.WithClaims(ctx, &auth.Claims{Subject: "caller-subject"})
	return auth.WithAuthToken(ctx, "caller-token")
}

// Acting as a test user: the upstream bearer is the MINTED token, never the
// caller's, and no X-User-Id is set — the gateway derives the user from the
// token, and the caller's subject stamped over it would attribute the turn to
// the wrong person.
func TestInvokeComponent_ActAsForwardsTheMintedTokenAndNoCallerIdentity(t *testing.T) {
	t.Parallel()
	inv := &recordingInvoker{}
	tokens := &stubTokens{enabled: true, token: "minted-token"}
	h := &Handler{comp: inv, tokens: tokens}

	if _, err := h.InvokeComponent(callerCtx(), actAsRequest("test-trainer")); err != nil {
		t.Fatalf("InvokeComponent: %v", err)
	}
	if inv.bearer != "Bearer minted-token" {
		t.Errorf("upstream bearer = %q; want the minted token", inv.bearer)
	}
	if inv.userID != "" {
		t.Errorf("X-User-Id must not be set when acting as a test user; got %q", inv.userID)
	}
	if len(tokens.asked) != 1 || tokens.asked[0] != "test-trainer" {
		t.Errorf("minted for %v; want [test-trainer]", tokens.asked)
	}
}

// Without actAs nothing changes: the caller's bearer and verified subject go
// upstream, exactly as before this field existed.
func TestInvokeComponent_NoActAsRelaysAsTheCaller(t *testing.T) {
	t.Parallel()
	inv := &recordingInvoker{}
	h := &Handler{comp: inv, tokens: &stubTokens{enabled: true, token: "minted-token"}}

	if _, err := h.InvokeComponent(callerCtx(), actAsRequest("")); err != nil {
		t.Fatalf("InvokeComponent: %v", err)
	}
	if inv.bearer != "Bearer caller-token" || inv.userID != "caller-subject" {
		t.Errorf("relay as the caller expected; got bearer=%q userID=%q", inv.bearer, inv.userID)
	}
}

// The three ways a mint can fail map to the statuses the contract documents —
// and a request that asked to be somebody is NEVER relayed as somebody else.
func TestInvokeComponent_ActAsFailuresAreNamedAndNeverFallBack(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name   string
		tokens projects.TestUserTokens
		want   int
	}{
		{"unwired", nil, http.StatusServiceUnavailable},
		{"disabled", &stubTokens{enabled: false}, http.StatusServiceUnavailable},
		{"not found", &stubTokens{enabled: true, err: projects.ErrActAsNotFound}, http.StatusNotFound},
		{"unavailable", &stubTokens{enabled: true, err: projects.ErrActAsUnavailable}, http.StatusServiceUnavailable},
		{"refused", &stubTokens{enabled: true, err: projects.ErrActAsRefused}, http.StatusBadGateway},
		{"other", &stubTokens{enabled: true, err: errors.New("boom")}, http.StatusBadGateway},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			inv := &recordingInvoker{}
			h := &Handler{comp: inv}
			if tc.tokens != nil {
				h.SetTestUserTokens(tc.tokens)
			}
			_, err := h.InvokeComponent(callerCtx(), actAsRequest("test-trainer"))
			var apiErr *apierr.Error
			if !errors.As(err, &apiErr) {
				t.Fatalf("want an *apierr.Error, got %v", err)
			}
			if apiErr.Status != tc.want {
				t.Errorf("status = %d; want %d", apiErr.Status, tc.want)
			}
			if inv.calls != 0 {
				t.Errorf("the relay must not run when the mint failed; it ran %d time(s)", inv.calls)
			}
		})
	}
}
