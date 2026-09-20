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

package identity

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"
)

type fakeCoords struct{ c SignInCoords }

func (f fakeCoords) SignInCoordinates(context.Context, string, string) (SignInCoords, error) {
	return f.c, nil
}

type fakeSignIn struct {
	reqs []UserSignInRequest
	err  error
}

func (f *fakeSignIn) SignIn(_ context.Context, in UserSignInRequest) (UserToken, error) {
	f.reqs = append(f.reqs, in)
	if f.err != nil {
		return UserToken{}, f.err
	}
	return UserToken{AccessToken: "AT-" + in.Username, ExpiresIn: 3600}, nil
}

// mintFixture is one project with one declared, platform-owned test user.
func mintFixture(t *testing.T) (*TestUserTokenMinter, *fakeStore, *fakeSignIn) {
	t.Helper()
	store := newFakeStore()
	targets := newFakeTargets(newFakeDirectory())
	scope := targets.Scope("acme")
	store.refs[refKey(scope, "workouts")] = []TestUserRef{{Username: "test-trainer"}}
	store.users[scopedKey(scope, "test-trainer")] = TestUser{OrgID: "acme", Environment: scope.Environment, Username: "test-trainer"}
	store.passwords[scopedKey(scope, "test-trainer")] = "sealed-pw"
	signIn := &fakeSignIn{}
	m := NewTestUserTokenMinter(NewPanelService(targets, store), fakeCoords{SignInCoords{ClientID: "project-client", Resource: "https://aep.wso2.com/orgs/acme/projects/workouts"}}, signIn, "http://tryit.local/callback")
	return m, store, signIn
}

// The mint is a sign-in at the project's issuer, as the project's client, for
// the project's resource, with the sealed password — and asks for openid.
func TestTestUserTokenMinter_SignsTheOwnedAccountIn(t *testing.T) {
	m, store, signIn := mintFixture(t)
	got, err := m.Mint(context.Background(), "acme", "workouts", "test-trainer")
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	if got.AccessToken != "AT-test-trainer" || got.Username != "test-trainer" || time.Until(got.ExpiresAt) < 50*time.Minute {
		t.Errorf("minted = %+v", got)
	}
	if len(signIn.reqs) != 1 {
		t.Fatalf("want one sign-in, got %d", len(signIn.reqs))
	}
	r := signIn.reqs[0]
	if r.Issuer != testIssuer || r.ClientID != "project-client" || r.RedirectURI != "http://tryit.local/callback" ||
		r.Resource != "https://aep.wso2.com/orgs/acme/projects/workouts" || r.Username != "test-trainer" || r.Password != "sealed-pw" {
		t.Errorf("sign-in request = %+v", r)
	}
	if !slices.Contains(r.Scopes, "openid") {
		t.Errorf("scopes must include openid: %v", r.Scopes)
	}
	if store.revealCalls != 1 {
		t.Errorf("the seal is opened exactly once per sign-in; got %d", store.revealCalls)
	}
}

// A username the project does not declare is "no such test user" — the same
// fence as revealing the password — and neither the seal nor the issuer is
// touched on the way to that answer.
func TestTestUserTokenMinter_UndeclaredUserIsNotFound(t *testing.T) {
	m, store, signIn := mintFixture(t)
	_, err := m.Mint(context.Background(), "acme", "workouts", "somebody-else")
	if !errors.Is(err, ErrPanelNotFound) {
		t.Fatalf("err = %v; want ErrPanelNotFound", err)
	}
	if store.revealCalls != 0 || len(signIn.reqs) != 0 {
		t.Errorf("nothing may be revealed or signed in for an undeclared user: reveals=%d signIns=%d", store.revealCalls, len(signIn.reqs))
	}
}

// A second mint inside the token's lifetime reuses it: one sign-in, one reveal.
func TestTestUserTokenMinter_ReusesAnUnexpiredToken(t *testing.T) {
	m, store, signIn := mintFixture(t)
	a, _ := m.Mint(context.Background(), "acme", "workouts", "test-trainer")
	b, err := m.Mint(context.Background(), "acme", "workouts", "test-trainer")
	if err != nil || a.AccessToken != b.AccessToken {
		t.Fatalf("second mint: %v / %+v vs %+v", err, a, b)
	}
	if len(signIn.reqs) != 1 || store.revealCalls != 1 {
		t.Errorf("cached token must not sign in or reveal again: signIns=%d reveals=%d", len(signIn.reqs), store.revealCalls)
	}
}

// Unconfigured is reported, not half-done: no callback URL means no mint.
func TestTestUserTokenMinter_DisabledWithoutACallback(t *testing.T) {
	store := newFakeStore()
	m := NewTestUserTokenMinter(NewPanelService(newFakeTargets(newFakeDirectory()), store), fakeCoords{}, &fakeSignIn{}, "  ")
	if m.Enabled() {
		t.Fatal("no callback URL must disable the minter")
	}
	if _, err := m.Mint(context.Background(), "acme", "workouts", "test-trainer"); !errors.Is(err, ErrTestUserTokensDisabled) {
		t.Errorf("err = %v; want ErrTestUserTokensDisabled", err)
	}
}

// The issuer refusing the sealed password is surfaced as that, unchanged.
func TestTestUserTokenMinter_RefusalPropagates(t *testing.T) {
	m, _, signIn := mintFixture(t)
	signIn.err = ErrTestUserSignInRefused
	if _, err := m.Mint(context.Background(), "acme", "workouts", "test-trainer"); !errors.Is(err, ErrTestUserSignInRefused) {
		t.Errorf("err = %v; want ErrTestUserSignInRefused", err)
	}
}
