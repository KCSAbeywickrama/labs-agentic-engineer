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
// org's key, over connections constructed here. The DB-backed half (a saved
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

func TestModelProviderStepFor(t *testing.T) {
	for _, tc := range []struct {
		name          string
		before, after *modelconn.Connection
		keyWritten    bool
		want          modelProviderStep
	}{
		{"first connect on Anthropic's API publishes", nil, firstParty(), true, modelProviderPublish},
		{"a rotated key on Anthropic's API publishes", firstParty(), firstParty(), true, modelProviderPublish},
		{"a model change on Anthropic's API leaves the copy", firstParty(), firstParty(), false, modelProviderLeave},
		{"moving to another host clears the copy", firstParty(), onOllama(), true, modelProviderClear},
		{"a save that stays on the other host leaves it", onOllama(), onOllama(), true, modelProviderLeave},
		{"first connect on another host has nothing to clear", nil, onOllama(), true, modelProviderLeave},
		{"moving back to Anthropic's API publishes again", onOllama(), firstParty(), true, modelProviderPublish},
		{"a disconnect from Anthropic's API clears the copy", firstParty(), nil, false, modelProviderClear},
		{"a disconnect from another host has nothing to clear", onOllama(), nil, false, modelProviderLeave},
		{"a save with no connection either side leaves it", nil, nil, false, modelProviderLeave},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := modelProviderStepFor(tc.before, tc.after, tc.keyWritten); got != tc.want {
				t.Fatalf("step = %v, want %v", got, tc.want)
			}
		})
	}
}

// recordingProvider counts what reached the provider; clearErr is what every
// clear answers.
type recordingProvider struct {
	published []string
	cleared   int
	clearErr  error
}

func (p *recordingProvider) PublishOrgModelKey(_ context.Context, _, apiKey string) error {
	p.published = append(p.published, apiKey)
	return nil
}

func (p *recordingProvider) ClearOrgModelKey(context.Context, string) error {
	p.cleared++
	return p.clearErr
}

// The interim gate, over a sequence of saves: an org that moves off
// Anthropic's API has the provider's copy of its old key cleared exactly once,
// and nothing of the new host's key is published — not on that save, not on
// the next one.
func TestSyncModelProvider_ANonAnthropicConnectionClearsTheProviderOnce(t *testing.T) {
	provider := &recordingProvider{}
	svc := NewAnthropicCredentialService(nil, nil).WithModelProvider(provider)
	ctx := context.Background()

	svc.syncModelProvider(ctx, "acme", firstParty(), onOllama(), "ollama-key-0123456789")
	svc.syncModelProvider(ctx, "acme", onOllama(), onOllama(), "ollama-key-rotated-0123")

	if provider.cleared != 1 {
		t.Fatalf("cleared %d time(s), want once", provider.cleared)
	}
	if len(provider.published) != 0 {
		t.Fatalf("published %d key(s) for a connection generated agents cannot use", len(provider.published))
	}
}

// A disconnect leaves no connection generated agents run on, so the provider's
// copy goes with it, once: the Ollama save that follows starts from no
// connection and has nothing left to clear.
func TestSyncModelProvider_ADisconnectFromAnthropicClearsTheProviderOnce(t *testing.T) {
	provider := &recordingProvider{}
	svc := NewAnthropicCredentialService(nil, nil).WithModelProvider(provider)
	ctx := context.Background()

	svc.syncModelProvider(ctx, "acme", firstParty(), nil, "")
	svc.syncModelProvider(ctx, "acme", nil, onOllama(), "ollama-key-0123456789")

	if provider.cleared != 1 {
		t.Fatalf("cleared %d time(s) over disconnect then Ollama, want once", provider.cleared)
	}
	if len(provider.published) != 0 {
		t.Fatalf("published %d key(s) for a connection generated agents cannot use", len(provider.published))
	}
}

// An org that was never on Anthropic's API never had a copy published, so its
// disconnect makes no call.
func TestSyncModelProvider_ADisconnectFromAnotherHostMakesNoCall(t *testing.T) {
	provider := &recordingProvider{}
	svc := NewAnthropicCredentialService(nil, nil).WithModelProvider(provider)

	svc.syncModelProvider(context.Background(), "acme", onOllama(), nil, "")

	if provider.cleared != 0 || len(provider.published) != 0 {
		t.Fatalf("clears=%d publishes=%d, want no call", provider.cleared, len(provider.published))
	}
}

// A failed clear is attempted once and swallowed, never raised: the save it
// follows has committed. On a disconnect there is no connection after it, so
// the warning names the host the copy belonged to.
func TestSyncModelProvider_AFailedClearOnDisconnectIsAttemptedOnceAndSwallowed(t *testing.T) {
	provider := &recordingProvider{clearErr: errors.New("amp unreachable")}
	svc := NewAnthropicCredentialService(nil, nil).WithModelProvider(provider)

	svc.syncModelProvider(context.Background(), "acme", firstParty(), nil, "")

	if provider.cleared != 1 {
		t.Fatalf("cleared %d time(s), want one attempt", provider.cleared)
	}
}
