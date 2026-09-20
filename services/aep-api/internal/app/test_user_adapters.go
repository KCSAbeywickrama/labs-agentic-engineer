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

package app

import (
	"context"
	"errors"
	"fmt"

	"github.com/wso2/aep/aep-api/internal/clients/thunderflow"
	"github.com/wso2/aep/aep-api/internal/dependencies/provisioning"
	"github.com/wso2/aep/aep-api/internal/identity"
	"github.com/wso2/aep/aep-api/internal/projects"
)

// lateSignInCoords satisfies identity.SignInCoordinates from the provisioning
// service, which is built after the handlers that need the minter. The field
// is set once at composition; a mint before that answers "no coordinates",
// which the minter reports as disabled rather than guessing.
type lateSignInCoords struct{ svc *provisioning.Service }

func (l *lateSignInCoords) SignInCoordinates(ctx context.Context, orgID, projectID string) (identity.SignInCoords, error) {
	if l == nil || l.svc == nil {
		return identity.SignInCoords{}, nil
	}
	clientID, resource := l.svc.SignInCoordinates(ctx, orgID, projectID)
	return identity.SignInCoords{ClientID: clientID, Resource: resource}, nil
}

// thunderflowSignIn is identity.UserSignIn over the ThunderID flow client. The
// one translation is the refusal: the client's sentinel becomes the domain's,
// so identity never imports the protocol package.
type thunderflowSignIn struct{ c thunderflow.Client }

func (a thunderflowSignIn) SignIn(ctx context.Context, in identity.UserSignInRequest) (identity.UserToken, error) {
	tok, err := a.c.SignIn(ctx, thunderflow.SignIn{
		Issuer: in.Issuer, ClientID: in.ClientID, RedirectURI: in.RedirectURI, Resource: in.Resource,
		Scopes: in.Scopes, Username: in.Username, Password: in.Password,
	})
	if err != nil {
		if errors.Is(err, thunderflow.ErrRefused) {
			return identity.UserToken{}, fmt.Errorf("%w: %v", identity.ErrTestUserSignInRefused, err)
		}
		return identity.UserToken{}, err
	}
	return identity.UserToken{AccessToken: tok.AccessToken, ExpiresIn: tok.ExpiresIn}, nil
}

// testUserTokens is projects.TestUserTokens over the identity minter, mapping
// the identity domain's answers onto the relay's three sentinels so the edge
// handler depends on projects alone.
type testUserTokens struct{ m *identity.TestUserTokenMinter }

func (t testUserTokens) Enabled() bool { return t.m.Enabled() }

func (t testUserTokens) Mint(ctx context.Context, orgID, projectID, username string) (string, error) {
	minted, err := t.m.Mint(ctx, orgID, projectID, username)
	switch {
	case err == nil:
		return minted.AccessToken, nil
	case errors.Is(err, identity.ErrPanelNotFound):
		return "", fmt.Errorf("%w: %v", projects.ErrActAsNotFound, err)
	case errors.Is(err, identity.ErrTestUserTokensDisabled):
		return "", fmt.Errorf("%w: %v", projects.ErrActAsUnavailable, err)
	case errors.Is(err, identity.ErrTestUserSignInRefused):
		return "", fmt.Errorf("%w: %v", projects.ErrActAsRefused, err)
	}
	return "", err
}
