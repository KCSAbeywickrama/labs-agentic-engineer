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

package delivery

import (
	"context"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ValidationCriterionStatusRepository is the validation_criterion_statuses store: the internal
// criteria callback upserts one row per acceptance criterion as the validation
// runner reports it live, and the task read path lists them by issue number for
// the console checklist. Org-scoped reads; upsert is last-write-wins on
// (repo, issue_number, criterion_id).
type ValidationCriterionStatusRepository interface {
	// Upsert writes the criterion's latest status, overwriting an existing row
	// for the same (repo, issue_number, criterion_id).
	Upsert(ctx context.Context, row *ValidationCriterionStatus) error

	// ListByIssueScoped returns every criterion status for one validation Task,
	// org-fenced. Ordered by criterion id for a stable checklist. A miss is an
	// empty slice, not an error.
	ListByIssueScoped(ctx context.Context, orgID, repo string, issueNumber int) ([]ValidationCriterionStatus, error)
}

type validationCriterionStatusRepository struct {
	db *gorm.DB
}

// NewValidationCriterionStatusRepository builds the validation_criterion_statuses store.
func NewValidationCriterionStatusRepository(db *gorm.DB) ValidationCriterionStatusRepository {
	return &validationCriterionStatusRepository{db: db}
}

func (r *validationCriterionStatusRepository) Upsert(ctx context.Context, row *ValidationCriterionStatus) error {
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "repo"}, {Name: "issue_number"}, {Name: "criterion_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"org_id", "project_id", "requirement_id", "status", "execution_id", "updated_at",
		}),
	}).Create(row).Error
}

func (r *validationCriterionStatusRepository) ListByIssueScoped(ctx context.Context, orgID, repo string, issueNumber int) ([]ValidationCriterionStatus, error) {
	var rows []ValidationCriterionStatus
	err := r.db.WithContext(ctx).
		Where("org_id = ? AND repo = ? AND issue_number = ?", orgID, repo, issueNumber).
		Order("criterion_id ASC").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	return rows, nil
}
