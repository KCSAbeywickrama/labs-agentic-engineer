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
	"fmt"
	"strings"

	"github.com/wso2/aep/aep-api/internal/organization"
)

const (
	envPublisherClientID     = "PUBLISHER_CLIENT_ID"
	envPublisherClientSecret = "PUBLISHER_CLIENT_SECRET"
	envPublisherTokenURL     = "PUBLISHER_TOKEN_URL"
	publisherDispatchActor   = "coding-dispatch"
)

// PublisherCredentialResolver ensures the org's Thunder publisher
// client_credentials SecretReference is ready and returns its name only
// (never the secret value). Nil is allowed on http platform URLs.
type PublisherCredentialResolver interface {
	EnsureReady(ctx context.Context, orgID string) (secretRefName string, err error)
}

func requiresGatewayPublisher(platformURL string) bool {
	u := strings.TrimSpace(platformURL)
	return strings.HasPrefix(strings.ToLower(u), "https://")
}

func PublisherTokenURLFromJWKS(jwksURL string) string {
	u := strings.TrimRight(strings.TrimSpace(jwksURL), "/")
	const suffix = "/oauth2/jwks"
	if !strings.HasSuffix(strings.ToLower(u), suffix) {
		return ""
	}
	return u[:len(u)-len(suffix)] + "/oauth2/token"
}

// WithPublisherCredentials wires the Thunder publisher SecretReference
// resolver and the already-derived token URL used on https dispatch.
func (e *CodingExecutor) WithPublisherCredentials(r PublisherCredentialResolver, tokenURL string) *CodingExecutor {
	e.publisher = r
	e.publisherTokenURL = tokenURL
	return e
}

func (e *CodingExecutor) publisherSecretEnv(ctx context.Context, orgID string) ([]SecretEnvRef, string, error) {
	tokenURL := strings.TrimSpace(e.publisherTokenURL)
	if tokenURL == "" {
		return nil, "", fmt.Errorf("https AGENT_PLATFORM_URL requires PLATFORM_IDP_JWKS_URL ending in /oauth2/jwks (publisher token URL)")
	}
	if e.publisher == nil {
		return nil, "", fmt.Errorf("https AGENT_PLATFORM_URL requires publisher credentials")
	}
	refName, err := e.publisher.EnsureReady(ctx, orgID)
	if err != nil {
		return nil, "", fmt.Errorf("publisher credentials: %w", err)
	}
	refName = strings.TrimSpace(refName)
	if refName == "" {
		return nil, "", fmt.Errorf("publisher SecretReference missing after ensure; rotate with RegenerateClientSecret")
	}
	return []SecretEnvRef{
		{Key: envPublisherClientID, SecretName: refName, SecretKey: organization.PublisherSecretFieldClientID},
		{Key: envPublisherClientSecret, SecretName: refName, SecretKey: organization.PublisherSecretFieldClientSecret},
	}, tokenURL, nil
}
