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

package envidp

import "testing"

// TestBaseDomainsFallBack is the install that configures neither: the k3d
// convention, unchanged from before these were configurable.
func TestBaseDomainsFallBack(t *testing.T) {
	cfg := Config{Org: "default", Env: "development"}

	if got := cfg.idpBaseDomain(); got != defaultIDPBaseDomain {
		t.Errorf("idpBaseDomain() = %q, want %q", got, defaultIDPBaseDomain)
	}
	if got := cfg.gatewayBaseDomain(); got != defaultGatewayBaseDomain {
		t.Errorf("gatewayBaseDomain() = %q, want %q", got, defaultGatewayBaseDomain)
	}
}

// TestBaseDomainsIndependent covers the reason these are two keys rather than
// one: the suffixes share only their trailing labels, so a re-domained
// cluster moves both and neither can be derived from the other.
func TestBaseDomainsIndependent(t *testing.T) {
	cfg := Config{
		Org:               "default",
		Env:               "development",
		IDPBaseDomain:     "openchoreo.10.0.0.5.sslip.io",
		GatewayBaseDomain: "gateway.10.0.0.5.sslip.io",
	}

	if got, want := publicURL(cfg.Env, cfg.idpBaseDomain()),
		"http://development-idp.openchoreo.10.0.0.5.sslip.io:8080"; got != want {
		t.Errorf("publicURL = %q, want %q", got, want)
	}
	if got, want := gatewayVhost(cfg.Org, cfg.Env, cfg.gatewayBaseDomain()),
		"http://development-default.gateway.10.0.0.5.sslip.io:19080"; got != want {
		t.Errorf("gatewayVhost = %q, want %q", got, want)
	}
}

// TestBaseDomainsSetOneOnly asserts the two do not move together by accident.
// Configuring the IdP and forgetting the gateway leaves generated apps able
// to sign in and unable to call their own API, which is worth failing a test
// over rather than discovering in a browser.
func TestBaseDomainsSetOneOnly(t *testing.T) {
	cfg := Config{Org: "default", Env: "development", IDPBaseDomain: "openchoreo.example.com"}

	if got, want := cfg.idpBaseDomain(), "openchoreo.example.com"; got != want {
		t.Errorf("idpBaseDomain() = %q, want %q", got, want)
	}
	if got := cfg.gatewayBaseDomain(); got != defaultGatewayBaseDomain {
		t.Errorf("gatewayBaseDomain() = %q, want the untouched default %q", got, defaultGatewayBaseDomain)
	}
}
