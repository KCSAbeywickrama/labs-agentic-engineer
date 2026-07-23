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

package migrate

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

// validation_criterion_statuses.go — the validation criteria checklist store.
//
// One row per (org_id, repo, issue_number, criterion_id): the validation runner's
// Playwright reporter reports each acceptance criterion's live status to the
// internal criteria callback, which upserts here (last-write-wins). The console
// lists them by issue number (org-fenced) to seed its criteria checklist, so a
// finished or FAILED (never-merged) run still shows the complete per-criterion
// outcome.
//
// org_id LEADS the key: the tenant fence is part of the write identity, so two
// orgs sharing a repo slug never overwrite each other's rows, and the org-fenced
// read (WHERE org_id, repo, issue_number) is served by the PK's own prefix — no
// separate secondary index needed.
//
// Deliberately NOT keyed to / FK'd on executions: the key is the validation
// Task's issue (a same-issue retry upserts onto the same rows), and rows outlive
// any single execution attempt. execution_id is provenance only. No TTL —
// mirrors coding_agent_logs.
func RunValidationCriterionStatuses(ctx context.Context, db *gorm.DB) error {
	stmt := `
		CREATE TABLE IF NOT EXISTS validation_criterion_statuses (
		  org_id         TEXT         NOT NULL,
		  repo           TEXT         NOT NULL,
		  issue_number   BIGINT       NOT NULL,
		  criterion_id   TEXT         NOT NULL,
		  project_id     TEXT         NOT NULL,
		  requirement_id TEXT         NOT NULL DEFAULT '',
		  status         TEXT         NOT NULL,
		  execution_id   TEXT         NOT NULL DEFAULT '',
		  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
		  PRIMARY KEY (org_id, repo, issue_number, criterion_id)
		);`
	if err := db.WithContext(ctx).Exec(stmt).Error; err != nil {
		return fmt.Errorf("validation_criterion_statuses: %w", err)
	}
	return nil
}
