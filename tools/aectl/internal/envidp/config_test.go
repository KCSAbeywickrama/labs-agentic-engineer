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

import (
	"context"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

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

	if got, want := publicURL(cfg.Env, cfg.idpBaseDomain(), cfg.scheme(), cfg.idpPort()),
		"http://development-idp.openchoreo.10.0.0.5.sslip.io:8080"; got != want {
		t.Errorf("publicURL = %q, want %q", got, want)
	}
	if got, want := gatewayVhost(cfg.Org, cfg.Env, cfg.gatewayBaseDomain(), cfg.scheme(), cfg.gatewayPort()),
		"http://development-default.gateway.10.0.0.5.sslip.io:19080"; got != want {
		t.Errorf("gatewayVhost = %q, want %q", got, want)
	}
}

// TestTLSMovesSchemeAndBothPorts is the case that decides whether an end user
// can sign in to a generated app: the issuer must be https, because a browser
// withholds crypto.subtle — and with it PKCE — outside a secure context.
// Scheme and port move together; https on 8080 would be as broken as http.
func TestTLSMovesSchemeAndBothPorts(t *testing.T) {
	cfg := Config{
		Org:               "default",
		Env:               "development",
		IDPBaseDomain:     "openchoreo.10.0.0.5.sslip.io",
		GatewayBaseDomain: "gateway.10.0.0.5.sslip.io",
		TLS:               true,
	}

	if got, want := publicURL(cfg.Env, cfg.idpBaseDomain(), cfg.scheme(), cfg.idpPort()),
		"https://development-idp.openchoreo.10.0.0.5.sslip.io:8443"; got != want {
		t.Errorf("publicURL = %q, want %q", got, want)
	}
	if got, want := gatewayVhost(cfg.Org, cfg.Env, cfg.gatewayBaseDomain(), cfg.scheme(), cfg.gatewayPort()),
		"https://development-default.gateway.10.0.0.5.sslip.io:19443"; got != want {
		t.Errorf("gatewayVhost = %q, want %q", got, want)
	}
}

// TestTLSDefaultsOff guards the localhost flow: an install that sets nothing
// must still compose exactly the plain-HTTP URLs it always did.
func TestTLSDefaultsOff(t *testing.T) {
	cfg := Config{Org: "default", Env: "development"}

	if cfg.TLS {
		t.Error("TLS must default to false")
	}
	if got, want := publicURL(cfg.Env, cfg.idpBaseDomain(), cfg.scheme(), cfg.idpPort()),
		"http://development-idp.openchoreo.localhost:8080"; got != want {
		t.Errorf("publicURL = %q, want %q", got, want)
	}
	if got, want := gatewayVhost(cfg.Org, cfg.Env, cfg.gatewayBaseDomain(), cfg.scheme(), cfg.gatewayPort()),
		"http://development-default.gateway.localhost:19080"; got != want {
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

// TestEnsureDomainUnchanged covers the re-install whose configured suffix has
// moved since the cluster was built. BIND never upgrades the deployed release,
// so the binding record would be rewritten with an issuer this Thunder does
// not stamp — every generated app's sign-in breaks, with nothing in the
// install output to say why.
func TestEnsureDomainUnchanged(t *testing.T) {
	cfg := Config{Org: "default", Env: "development"}
	inst := &ThunderInstance{
		Release:   "thunder-default-development",
		Namespace: "thunder-default-development",
		PublicURL: "http://development-idp.openchoreo.10.0.0.5.sslip.io:8080",
	}
	binding := func(issuer string) *corev1.ConfigMap {
		return &corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{
				Name:      BindingName(cfg.Org, cfg.Env),
				Namespace: inst.Namespace,
			},
			Data: map[string]string{keyIssuer: issuer},
		}
	}

	t.Run("no record yet is not an error", func(t *testing.T) {
		c := clients{k8s: fake.NewSimpleClientset()}
		if err := ensureDomainUnchanged(context.Background(), c, cfg, inst); err != nil {
			t.Errorf("unexpected error with no binding record: %v", err)
		}
	})

	t.Run("same domain passes", func(t *testing.T) {
		c := clients{k8s: fake.NewSimpleClientset(binding(inst.PublicURL))}
		if err := ensureDomainUnchanged(context.Background(), c, cfg, inst); err != nil {
			t.Errorf("unexpected error for an unchanged domain: %v", err)
		}
	})

	t.Run("changed domain is refused, naming both", func(t *testing.T) {
		old := "http://development-idp.openchoreo.localhost:8080"
		c := clients{k8s: fake.NewSimpleClientset(binding(old))}
		err := ensureDomainUnchanged(context.Background(), c, cfg, inst)
		if err == nil {
			t.Fatal("expected a refusal when the recorded issuer disagrees")
		}
		for _, want := range []string{old, inst.PublicURL} {
			if !strings.Contains(err.Error(), want) {
				t.Errorf("error should name %q, got: %v", want, err)
			}
		}
	})
}
