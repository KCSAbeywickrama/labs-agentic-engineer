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

// Package agentsvc is the BFF client for the NEW file-mutation agents service
// (services/agents). It is distinct from internal/clients/agents (the legacy
// AI-SDK service that still serves task generation).
//
// Contract (Phase 1, docs/design/agents-generation-migration.md §12.3):
//   - POST /conversations/{id}/turns  body {instruction, files,
//     filesChangedExternally?, skills?}  → raw StreamPart SSE frames + [DONE]
//     with `: keep-alive` comments; pre-stream statuses 400/409/413/500.
//   - GET  /conversations/{id}         → {messages: [...]} (no files).
//
// Auth is a plain M2M bearer JWT (aud: agents-service) minted per call — the
// service is tenancy-blind, so the only claims are the standard registered set;
// the acting org rides the log-only X-Org-Id header. The per-org Anthropic key
// travels in X-Anthropic-Key (resolved by the caller — there is no platform
// fallback). The client performs NO stream parsing: Turn hands back the raw
// response body for verbatim passthrough, and non-2xx pre-stream responses come
// back as a typed *UpstreamError the caller maps to a BFF status.
package agentsvc

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/wso2/aep/aep-api/internal/clients/httpx"
)

// Skill is one skill pushed in a turn (progressive disclosure level 1: the
// catalog carries name+description; content is the SKILL.md body; references
// maps a "references/<file>" path to its body, surfaced via loadSkillReference).
type Skill struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Content     string            `json:"content"`
	References  map[string]string `json:"references,omitempty"`
}

// TurnRequest is the body POSTed to the turn endpoint. `Files` is the full
// current snapshot every turn (the caller re-inlines it as CURRENT STATE);
// FilesChangedExternally flags a user hand-edit since the last turn.
//
// Toolset selects the per-turn tool registration on the agents service
// (docs/design/tasks-github-native.md §9.3): "" / "files" (default) registers
// today's file tools — byte-identical to before — while "task-plan" registers
// planTask/updateTask with no file tools (the plan turn). It is omitempty so a
// files turn serializes exactly as it did before the field existed.
type TurnRequest struct {
	Instruction            string            `json:"instruction"`
	Files                  map[string]string `json:"files"`
	FilesChangedExternally bool              `json:"filesChangedExternally,omitempty"`
	Skills                 []Skill           `json:"skills,omitempty"`
	Toolset                string            `json:"toolset,omitempty"`
}

// UpstreamError is a non-2xx pre-stream response from the agents service. The
// caller maps StatusCode to a BFF status (409 → turn_in_progress, 413 → 413,
// 400/500 → 502-style). Once the SSE body has started, failures arrive in-band
// as error frames instead — this type only ever carries a pre-stream status.
type UpstreamError struct {
	StatusCode int
	Body       string
}

func (e *UpstreamError) Error() string {
	return fmt.Sprintf("agents service pre-stream status %d: %s", e.StatusCode, e.Body)
}

// Client is the agents-service turn/rehydrate surface.
type Client interface {
	// Turn POSTs a turn and, on 200, returns the raw SSE body for verbatim
	// passthrough (caller must Close). conversationID is the already-namespaced
	// service id; orgID rides X-Org-Id (log-only); anthropicKey is forwarded as
	// X-Anthropic-Key (must be non-empty — resolve + 4xx before calling).
	// A non-200 pre-stream response is returned as *UpstreamError.
	Turn(ctx context.Context, conversationID, orgID, anthropicKey string, req TurnRequest) (io.ReadCloser, error)

	// GetConversation returns the raw {messages: [...]} JSON for chat rehydrate.
	// A non-200 (e.g. 404 unknown id) is returned as *UpstreamError.
	GetConversation(ctx context.Context, conversationID, orgID string) (json.RawMessage, error)
}

// Config wires the client. Secret + Audience (+ optional Issuer) drive the M2M
// token; a nil/empty Secret disables signing (dev/tests that never reach the
// network — the service's gate would reject an unsigned request in production).
type Config struct {
	BaseURL  string
	Secret   string // HS256 shared secret (AGENT_JWT_SECRET on the service)
	Audience string // aud claim; defaults to "agents-service"
	Issuer   string // optional iss claim
}

type client struct {
	baseURL    string
	httpClient *http.Client
	signer     tokenSigner
}

// New builds an agents-service client. It uses an HS256 signer for local M2M;
// the tokenSigner seam lets an RS256/JWKS signer slot in without touching the
// call sites. No client-side timeout — turns stream for minutes; cancellation
// flows via ctx.
func New(cfg Config) Client {
	audience := cfg.Audience
	if audience == "" {
		audience = defaultAudience
	}
	var signer tokenSigner
	if cfg.Secret != "" {
		signer = newHS256Signer(cfg.Secret, audience, cfg.Issuer)
	}
	return &client{
		baseURL:    cfg.BaseURL,
		httpClient: &http.Client{Transport: httpx.WrapTransport(nil)},
		signer:     signer,
	}
}

func (c *client) Turn(ctx context.Context, conversationID, orgID, anthropicKey string, req TurnRequest) (io.ReadCloser, error) {
	payload, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal turn request: %w", err)
	}
	url := c.baseURL + "/conversations/" + conversationID + "/turns"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("create turn request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	if anthropicKey != "" {
		httpReq.Header.Set("X-Anthropic-Key", anthropicKey)
	}
	if err := c.attachAuth(orgID, httpReq); err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("agents service turn request: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		return nil, &UpstreamError{StatusCode: resp.StatusCode, Body: string(body)}
	}
	return resp.Body, nil
}

func (c *client) GetConversation(ctx context.Context, conversationID, orgID string) (json.RawMessage, error) {
	url := c.baseURL + "/conversations/" + conversationID
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create get-conversation request: %w", err)
	}
	httpReq.Header.Set("Accept", "application/json")
	if err := c.attachAuth(orgID, httpReq); err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("agents service get-conversation request: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, &UpstreamError{StatusCode: resp.StatusCode, Body: string(body)}
	}
	return json.RawMessage(body), nil
}

// attachAuth mints the per-call M2M bearer and sets the log-only org header. A
// nil signer (dev/tests) skips the bearer.
func (c *client) attachAuth(orgID string, req *http.Request) error {
	if orgID != "" {
		req.Header.Set("X-Org-Id", orgID)
	}
	if c.signer == nil {
		return nil
	}
	tok, err := c.signer.sign()
	if err != nil {
		return fmt.Errorf("mint agents M2M token: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	return nil
}
