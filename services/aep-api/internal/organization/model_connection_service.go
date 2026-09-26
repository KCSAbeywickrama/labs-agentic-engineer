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

// model_connection_service.go — the org's model connection, as every consumer
// outside this domain reads it.
//
// ModelConnectionService is the one reader of the connection: which format,
// URL, model and auth scheme the org's agents use (modelconn.Connection), the
// key's bytes or where they live, and which credential a coding run mounts. It
// offers two ports:
//
//   - ConnectionReader — Effective (the connection and its key's bytes, for the
//     spec agents, task planning and Agent Manager) and KeyRef (the connection
//     and its key's vault reference, for a consumer that mounts it).
//   - CodingCredentialResolver — which credential a coding run on a runtime
//     mounts: the Claude subscription or the connection's key, stated once
//     here (ADR-0036).
//
// The connection is read from the org_anthropic_credentials `default` row and
// org_agent_settings' model, so it is always the Anthropic format on
// api.anthropic.com with an x-api-key key.
package organization

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/wso2/aep/aep-api/internal/platform/modelconn"
	"github.com/wso2/aep/aep-api/internal/platform/orgconfig"
	"github.com/wso2/aep/aep-api/internal/platform/secrets"
)

// ConnectionReader is the connection for consumers that call the model
// themselves or hand its key to something that does.
type ConnectionReader interface {
	// Effective is the connection and its key's bytes; ok is false when the
	// org has no usable connection, which is "not connected yet", not an
	// error. There is no platform fallback: orgs bring their own key.
	Effective(ctx context.Context, ocOrgID string) (conn modelconn.Connection, key string, ok bool, err error)
	// KeyRef is the connection and where its key lives, for a consumer that
	// points a SecretReference at the vault path rather than forwarding the
	// value. A NotFoundError means no active connection: "not connected yet".
	KeyRef(ctx context.Context, ocOrgID string) (modelconn.Connection, SecretRefTriplet, error)
}

// CodingCredentialResolver answers which credential a coding run on runtime
// mounts. It is the ONLY place that choice is written; every other reader
// gets the connection's key by construction.
type CodingCredentialResolver interface {
	ResolveCodingCredential(ctx context.Context, ocOrgID string, runtime orgconfig.AgentRuntime) (CodingCredential, error)
}

// CodingCredentialKind is which credential a coding run bills.
type CodingCredentialKind string

const (
	// CodingCredentialConnectionKey: the connection's own key.
	CodingCredentialConnectionKey CodingCredentialKind = "connection_key"
	// CodingCredentialClaudeSubscription: the org's Claude subscription token,
	// only ever on Claude Code.
	CodingCredentialClaudeSubscription CodingCredentialKind = "claude_subscription"
)

// CodingCredential is a coding run's resolved credential: the connection it
// runs on, the secret it mounts and which kind that secret is.
type CodingCredential struct {
	Conn modelconn.Connection
	Ref  SecretRefTriplet
	Kind CodingCredentialKind
}

// SecretRefTriplet is a resolved SM-API secret reference: the name plus the
// vault coordinates an ExternalSecret's remoteRef needs. Which variable a
// coding run receives it under is not this domain's to say: it says only which
// KIND of credential it is (CodingCredential.Kind), and dispatch maps that to
// the runner's env contract.
type SecretRefTriplet struct {
	Name     string
	KVPath   string
	Property string
}

// ModelConnectionService — see file doc.
type ModelConnectionService struct {
	repo     OrgAnthropicRepository
	store    secrets.CredentialStore
	settings *AgentSettingsService
}

var (
	_ ConnectionReader         = (*ModelConnectionService)(nil)
	_ CodingCredentialResolver = (*ModelConnectionService)(nil)
)

// NewModelConnectionService wires the reader over the credential rows, their
// secret bytes and the org's agent settings (the model). All must be non-nil.
func NewModelConnectionService(repo OrgAnthropicRepository, store secrets.CredentialStore, settings *AgentSettingsService) *ModelConnectionService {
	return &ModelConnectionService{repo: repo, store: store, settings: settings}
}

// connection is the org's connection around its chosen model.
func (s *ModelConnectionService) connection(ctx context.Context, ocOrgID string) (modelconn.Connection, error) {
	model, err := s.settings.Model(ctx, ocOrgID)
	if err != nil {
		return modelconn.Connection{}, err
	}
	return storedConnection(model), nil
}

// storedConnection is the connection the org's rows describe around its model:
// every connection an org can save today is Anthropic's own API, the key sent
// as x-api-key.
func storedConnection(model string) modelconn.Connection {
	return modelconn.Connection{
		Format:     modelconn.FormatAnthropic,
		BaseURL:    modelconn.AnthropicBaseURL,
		Host:       modelconn.AnthropicHost,
		Model:      model,
		AuthScheme: modelconn.AuthXAPIKey,
		ImageInput: modelconn.Yes,
	}
}

// Effective returns the connection and its key when the org's key row is
// active and its bytes are present; ok=false otherwise, which the turn
// surface maps to a pre-202 4xx. The model is read only once a key is found,
// so an org with no key never depends on its settings row.
//
// Deliberately the connection's key only: the spec agents are AI SDK calls,
// which cannot present the coding role's subscription token.
func (s *ModelConnectionService) Effective(ctx context.Context, ocOrgID string) (modelconn.Connection, string, bool, error) {
	key, ok := s.effectiveKey(ctx, ocOrgID)
	if !ok {
		return modelconn.Connection{}, "", false, nil
	}
	conn, err := s.connection(ctx, ocOrgID)
	if err != nil {
		return modelconn.Connection{}, "", false, err
	}
	return conn, key, true, nil
}

// effectiveKey reads the default row's key bytes. Any failure to find a usable
// key — no row, a row that is not active, a read error, missing bytes — is
// "none", not an error.
func (s *ModelConnectionService) effectiveKey(ctx context.Context, ocOrgID string) (string, bool) {
	row, err := fetchAnthropicRow(ctx, s.repo, ocOrgID, AnthropicRoleDefault)
	if err != nil || row.Status != "active" {
		return "", false
	}
	key, getErr := s.store.Get(ctx, ocOrgID, AnthropicRoleDefault.SecretStoreKey())
	if getErr == nil && len(key) > 0 {
		return string(key), true
	}
	// Row says active but bytes are gone — log loudly and return "none".
	slog.WarnContext(ctx, "anthropic effective-key: row=active but org_secrets missing",
		"ocOrgId", ocOrgID, "error", getErr)
	return "", false
}

// KeyRef returns the connection and its key's vault coordinates — the same
// {kvPath, property} pushExternalSecret resolves to deliver the RCA agent's
// ExternalSecret. It never reads the key's bytes, only where they live, for a
// caller that points an OpenChoreo SecretReference at the path rather than
// forwarding the value itself (e.g. wiring an ai-agent component's
// MODEL_API_KEY — docs/glossary.md's SecretReference entry: "authored in the
// org NS, ESO materializes it into the consuming-plane NS").
//
// Returns NotFoundError when the org has no active key. Every caller must
// treat that as "not connected yet", not a hard failure — the same discipline
// Effective's ok=false gives the spec agents.
func (s *ModelConnectionService) KeyRef(ctx context.Context, ocOrgID string) (modelconn.Connection, SecretRefTriplet, error) {
	row, err := fetchAnthropicRow(ctx, s.repo, ocOrgID, AnthropicRoleDefault)
	if err != nil {
		return modelconn.Connection{}, SecretRefTriplet{}, err
	}
	if row.Status != "active" {
		return modelconn.Connection{}, SecretRefTriplet{}, &NotFoundError{What: fmt.Sprintf("org_anthropic_credentials.%s.default (status=%s)", ocOrgID, row.Status)}
	}
	ref, err := tripletFrom(row)
	if err != nil {
		return modelconn.Connection{}, SecretRefTriplet{}, err
	}
	conn, err := s.connection(ctx, ocOrgID)
	if err != nil {
		return modelconn.Connection{}, SecretRefTriplet{}, err
	}
	return conn, ref, nil
}

// ResolveCodingCredential returns the credential a coding run on runtime must
// mount: the org's Claude subscription when it has one and the runtime is
// Claude Code, the connection's key otherwise. This is the ONLY place that
// choice is written.
//
// Only Claude Code can present a subscription token, so on any other runtime
// the subscription is not consulted at all (the save rule keeps one from being
// stored alongside OpenCode; this keeps a stray row from ever reaching a run).
//
// Fails closed. A subscription that exists but has no usable triplet is an
// error, never a silent fall-through to the connection's key: the org chose to
// bill its plan, and quietly billing API credits instead defeats that choice
// while leaving no trace the org can see.
func (s *ModelConnectionService) ResolveCodingCredential(ctx context.Context, ocOrgID string, runtime orgconfig.AgentRuntime) (CodingCredential, error) {
	ref, kind, err := s.resolveCodingRef(ctx, ocOrgID, runtime)
	if err != nil {
		return CodingCredential{}, err
	}
	conn, err := s.connection(ctx, ocOrgID)
	if err != nil {
		return CodingCredential{}, fmt.Errorf("model connection for org %q: %w", ocOrgID, err)
	}
	return CodingCredential{Conn: conn, Ref: ref, Kind: kind}, nil
}

func (s *ModelConnectionService) resolveCodingRef(ctx context.Context, ocOrgID string, runtime orgconfig.AgentRuntime) (SecretRefTriplet, CodingCredentialKind, error) {
	if runtime == orgconfig.AgentRuntimeClaudeCode {
		sub, err := s.repo.GetByOrg(ctx, ocOrgID, AnthropicRoleCoding)
		if err != nil {
			return SecretRefTriplet{}, "", fmt.Errorf("anthropic resolve coding ref: load subscription row: %w", err)
		}
		if sub != nil {
			if sub.Status != "active" {
				return SecretRefTriplet{}, "", fmt.Errorf(
					"the Claude subscription for org %q is %s — replace its token in Settings, "+
						"or remove the subscription so coding bills the organization's API key", ocOrgID, sub.Status)
			}
			ref, refErr := tripletFrom(sub)
			if refErr != nil {
				return SecretRefTriplet{}, "", fmt.Errorf(
					"the Claude subscription for org %q is configured but %w — save its token again in Settings, "+
						"or remove the subscription so coding bills the organization's API key", ocOrgID, refErr)
			}
			return ref, CodingCredentialClaudeSubscription, nil
		}
	}

	def, err := s.repo.GetByOrg(ctx, ocOrgID, AnthropicRoleDefault)
	if err != nil {
		return SecretRefTriplet{}, "", fmt.Errorf("anthropic resolve coding ref: load default row: %w", err)
	}
	if def == nil {
		return SecretRefTriplet{}, "", fmt.Errorf(
			"anthropic secret reference missing for org %q: org_anthropic_credentials row not found", ocOrgID)
	}
	ref, err := tripletFrom(def)
	if err != nil {
		return SecretRefTriplet{}, "", fmt.Errorf("anthropic secret reference for org %q: %w", ocOrgID, err)
	}
	return ref, CodingCredentialConnectionKey, nil
}

// tripletFrom reads a row's resolved secret-ref coordinates, naming whichever
// one is missing so a half-mirrored row is diagnosable from the error alone.
func tripletFrom(row *OrgAnthropicCredential) (SecretRefTriplet, error) {
	ref := SecretRefTriplet{
		Name:     derefOrEmpty(row.SecretRefName),
		KVPath:   derefOrEmpty(row.SecretRefKVPath),
		Property: derefOrEmpty(row.SecretRefProperty),
	}
	switch {
	case ref.Name == "":
		return SecretRefTriplet{}, errors.New("secret_ref_name is not populated")
	case ref.KVPath == "":
		return SecretRefTriplet{}, errors.New("secret_ref_kv_path is not populated")
	case ref.Property == "":
		return SecretRefTriplet{}, errors.New("secret_ref_property is not populated")
	}
	return ref, nil
}
