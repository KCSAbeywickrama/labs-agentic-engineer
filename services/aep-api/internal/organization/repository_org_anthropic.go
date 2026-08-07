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

import (
	"context"
	"errors"

	"gorm.io/gorm"
)

// OrgAnthropicRepository persists the per-org, per-role Anthropic API key
// metadata rows (`org_anthropic_credentials`, PK (oc_org_id, role) — the
// non-secret projection fields; the encrypted key bytes live in org_secrets).
// Every accessor is keyed by BOTH oc_org_id and role, so a dropped filter is a
// missing method, not a cross-org write or a cross-role one (which would let a
// coding-key rotation silently overwrite the org's default key).
//
// Connect's advisory-lock-guarded upsert and Disconnect's delete run inside
// Tx: it begins the transaction, holds the org-scoped advisory xact lock
// across the credential-store write + the row write, and commits (fn returns
// nil) or rolls back (fn returns an error). The lock is org-scoped rather than
// role-scoped because the default role's disconnect cascades into the coding
// role — both rows move under one lock.
type OrgAnthropicRepository interface {
	// GetByOrg returns the row for (ocOrgID, role), or nil when absent (not an
	// error).
	GetByOrg(ctx context.Context, ocOrgID string, role AnthropicRole) (*OrgAnthropicCredential, error)
	// UpdateColumns writes the given columns onto the row scoped to
	// (oc_org_id, role) (a map so nil values are written as NULL, not skipped).
	UpdateColumns(ctx context.Context, ocOrgID string, role AnthropicRole, updates map[string]any) error

	// Tx begins a transaction, runs fn, and commits on nil / rolls back on
	// error. fn holds the advisory lock (via OrgAnthropicTx.AdvisoryLock)
	// across the writes it performs inside the closure.
	Tx(ctx context.Context, fn func(tx OrgAnthropicTx) error) error
}

// OrgAnthropicTx is the transaction-scoped surface passed to Tx's closure.
type OrgAnthropicTx interface {
	// AdvisoryLock runs pg_advisory_xact_lock(hashtext(key)).
	AdvisoryLock(key string) error
	// Upsert INSERTs the row or, on (oc_org_id, role) conflict, UPDATEs the
	// metadata columns — deliberately preserving the ORIGINAL connected_at on a
	// replace — and scans the persisted connected_at back into row.ConnectedAt.
	Upsert(row *OrgAnthropicCredential) error
	// DeleteByOrg removes the metadata row for (ocOrgID, role) within the tx.
	DeleteByOrg(ocOrgID string, role AnthropicRole) error
	// DeleteAllRoles removes EVERY role's row for ocOrgID within the tx. This
	// is the default role's disconnect cascade: the coding key is an override
	// on the default, so it cannot outlive it (ADR-0016).
	DeleteAllRoles(ocOrgID string) error
}

type orgAnthropicRepository struct {
	db *gorm.DB
}

// NewOrgAnthropicRepository constructs the gorm-backed OrgAnthropicRepository.
func NewOrgAnthropicRepository(db *gorm.DB) OrgAnthropicRepository {
	return &orgAnthropicRepository{db: db}
}

func (r *orgAnthropicRepository) GetByOrg(ctx context.Context, ocOrgID string, role AnthropicRole) (*OrgAnthropicCredential, error) {
	var row OrgAnthropicCredential
	err := r.db.WithContext(ctx).Where("oc_org_id = ? AND role = ?", ocOrgID, role).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (r *orgAnthropicRepository) UpdateColumns(ctx context.Context, ocOrgID string, role AnthropicRole, updates map[string]any) error {
	return r.db.WithContext(ctx).
		Model(&OrgAnthropicCredential{}).
		Where("oc_org_id = ? AND role = ?", ocOrgID, role).
		Updates(updates).Error
}

func (r *orgAnthropicRepository) Tx(ctx context.Context, fn func(tx OrgAnthropicTx) error) error {
	tx := r.db.WithContext(ctx).Begin()
	if tx.Error != nil {
		return tx.Error
	}
	defer func() { _ = tx.Rollback() }() // no-op once committed
	if err := fn(&orgAnthropicTx{tx: tx}); err != nil {
		return err
	}
	return tx.Commit().Error
}

type orgAnthropicTx struct {
	tx *gorm.DB
}

func (t *orgAnthropicTx) AdvisoryLock(key string) error {
	return t.tx.Exec(`SELECT pg_advisory_xact_lock(hashtext(?))`, key).Error
}

func (t *orgAnthropicTx) Upsert(row *OrgAnthropicCredential) error {
	// Upsert via ON CONFLICT DO UPDATE so Replace is idempotent. The UPDATE
	// deliberately omits connected_at so a replace preserves the ORIGINAL
	// connection time; RETURNING that column reads the persisted value back so
	// the projection we return matches the stored row (on a replace it's the
	// original, not the in-memory `now`).
	return t.tx.Raw(`
		INSERT INTO org_anthropic_credentials
		    (oc_org_id, role, key_prefix, key_last4, status, connected_at, last_validated_at, validation_error)
		VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
		ON CONFLICT (oc_org_id, role) DO UPDATE
		  SET key_prefix         = EXCLUDED.key_prefix,
		      key_last4          = EXCLUDED.key_last4,
		      status             = EXCLUDED.status,
		      last_validated_at  = EXCLUDED.last_validated_at,
		      validation_error   = NULL
		RETURNING connected_at`,
		row.OcOrgID, row.Role, row.KeyPrefix, row.KeyLast4, row.Status, row.ConnectedAt, row.LastValidatedAt,
	).Scan(&row.ConnectedAt).Error
}

func (t *orgAnthropicTx) DeleteByOrg(ocOrgID string, role AnthropicRole) error {
	return t.tx.Exec(`DELETE FROM org_anthropic_credentials WHERE oc_org_id = ? AND role = ?`, ocOrgID, role).Error
}

func (t *orgAnthropicTx) DeleteAllRoles(ocOrgID string) error {
	return t.tx.Exec(`DELETE FROM org_anthropic_credentials WHERE oc_org_id = ?`, ocOrgID).Error
}
