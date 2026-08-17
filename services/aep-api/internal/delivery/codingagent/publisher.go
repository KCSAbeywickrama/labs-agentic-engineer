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

import "strings"

const (
	envPublisherClientID     = "PUBLISHER_CLIENT_ID"
	envPublisherClientSecret = "PUBLISHER_CLIENT_SECRET"
	envPublisherTokenURL     = "PUBLISHER_TOKEN_URL"
	publisherDispatchActor   = "coding-dispatch"
)

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
