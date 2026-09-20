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
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"
)

// SignInCoordinates answers what a public client needs to start a sign-in for
// a project: the project's OAuth client and the resource server its tokens are
// minted for. Both are facts about the project's `user-auth` resource that live
// on its resolved binding — the same values the runtime injects into the
// project's own components as `<DEP>_CLIENT_ID` and `<DEP>_RESOURCE`. Declared
// here so this domain reads them without knowing where they are kept.
type SignInCoordinates interface {
	SignInCoordinates(ctx context.Context, orgID, projectID string) (SignInCoords, error)
}

// SignInCoords is one project's sign-in client and audience.
type SignInCoords struct {
	ClientID string
	Resource string
}

// UserSignIn performs a browserless user sign-in at an issuer and returns the
// access token. The implementation speaks ThunderID's flow protocol
// (clients/thunderflow); this domain sees only the request and the token.
type UserSignIn interface {
	SignIn(ctx context.Context, in UserSignInRequest) (UserToken, error)
}

// UserSignInRequest is everything a sign-in needs, and nothing the issuer does
// not: no client secret (the project's client is public), no admin credential.
type UserSignInRequest struct {
	Issuer      string
	ClientID    string
	RedirectURI string
	Resource    string
	Scopes      []string
	Username    string
	Password    string
}

// UserToken is the issuer's access token and its lifetime in seconds.
type UserToken struct {
	AccessToken string
	ExpiresIn   int
}

// MintedToken is a test account's token as this domain hands it out: the bearer
// and when it stops being one. It is used by the relay and never returned to a
// client of the platform.
type MintedToken struct {
	Username    string
	AccessToken string
	ExpiresAt   time.Time
}

var (
	// ErrTestUserTokensDisabled is the minter with no way to sign anyone in:
	// no identity panel, no sign-in coordinates, no callback registered.
	ErrTestUserTokensDisabled = errors.New("identity: signing test users in is not configured")
	// ErrTestUserSignInRefused is the issuer declining the account's sealed
	// password — the seal and the directory disagree, most often after a
	// rotation that reached one and not the other.
	ErrTestUserSignInRefused = errors.New("identity: the identity provider refused the test user's sign-in")
)

// TestUserTokenMinter signs one of a project's platform-owned test accounts in
// to the project's own identity provider and returns its token.
//
// It exists for the console's Try it: a protected component's gateway accepts
// only a token the ENVIRONMENT's identity provider minted for the project's
// resource server, and the caller's platform sign-in is neither. The project's
// test users are exactly such identities, and the platform already holds their
// sealed passwords for the validation agent — this turns one into a token the
// relay can forward, server-side, so the credential and the token both stay
// inside the platform.
//
// Every guard the panel's Reveal applies applies here, through the same
// method: the project must declare the username and the platform must own the
// account. A caller who could not reveal the password cannot mint with it.
type TestUserTokenMinter struct {
	panel       *PanelService
	coords      SignInCoordinates
	signIn      UserSignIn
	redirectURI string
	now         func() time.Time

	mu    sync.Mutex
	cache map[string]MintedToken
}

// NewTestUserTokenMinter wires the minter. Any nil collaborator or an empty
// redirectURI leaves it disabled, which Mint reports rather than half-works.
func NewTestUserTokenMinter(panel *PanelService, coords SignInCoordinates, signIn UserSignIn, redirectURI string) *TestUserTokenMinter {
	return &TestUserTokenMinter{
		panel: panel, coords: coords, signIn: signIn,
		redirectURI: strings.TrimSpace(redirectURI),
		now:         time.Now,
		cache:       map[string]MintedToken{},
	}
}

// Enabled reports whether a mint can possibly succeed.
func (m *TestUserTokenMinter) Enabled() bool {
	return m != nil && m.panel.Enabled() && m.coords != nil && m.signIn != nil && m.redirectURI != ""
}

// reuseSkew is how long before expiry a cached token stops being handed out,
// so a relay that starts with it does not finish with an expired one.
const reuseSkew = 30 * time.Second

// Mint returns a token for username on projectID, signing in only when no
// unexpired one is cached.
//
// ErrPanelNotFound when the project does not declare the username or the
// platform does not own it — the same answer, for the same reason, as Reveal.
func (m *TestUserTokenMinter) Mint(ctx context.Context, orgID, projectID, username string) (MintedToken, error) {
	if !m.Enabled() {
		return MintedToken{}, ErrTestUserTokensDisabled
	}
	username = strings.TrimSpace(username)
	key := orgID + "/" + projectID + "/" + username
	m.mu.Lock()
	if cached, ok := m.cache[key]; ok && m.now().Add(reuseSkew).Before(cached.ExpiresAt) {
		m.mu.Unlock()
		return cached, nil
	}
	m.mu.Unlock()

	// Ownership first, and it is the panel's own check: a username the project
	// does not declare, or an account somebody else made, is "no such test user".
	scope, owned, err := m.panel.resolveOwned(ctx, orgID, projectID, username)
	if err != nil {
		return MintedToken{}, err
	}
	password, err := m.panel.store.RevealTestUserPassword(ctx, scope, owned.Username)
	if err != nil {
		if errors.Is(err, ErrNoPassword) {
			return MintedToken{}, ErrPanelNotFound
		}
		return MintedToken{}, err
	}
	target, err := m.panel.targets.Resolve(ctx, orgID)
	if err != nil {
		return MintedToken{}, fmt.Errorf("identity: resolve the project's identity provider: %w", err)
	}
	coords, err := m.coords.SignInCoordinates(ctx, orgID, projectID)
	if err != nil {
		return MintedToken{}, fmt.Errorf("identity: sign-in coordinates: %w", err)
	}
	if coords.ClientID == "" {
		// A project with no sign-in resource has no client to sign in as; the
		// account may exist, but nothing can be minted for it.
		return MintedToken{}, ErrTestUserTokensDisabled
	}
	if coords.Resource == "" {
		coords.Resource = ResourceServerIdentifier(orgID, projectID)
	}

	tok, err := m.signIn.SignIn(ctx, UserSignInRequest{
		Issuer: target.Issuer, ClientID: coords.ClientID, RedirectURI: m.redirectURI,
		Resource: coords.Resource, Scopes: m.scopesFor(ctx, orgID, projectID, owned.Username),
		Username: owned.Username, Password: password,
	})
	if err != nil {
		return MintedToken{}, err
	}
	minted := MintedToken{
		Username:    owned.Username,
		AccessToken: tok.AccessToken,
		ExpiresAt:   m.now().Add(time.Duration(max(tok.ExpiresIn, 60)) * time.Second),
	}
	m.mu.Lock()
	m.cache[key] = minted
	m.mu.Unlock()
	// The one audit line, and nothing secret is on it.
	slog.InfoContext(ctx, "identity: test user signed in for a relayed call",
		"org", orgID, "project", projectID, "testUser", owned.Username, "issuer", target.Issuer, "expiresAt", minted.ExpiresAt)
	return minted, nil
}

// scopesFor is what the sign-in asks for: `openid` plus every handle the
// account's roles grant. The issuer narrows a request to what the account
// holds, so asking for the account's own scopes is what keeps the token from
// coming back with `openid` alone. Read off the panel's view, which is the
// same union the console publishes beside the login; a view that cannot be
// read costs the scopes, not the sign-in.
func (m *TestUserTokenMinter) scopesFor(ctx context.Context, orgID, projectID, username string) []string {
	out := []string{"openid"}
	view, err := m.panel.View(ctx, orgID, projectID)
	if err != nil {
		return out
	}
	seen := map[string]bool{"openid": true}
	for _, u := range view.TestUsers {
		if u.Username != username {
			continue
		}
		for _, s := range u.Scopes {
			if s != "" && !seen[s] {
				seen[s] = true
				out = append(out, s)
			}
		}
	}
	return out
}
