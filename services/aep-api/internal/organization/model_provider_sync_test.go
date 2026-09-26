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

package organization

// UNIT tier — what a save does to the Agent Manager provider's copy of the
// org's connection, over connections constructed here. The DB-backed half (a saved
// key reaches the provider) is anthropic_dbtest_test.go.

import (
	"context"
	"errors"
	"testing"

	"github.com/wso2/aep/aep-api/internal/platform/modelconn"
)

func firstParty() *modelconn.Connection {
	c := anthropicConn().Connection()
	return &c
}

func onOllama() *modelconn.Connection {
	return &modelconn.Connection{
		Format:     modelconn.FormatOpenAICompatible,
		BaseURL:    "https://ollama.com/v1",
		Host:       modelconn.OllamaHost,
		Model:      "gpt-oss:20b",
		AuthScheme: modelconn.AuthBearer,
	}
}

func anthropicOnOllama() *modelconn.Connection {
	return &modelconn.Connection{
		Format:     modelconn.FormatAnthropic,
		BaseURL:    "https://ollama.com",
		Host:       modelconn.OllamaHost,
		Model:      "gpt-oss:20b",
		AuthScheme: modelconn.AuthBearer,
	}
}

func with(c *modelconn.Connection, edit func(*modelconn.Connection)) *modelconn.Connection {
	out := *c
	edit(&out)
	return &out
}

func TestModelProviderStepFor(t *testing.T) {
	for _, tc := range []struct {
		name          string
		before, after *modelconn.Connection
		keyWritten    bool
		want          modelProviderStep
	}{
		{"first connect on Anthropic's API publishes", nil, firstParty(), true, modelProviderPublish},
		{"first connect on another host publishes", nil, onOllama(), true, modelProviderPublish},
		{"a rotated key publishes", firstParty(), firstParty(), true, modelProviderPublish},
		{"a rotated key on another host publishes", onOllama(), onOllama(), true, modelProviderPublish},
		{"moving to another host publishes it", firstParty(), onOllama(), true, modelProviderPublish},
		{"moving back to Anthropic's API publishes it", onOllama(), firstParty(), true, modelProviderPublish},
		{"a format switch that keeps the key publishes", onOllama(), anthropicOnOllama(), false, modelProviderPublish},
		{"a URL change that keeps the key publishes", onOllama(),
			with(onOllama(), func(c *modelconn.Connection) { c.BaseURL = "https://ollama.com/api/v1" }), false, modelProviderPublish},
		{"an auth change that keeps the key publishes", firstParty(),
			with(firstParty(), func(c *modelconn.Connection) { c.AuthScheme = modelconn.AuthBearer }), false, modelProviderPublish},
		{"a model change leaves the copy", firstParty(),
			with(firstParty(), func(c *modelconn.Connection) { c.Model = "claude-opus-5" }), false, modelProviderLeave},
		{"a save that changes nothing the provider holds leaves it", onOllama(), onOllama(), false, modelProviderLeave},
		{"a disconnect from Anthropic's API clears the copy", firstParty(), nil, false, modelProviderClear},
		{"a disconnect from another host clears the copy", onOllama(), nil, false, modelProviderClear},
		{"a save with no connection either side leaves it", nil, nil, false, modelProviderLeave},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := modelProviderStepFor(tc.before, tc.after, tc.keyWritten); got != tc.want {
				t.Fatalf("step = %v, want %v", got, tc.want)
			}
		})
	}
}

// published is one publish as it reached the provider.
type published struct {
	conn modelconn.Connection
	key  string
}

// recordingProvider counts what reached the provider; clearErr is what every
// clear answers.
type recordingProvider struct {
	published []published
	cleared   []modelconn.Connection
	clearErr  error
}

func (p *recordingProvider) PublishOrgModelConnection(_ context.Context, _ string, conn modelconn.Connection, apiKey string) error {
	p.published = append(p.published, published{conn: conn, key: apiKey})
	return nil
}

func (p *recordingProvider) ClearOrgModelKey(_ context.Context, _ string, last modelconn.Connection) error {
	p.cleared = append(p.cleared, last)
	return p.clearErr
}

// storedKey is a credential store holding only the connection key.
type storedKey struct{ key string }

func (s storedKey) Get(_ context.Context, _, key string) ([]byte, error) {
	if key != modelKeyStoreKey || s.key == "" {
		return nil, errors.New("not found")
	}
	return []byte(s.key), nil
}
func (storedKey) Put(context.Context, string, string, []byte) error { return nil }
func (storedKey) Delete(context.Context, string, string) error      { return nil }

// A switch to another host publishes that host's connection and key in one
// write, and clears nothing: the provider's copy moves with the org.
func TestSyncModelProvider_ASwitchPublishesTheNewConnection(t *testing.T) {
	provider := &recordingProvider{}
	svc := NewAnthropicCredentialService(nil, nil).WithModelProvider(provider)

	svc.syncModelProvider(context.Background(), "acme", firstParty(), onOllama(), " ollama-key-0123456789 ")

	if len(provider.cleared) != 0 {
		t.Fatalf("cleared %d time(s) on a switch, want none", len(provider.cleared))
	}
	if len(provider.published) != 1 {
		t.Fatalf("published %d time(s), want once", len(provider.published))
	}
	got := provider.published[0]
	if got.conn != *onOllama() || got.key != "ollama-key-0123456789" {
		t.Fatalf("published %+v, want the Ollama connection with its trimmed key", got)
	}
}

// A save that moved the format and kept the key (allowed on the stored host)
// publishes with the stored key, read after the commit: the provider needs the
// value, and the save carried none.
func TestSyncModelProvider_AKeptKeyIsReadFromTheStore(t *testing.T) {
	provider := &recordingProvider{}
	svc := NewAnthropicCredentialService(nil, storedKey{key: "ollama-stored-0123456789"}).WithModelProvider(provider)

	svc.syncModelProvider(context.Background(), "acme", onOllama(), anthropicOnOllama(), "")

	if len(provider.published) != 1 || provider.published[0].key != "ollama-stored-0123456789" ||
		provider.published[0].conn != *anthropicOnOllama() {
		t.Fatalf("published %+v, want the new connection with the stored key", provider.published)
	}
}

// A kept key that cannot be read is logged and swallowed — the save has
// committed — and nothing half-built reaches the provider.
func TestSyncModelProvider_AnUnreadableKeptKeyPublishesNothing(t *testing.T) {
	provider := &recordingProvider{}
	svc := NewAnthropicCredentialService(nil, storedKey{}).WithModelProvider(provider)

	svc.syncModelProvider(context.Background(), "acme", onOllama(), anthropicOnOllama(), "")

	if len(provider.published) != 0 {
		t.Fatalf("published %+v with no key to send", provider.published)
	}
}

// A disconnect clears the provider's copy once, on any format, and names the
// connection the copy belonged to; the connect that follows publishes.
func TestSyncModelProvider_ADisconnectClearsTheProviderOnce(t *testing.T) {
	provider := &recordingProvider{}
	svc := NewAnthropicCredentialService(nil, nil).WithModelProvider(provider)
	ctx := context.Background()

	svc.syncModelProvider(ctx, "acme", onOllama(), nil, "")
	svc.syncModelProvider(ctx, "acme", nil, nil, "")
	svc.syncModelProvider(ctx, "acme", nil, firstParty(), "sk-ant-api03-0123456789")

	if len(provider.cleared) != 1 || provider.cleared[0] != *onOllama() {
		t.Fatalf("cleared %+v, want once, for the Ollama connection", provider.cleared)
	}
	if len(provider.published) != 1 {
		t.Fatalf("published %d time(s), want the reconnect once", len(provider.published))
	}
}

// A failed clear is attempted once and swallowed, never raised: the save it
// follows has committed. On a disconnect there is no connection after it, so
// the warning names the host the copy belonged to.
func TestSyncModelProvider_AFailedClearOnDisconnectIsAttemptedOnceAndSwallowed(t *testing.T) {
	provider := &recordingProvider{clearErr: errors.New("amp unreachable")}
	svc := NewAnthropicCredentialService(nil, nil).WithModelProvider(provider)

	svc.syncModelProvider(context.Background(), "acme", firstParty(), nil, "")

	if len(provider.cleared) != 1 {
		t.Fatalf("cleared %d time(s), want one attempt", len(provider.cleared))
	}
}
