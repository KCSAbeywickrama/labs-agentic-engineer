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
	"errors"
)

// TestUserTokens is what the invoke relay needs to act AS one of a project's
// test accounts: a bearer for that account, minted by the platform. Declared
// consumer-side; the identity domain's minter satisfies it through an adapter
// at the composition root that maps its errors onto the three below.
type TestUserTokens interface {
	// Enabled is false when the platform cannot sign test users in at all.
	Enabled() bool
	// Mint returns the account's bearer, without the "Bearer " prefix.
	Mint(ctx context.Context, orgID, projectID, username string) (string, error)
}

var (
	// ErrActAsNotFound — the project declares no such test user, or the platform
	// does not own the account. The same answer as revealing its password.
	ErrActAsNotFound = errors.New("projects: no such test user for this project")
	// ErrActAsUnavailable — signing test users in is not configured here.
	ErrActAsUnavailable = errors.New("projects: signing test users in is not configured")
	// ErrActAsRefused — the identity provider declined the account's password.
	ErrActAsRefused = errors.New("projects: the identity provider refused the test user's sign-in")
)
