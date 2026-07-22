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

import "time"

// CriterionStatus is the durable, live-fed record of one validation acceptance
// criterion's latest run status. The validation runner's Playwright reporter
// reports each criterion's begin/end (per test) to the internal criteria
// callback, which upserts a row here; the console reads them back by issue
// number to seed its criteria checklist — so a finished (or FAILED, hence
// never-merged) run still shows the complete per-criterion outcome, independent
// of the log-snapshot tail.
//
// Keyed by `(repo, issue_number, criterion_id)`, NOT by execution id: the
// console reads by the validation Task's issue number and wants the CURRENT
// checklist, so a same-issue retry upserts onto the same rows (last-write-wins).
// ExecutionID is kept for provenance only, not as a key or FK — rows outlive any
// single execution attempt.
type CriterionStatus struct {
	Repo          string    `gorm:"type:text;primaryKey;column:repo" json:"-"`
	IssueNumber   int       `gorm:"primaryKey;column:issue_number" json:"-"`
	CriterionID   string    `gorm:"type:text;primaryKey;column:criterion_id" json:"id"`
	OrgID         string    `gorm:"type:text;not null;index;column:org_id" json:"-"`
	ProjectID     string    `gorm:"type:text;not null;column:project_id" json:"-"`
	RequirementID string    `gorm:"type:text;not null;default:'';column:requirement_id" json:"requirementId"`
	Status        string    `gorm:"type:text;not null;column:status" json:"status"`
	ExecutionID   string    `gorm:"type:text;not null;default:'';column:execution_id" json:"-"`
	UpdatedAt     time.Time `gorm:"type:timestamptz;not null;default:now();column:updated_at" json:"updatedAt"`
}

func (CriterionStatus) TableName() string { return "criterion_statuses" }
