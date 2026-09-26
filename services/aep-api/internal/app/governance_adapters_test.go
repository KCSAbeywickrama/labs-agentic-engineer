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
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/agentmanager"
	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/organization"
	"github.com/wso2/aep/aep-api/internal/platform/modelconn"
)

// connectionReader answers Effective with one connection and key.
type connectionReader struct {
	conn modelconn.Connection
	key  string
}

func (r connectionReader) Effective(context.Context, string) (modelconn.Connection, string, bool, error) {
	return r.conn, r.key, true, nil
}

func (r connectionReader) KeyRef(context.Context, string) (modelconn.Connection, organization.SecretRefTriplet, error) {
	return r.conn, organization.SecretRefTriplet{}, nil
}

// The deploy path's half of the interim gate: the governor reads "" as nothing
// to govern, so another host's key never becomes the Anthropic provider's.
func TestAMPOrgKeyReader_OnlyYieldsAKeyGeneratedAgentsCanUse(t *testing.T) {
	for _, tc := range []struct {
		name string
		conn modelconn.Connection
		want string
	}{
		{
			name: "Anthropic's own API",
			conn: modelconn.Connection{Format: modelconn.FormatAnthropic, Host: modelconn.AnthropicHost},
			want: "sk-ant-api03-key",
		},
		{
			name: "another host",
			conn: modelconn.Connection{Format: modelconn.FormatOpenAICompatible, Host: modelconn.OllamaHost},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ampOrgKeyReader{conns: connectionReader{conn: tc.conn, key: "sk-ant-api03-key"}}.AnthropicKeyValue(context.Background(), "acme")
			if err != nil || got != tc.want {
				t.Fatalf("key = %q, %v; want %q", got, err, tc.want)
			}
		})
	}
}

// providerClient records the provider credential writes; nothing else is used.
type providerClient struct {
	agentmanager.Client
	exists  bool
	updates []agentmanager.EnsureProviderInput
	ensured int
}

func (c *providerClient) ProviderTemplate(context.Context, string, string) (agentmanager.ProviderTemplate, error) {
	return agentmanager.ProviderTemplate{EndpointURL: "https://api.anthropic.com", AuthType: "api-key", AuthHeader: "x-api-key"}, nil
}

func (c *providerClient) EnsureProvider(context.Context, agentmanager.EnsureProviderInput) (agentmanager.ProviderRef, error) {
	c.ensured++
	return agentmanager.ProviderRef{}, nil
}

func (c *providerClient) UpdateProviderCredential(_ context.Context, in agentmanager.EnsureProviderInput) (bool, error) {
	c.updates = append(c.updates, in)
	return c.exists, nil
}

type providerClients struct{ client *providerClient }

func (f providerClients) For(string) agentmanager.Client { return f.client }

type oneBinding struct{}

func (oneBinding) GetAIGatewayBinding(context.Context, string, string) (openchoreo.AIGatewayBinding, error) {
	return openchoreo.AIGatewayBinding{AdminURL: "http://amp.example", GatewayID: "gw-1"}, nil
}

// Clearing overwrites the provider's copy of the key in place — never through
// EnsureProvider, whose create branch would conjure a provider no deploy asked
// for — with a value that authenticates nowhere.
func TestAMPModelProviderPublisher_ClearOverwritesTheKey(t *testing.T) {
	client := &providerClient{exists: true}
	pub := ampModelProviderPublisher{amp: providerClients{client}, bindings: oneBinding{}}

	if err := pub.ClearOrgModelKey(context.Background(), "acme"); err != nil {
		t.Fatalf("ClearOrgModelKey: %v", err)
	}
	if client.ensured != 0 {
		t.Fatalf("EnsureProvider called %d time(s); a clear must not create a provider", client.ensured)
	}
	if len(client.updates) != 1 {
		t.Fatalf("credential writes = %d, want 1", len(client.updates))
	}
	in := client.updates[0]
	if in.APIKey != clearedProviderCredential || in.ID != "aep-acme-anthropic" || in.GatewayID != "gw-1" {
		t.Fatalf("write = %+v, want the org's provider holding the cleared value", in)
	}
}
