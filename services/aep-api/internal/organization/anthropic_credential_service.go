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

// anthropic_credential_service.go — Anthropic credential service.
//
// AnthropicCredentialService owns the per-org Anthropic API key surface:
//
//   - Connect / Status / Disconnect (POST/GET/DELETE /internal/credentials/orgs/{org}/anthropic)
//   - EffectiveKey (GET .../anthropic/effective-key) — returns the org key
//     (or "none"), used by agents-service per-call. There is no platform
//     fallback: orgs bring their own key.
//
// Connect mirrors the key into the org's secret store through SM-API; the
// coding runner reads it from an ExternalSecret rendered against that path, so
// this service writes nothing into any cluster.
package organization

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/wso2/aep/aep-api/internal/platform/secrets"
)

// AnthropicCredentialService — see package doc.
type AnthropicCredentialService struct {
	repo         OrgAnthropicRepository
	store        secrets.CredentialStore
	anthropicAPI string // "https://api.anthropic.com" by default; overridden in tests
	httpClient   *http.Client

	// secretRefWriter mirrors the key into SM-API on Connect. nil-safe.
	secretRefWriter *SecretRefWriter
}

// WithSecretRefWriter injects the SM-API writer; chainable. nil disables
// the mirror — the org_secrets path remains authoritative.
func (s *AnthropicCredentialService) WithSecretRefWriter(w *SecretRefWriter) *AnthropicCredentialService {
	s.secretRefWriter = w
	return s
}

// WithAnthropicAPIBase points key validation at base instead of the real
// Anthropic API; chainable. Tests aim it at an httptest server so
// validateAnthropicKey's probe never leaves the process.
func (s *AnthropicCredentialService) WithAnthropicAPIBase(base string) *AnthropicCredentialService {
	s.anthropicAPI = base
	return s
}

// NewAnthropicCredentialService wires the service. repo and store must be non-nil.
func NewAnthropicCredentialService(
	repo OrgAnthropicRepository,
	store secrets.CredentialStore,
) *AnthropicCredentialService {
	return &AnthropicCredentialService{
		repo:         repo,
		store:        store,
		anthropicAPI: "https://api.anthropic.com",
		httpClient:   &http.Client{Timeout: 15 * time.Second},
	}
}

// ----------------------------------------------------------------------------
// Errors
// ----------------------------------------------------------------------------

// ErrAnthropicKeyRequired signals that no per-org key is configured and
// the caller specifically required one (dispatch path). Distinct from
// returning the platform fallback. Wrap with status 422 at the API edge.
var ErrAnthropicKeyRequired = errors.New("anthropic: org key required")

// ----------------------------------------------------------------------------
// Projection — what the API + console see
// ----------------------------------------------------------------------------

type AnthropicProjection struct {
	OcOrgID         string     `json:"ocOrgId"`
	KeyPrefix       string     `json:"keyPrefix"`
	KeyLast4        string     `json:"keyLast4"`
	Status          string     `json:"status"`
	ConnectedAt     time.Time  `json:"connectedAt"`
	LastValidatedAt *time.Time `json:"lastValidatedAt,omitempty"`
	ValidationError *string    `json:"validationError,omitempty"`
}

func projectionFromAnthropicRow(r *OrgAnthropicCredential) *AnthropicProjection {
	return &AnthropicProjection{
		OcOrgID:         r.OcOrgID,
		KeyPrefix:       r.KeyPrefix,
		KeyLast4:        r.KeyLast4,
		Status:          r.Status,
		ConnectedAt:     r.ConnectedAt,
		LastValidatedAt: r.LastValidatedAt,
		ValidationError: r.ValidationError,
	}
}

// ----------------------------------------------------------------------------
// Connect / Replace
// ----------------------------------------------------------------------------

// AnthropicConnectRequest is the body for POST /internal/credentials/orgs/{org}/anthropic.
type AnthropicConnectRequest struct {
	APIKey string `json:"apiKey"`
}

// Connect validates the supplied key against Anthropic, persists it in
// `org_secrets` (AES-256-GCM), and upserts the metadata row. Idempotent under
// the org-scoped advisory lock — concurrent Connects produce one consistent
// row. The BFF resolves the effective key per request and forwards it to
// agents-service, so there is no remote cache to invalidate.
func (s *AnthropicCredentialService) Connect(ctx context.Context, ocOrgID string, req AnthropicConnectRequest) (*AnthropicProjection, error) {
	key := strings.TrimSpace(req.APIKey)
	if err := s.ValidateKey(ctx, key); err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	prefix, last4 := anthropicKeyPreview(key)

	row := OrgAnthropicCredential{
		OcOrgID:         ocOrgID,
		KeyPrefix:       prefix,
		KeyLast4:        last4,
		Status:          "active",
		ConnectedAt:     now,
		LastValidatedAt: &now,
		ValidationError: nil,
	}
	err := s.repo.Tx(ctx, func(tx OrgAnthropicTx) error {
		if err := tx.AdvisoryLock("org_anthropic:" + ocOrgID); err != nil {
			return fmt.Errorf("anthropic connect: lock: %w", err)
		}

		// Encrypted bytes — same KV store the GitHub PAT uses.
		if err := s.store.Put(ctx, ocOrgID, "anthropic/key", []byte(key)); err != nil {
			return fmt.Errorf("anthropic connect: store put: %w", err)
		}

		// Upsert via ON CONFLICT DO UPDATE so Replace is idempotent. The UPDATE
		// deliberately omits connected_at so a replace preserves the ORIGINAL
		// connection time; RETURNING that column reads the persisted value back so
		// the projection we return matches the stored row (on a replace it's the
		// original, not the in-memory `now`) — Upsert scans it back into
		// row.ConnectedAt.
		if err := tx.Upsert(&row); err != nil {
			return fmt.Errorf("anthropic connect: upsert: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Best-effort SM-API mirror. Same posture as
	// CredentialService.mirrorPATToSMAPI: org_secrets stays authoritative
	// when SM-API is unavailable; the row's SM-API triplet stays NULL
	// until the next successful Connect. Consumers reference the mirrored
	// path through an ExternalSecret whose refreshInterval re-syncs it, so
	// nothing has to be pushed anywhere on rotation.
	if s.secretRefWriter != nil && s.secretRefWriter.Enabled() {
		if _, err := s.secretRefWriter.WriteAnthropic(ctx, ocOrgID, key); err != nil {
			slog.WarnContext(ctx, "anthropic: SM-API mirror failed (legacy store still authoritative)",
				"ocOrgId", ocOrgID, "error", err)
		}
	}

	slog.InfoContext(ctx, "anthropic.connected", "ocOrgId", ocOrgID, "keyPrefix", prefix)
	return projectionFromAnthropicRow(&row), nil
}

// ValidateKey runs the connect-time validation for an Anthropic key WITHOUT
// persisting anything: the shape checks plus the live /v1/messages probe.
//
// It is the probe-only seam the /config PATCH orchestrator calls in its
// pre-persist phase, so a bad key in one section fails the whole atomic patch
// before any section is written (docs/design/org-config-consolidation.md §4).
// Connect calls it too, so the validation logic lives in exactly one place and
// the two paths can't drift.
func (s *AnthropicCredentialService) ValidateKey(ctx context.Context, apiKey string) error {
	key := strings.TrimSpace(apiKey)
	if key == "" {
		return &ValidationError{Code: "anthropic_key_missing", Message: "apiKey is required"}
	}
	if !looksLikeAnthropicKey(key) {
		return &ValidationError{Code: "anthropic_key_invalid", Message: "API key does not look like an Anthropic key (expected prefix 'sk-ant-')"}
	}
	return s.validateAnthropicKey(ctx, key)
}

// ----------------------------------------------------------------------------
// Status
// ----------------------------------------------------------------------------

// Status returns the projection for ocOrgID. Returns NotFoundError when
// no row exists so the API edge can map to 404.
func (s *AnthropicCredentialService) Status(ctx context.Context, ocOrgID string) (*AnthropicProjection, error) {
	row, err := s.fetchRow(ctx, ocOrgID)
	if err != nil {
		return nil, err
	}
	return projectionFromAnthropicRow(row), nil
}

// ----------------------------------------------------------------------------
// Disconnect
// ----------------------------------------------------------------------------

// Disconnect removes the org's Anthropic key: deletes the encrypted bytes
// from `org_secrets` and drops the metadata row. The runner reads the key
// through the org's ExternalSecret, so there is no cluster-side Secret to
// tear down here.
//
// Idempotent: missing row is a no-op (200 → 204 at the API edge).
func (s *AnthropicCredentialService) Disconnect(ctx context.Context, ocOrgID string) error {
	err := s.repo.Tx(ctx, func(tx OrgAnthropicTx) error {
		if err := tx.AdvisoryLock("org_anthropic:" + ocOrgID); err != nil {
			return fmt.Errorf("anthropic disconnect: lock: %w", err)
		}

		// Delete the metadata row directly — the existing GitHub PAT flow flips
		// to `disconnected` for audit, but here we have nothing else referencing
		// the row (no installation_id, no webhook routing). Delete is cleaner.
		if err := tx.DeleteByOrg(ocOrgID); err != nil {
			return fmt.Errorf("anthropic disconnect: delete row: %w", err)
		}
		return nil
	})
	if err != nil {
		return err
	}

	// Best-effort GC. Failures are logged, not surfaced.
	if err := s.store.Delete(ctx, ocOrgID, "anthropic/key"); err != nil {
		slog.WarnContext(ctx, "anthropic disconnect: store delete failed",
			"ocOrgId", ocOrgID, "error", err)
	}

	slog.InfoContext(ctx, "anthropic.disconnected", "ocOrgId", ocOrgID)
	return nil
}

// ----------------------------------------------------------------------------
// EffectiveKey
// ----------------------------------------------------------------------------

// EffectiveKeyResponse is the shape returned to agents-service.
type EffectiveKeyResponse struct {
	Source string `json:"source"` // "org" | "none"
	Key    string `json:"key,omitempty"`
}

// EffectiveKey returns the org key when configured (and active). Returns
// { source: "none" } when the org has no usable key — agents-service maps
// to 503. There is no platform fallback: orgs bring their own key.
func (s *AnthropicCredentialService) EffectiveKey(ctx context.Context, ocOrgID string) (*EffectiveKeyResponse, error) {
	row, err := s.fetchRow(ctx, ocOrgID)
	if err == nil && row.Status == "active" {
		key, getErr := s.store.Get(ctx, ocOrgID, "anthropic/key")
		if getErr == nil && len(key) > 0 {
			return &EffectiveKeyResponse{Source: "org", Key: string(key)}, nil
		}
		// Row says active but bytes are gone — log loudly and return "none".
		slog.WarnContext(ctx, "anthropic effective-key: row=active but org_secrets missing",
			"ocOrgId", ocOrgID, "error", getErr)
	}
	// Row absent (NotFoundError) or not active, or bytes missing.
	return &EffectiveKeyResponse{Source: "none"}, nil
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

// ResyncSecretRef re-pushes the org's Anthropic key through the in-process
// SecretRefWriter (local OpenBao repair). Returns (false, nil) when there is
// nothing to push. ctx must carry an ouId claim (repair injects thunder_org_uuid).
func (s *AnthropicCredentialService) ResyncSecretRef(ctx context.Context, ocOrgID string) (bool, error) {
	if s.secretRefWriter == nil || !s.secretRefWriter.Enabled() {
		return false, nil
	}
	row, err := s.fetchRow(ctx, ocOrgID)
	if err != nil {
		var nf *NotFoundError
		if errors.As(err, &nf) {
			return false, nil
		}
		return false, fmt.Errorf("anthropic resync: load row: %w", err)
	}
	if row.Status != "active" {
		return false, nil
	}
	kvPath := row.ResolvedSecretRefKVPath()
	prop := row.ResolvedSecretRefProperty()
	if kvPath == nil || prop == nil || *kvPath == "" || *prop == "" {
		return false, nil
	}
	key, err := s.store.Get(ctx, ocOrgID, "anthropic/key")
	if err != nil || len(key) == 0 {
		return false, nil
	}
	if _, err := s.secretRefWriter.WriteAnthropic(ctx, ocOrgID, string(key)); err != nil {
		return false, fmt.Errorf("anthropic resync: write: %w", err)
	}
	return true, nil
}

func (s *AnthropicCredentialService) fetchRow(ctx context.Context, ocOrgID string) (*OrgAnthropicCredential, error) {
	row, err := s.repo.GetByOrg(ctx, ocOrgID)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, &NotFoundError{What: fmt.Sprintf("org_anthropic_credentials.%s", ocOrgID)}
	}
	return row, nil
}

// validateAnthropicKey probes Anthropic's /v1/messages with a minimal
// payload. 401 → ValidationError{anthropic_key_invalid}. A 5xx is the
// upstream's fault → UpstreamError (mapped to 502 Bad Gateway), NOT a
// client-fault 400. Other unexpected non-5xx statuses (e.g. 429) stay a
// ValidationError.
//
// Anthropic's /v1/messages requires both `x-api-key` and `anthropic-version`
// headers; a malformed request returns 400 (which still proves the key is
// recognized). We send a single 1-token completion request that should
// either 200 OK or 401 Unauthorized.
func (s *AnthropicCredentialService) validateAnthropicKey(ctx context.Context, key string) error {
	body := []byte(`{
	  "model": "claude-haiku-4-5",
	  "max_tokens": 1,
	  "messages": [{"role":"user","content":"ping"}]
	}`)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, s.anthropicAPI+"/v1/messages", bytes.NewReader(body))
	req.Header.Set("x-api-key", key)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("content-type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return &ValidationError{Code: "anthropic_unreachable", Message: fmt.Sprintf("Anthropic API unreachable: %v", err)}
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
	switch resp.StatusCode {
	case http.StatusUnauthorized:
		return &ValidationError{Code: "anthropic_key_invalid", Message: "Anthropic rejected the key (401 Unauthorized)"}
	case http.StatusForbidden:
		return &ValidationError{Code: "anthropic_key_forbidden", Message: "Anthropic key lacks the required permissions"}
	case http.StatusOK, http.StatusBadRequest:
		// 200 = key valid; 400 = key recognized but request payload arguable
		// (e.g. unknown model). Either way the key is authenticated.
		return nil
	}
	if resp.StatusCode >= 500 {
		// Upstream is broken, not the caller's key/request — surface a 502 at
		// the edge so we don't blame the client for Anthropic's outage.
		return &UpstreamError{
			Code:    "anthropic_unavailable",
			Message: fmt.Sprintf("Anthropic API returned %d: %s", resp.StatusCode, truncateForError(respBody)),
		}
	}
	return &ValidationError{
		Code:    "anthropic_unexpected_status",
		Message: fmt.Sprintf("Anthropic API returned %d: %s", resp.StatusCode, truncateForError(respBody)),
	}
}

func looksLikeAnthropicKey(k string) bool {
	return strings.HasPrefix(k, "sk-ant-") && len(k) >= 20
}

// anthropicKeyPreview returns the standard prefix + last-4 display
// shape used everywhere (`sk-ant-ap03-A1B2…XyZw`).
func anthropicKeyPreview(k string) (prefix, last4 string) {
	if len(k) < 20 {
		return k, ""
	}
	// `sk-ant-` + next 8 chars = stable prefix.
	prefix = k[:15]
	last4 = k[len(k)-4:]
	return
}
